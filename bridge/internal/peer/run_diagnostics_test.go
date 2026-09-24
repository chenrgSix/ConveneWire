package peer

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/privatefs"
	"github.com/coder/websocket"
)

func readRunDiagnostics(t *testing.T, j *RunJournal, id string) runDiagnosticRecord {
	t.Helper()
	raw, err := privatefs.ReadFile(filepath.Join(j.directory, id, "diagnostics.json"), 16384)
	var record runDiagnosticRecord
	if err != nil || json.Unmarshal(raw, &record) != nil {
		t.Fatalf("diagnostic read: %v", err)
	}
	if strings.Contains(string(raw), "Command:") || strings.Contains(string(raw), "permission-test") {
		t.Fatal("approval details persisted")
	}
	return record
}

func TestPeerDiagnosticsBoundedPrivateAndIndependentOfJournal(t *testing.T) {
	f := runJournalFixture(t)
	f.receive(t)
	d := newRunDiagnostics(f.journal, f.binding.RunID)
	ctx := context.WithValue(context.Background(), runDiagnosticsKey{}, d)
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); observeApproval(ctx, "approval_waiting") }()
	}
	wg.Wait()
	live, cancel := context.WithCancelCause(ctx)
	cause := diagnosticCause("connector", "authorization_changed", context.Canceled)
	cancel(cause)
	cancel(errors.New("secret-token-and-private-path"))
	d.finish(context.Cause(live), errors.New("secret-token-and-private-path"), true)
	d.finish(context.Canceled, nil, false)
	got := readRunDiagnostics(t, f.journal, f.binding.RunID)
	if got.Cancellation.Source != "connector" || got.Cancellation.Reason != "authorization_changed" || !got.ProcessesStopped || !got.Finished || len(got.Observations) != 32 || got.Dropped != 8 || got.ExecutionError.Reason != "unclassified" {
		t.Fatalf("bounded evidence: %+v", got)
	}
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), "secret-token") {
		t.Fatal("raw error escaped")
	}
	// The original strict journal readers neither require nor parse the sidecar.
	if _, err := f.journal.Load(f.binding.RunID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.journal.directory, f.binding.RunID, "diagnostics.json"), []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.journal.List(); err != nil {
		t.Fatal("diagnostics changed recovery", err)
	}
}

func TestPeerDiagnosticsWriteFailureDoesNotChangeExecutionAuthority(t *testing.T) {
	d := &runDiagnostics{save: func([]byte) error { return errors.New("secret disk path") }}
	ctx := context.WithValue(context.Background(), runDiagnosticsKey{}, d)
	observeApproval(ctx, "approval_waiting")
	d.finish(context.Canceled, nil, true)
	if d.record.WriteFailures != 2 || !d.record.Finished {
		t.Fatal("best effort recording failed")
	}
}

func TestPeerDiagnosticsHTTPClassificationAndRedaction(t *testing.T) {
	for _, mode := range []string{"timeout", "transport", "status", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			f, now := readAdmissionFixture(t)
			signer, err := NewLocalSigner(f.LocalIdentity)
			if err != nil {
				t.Fatal(err)
			}
			client, err := NewClient("http://127.0.0.1:1", f.Joined.Human.Host, signer, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.Close()
			client.clock = func() time.Time { return now }
			client.http.Transport = peerRoundTrip(func(r *http.Request) (*http.Response, error) {
				if mode == "timeout" {
					return nil, context.DeadlineExceeded
				}
				if mode == "transport" {
					return nil, errors.New("secret credential at private path")
				}
				status := 503
				if mode == "invalid" {
					status = 200
				}
				return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("secret untrusted body")), Request: r}, nil
			})
			err = client.identity(context.Background(), "op_diagnostic001")
			got := classifyDiagnostic(diagnosticCause("authorization", "host_recheck", err))
			want := "transport_error"
			if mode == "timeout" {
				want = "timeout"
			}
			if mode == "status" {
				want = "http_status"
			}
			if mode == "invalid" {
				want = "response_invalid"
			}
			if got.Detail == nil || got.Detail.Source != "host_identity_http" || got.Detail.Reason != want {
				t.Fatalf("classification %+v", got)
			}
			expected := ErrTransport
			if mode == "invalid" {
				expected = ErrProof
			}
			if !errors.Is(err, expected) {
				t.Fatal("changed existing classification", err)
			}
			raw, _ := json.Marshal(got)
			if strings.Contains(string(raw), "secret") || strings.Contains(err.Error(), "secret") {
				t.Fatal("error leaked")
			}
			if mode == "status" && got.Detail.HTTPStatus != 503 {
				t.Fatal("lost HTTP status")
			}
		})
	}
}

func TestPeerDiagnosticsApprovalOutcomes(t *testing.T) {
	for _, mode := range []string{"allow", "deny", "expire", "disconnect", "recheck"} {
		t.Run(mode, func(t *testing.T) {
			d := &runDiagnostics{}
			parent := context.WithValue(context.Background(), runDiagnosticsKey{}, d)
			live, cancel := context.WithCancelCause(parent)
			defer cancel(context.Canceled)
			a := &Approvals{}
			defer a.Close()
			checks := 0
			session, err := a.Open(live, approvalBinding(), func(context.Context) error {
				checks++
				if mode == "recheck" && checks == 3 {
					return ErrExport
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			input := approvalInput(approvalBinding(), "approval_diagnostic001")
			if mode == "expire" {
				input.ExpiresAt = time.Now().Add(150 * time.Millisecond)
			}
			done := askApproval(live, session, input)
			view := waitApproval(t, a, input.RequestID)
			if mode == "disconnect" {
				cancel(diagnosticCause("runtime_connection", "read_failed_or_unexpected_message", context.Canceled))
			} else if mode != "expire" {
				decision := approvalDecision(view)
				decision.Allow = mode != "deny"
				if err := a.Decide(decision); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case result := <-done:
				if mode == "allow" || mode == "deny" {
					if result.err != nil || result.allow != (mode == "allow") {
						t.Fatal("decision changed")
					}
				} else if result.err == nil || result.allow {
					t.Fatal("invalid approval accepted")
				}
			case <-time.After(3 * time.Second):
				t.Fatal("approval did not end")
			}
			expected := map[string]string{"allow": "approval_allowed", "deny": "approval_denied", "expire": "approval_expired", "disconnect": "approval_interrupted", "recheck": "approval_recheck_failed"}[mode]
			if len(d.record.Observations) != 2 || d.record.Observations[0].Event != "approval_waiting" || d.record.Observations[1].Event != expected {
				t.Fatalf("approval evidence %+v", d.record.Observations)
			}
			if mode == "deny" && context.Cause(live) != nil {
				t.Fatal("denial incorrectly canceled run")
			}
		})
	}
}

func TestPeerDiagnosticsSocketFirstCauseSurvivesCleanup(t *testing.T) {
	for _, mode := range []string{"close", "invalid_ack"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				socket, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer socket.CloseNow()
				if mode == "invalid_ack" {
					_ = writeRuntimeMessage(r.Context(), socket, "peer.runtime.acknowledged", map[string]any{"schemaVersion": 1, "bindingDigest": strings.Repeat("a", 64), "sequence": 1}, time.Now())
					_, _, _ = socket.Read(r.Context())
				}
			}))
			defer server.Close()
			socket, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancelCause(context.Background())
			c := &RuntimeConnection{socket: socket, ctx: ctx, cancel: cancel, readDone: make(chan struct{}), acks: make(chan int64, 1), stop: func() bool { return true }}
			go c.read()
			defer c.Close()
			select {
			case <-ctx.Done():
			case <-time.After(3 * time.Second):
				t.Fatal("socket did not close")
			}
			c.Wait()
			c.Close()
			got := classifyDiagnostic(context.Cause(ctx))
			want := "read_failed_or_unexpected_message"
			if mode == "invalid_ack" {
				want = "invalid_acknowledgement"
			}
			if got.Source != "runtime_connection" || got.Reason != want || !errors.Is(context.Cause(ctx), context.Canceled) {
				t.Fatalf("first cause %+v", got)
			}
		})
	}
}

func TestPeerDiagnosticsFakeCodexCancellationDuringApproval(t *testing.T) {
	fixture, client, connectors, partition, binding := runExecutionFixture(t, "codex")
	parent, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	connection, err := client.ConnectRuntime(parent, connectors.store, partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	received, err := client.PollRuns(parent, connection, nil)
	if err != nil || received == nil {
		t.Fatal(err)
	}
	execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
	done := make(chan error, 1)
	go func() { done <- execution.execute(connection.Context()) }()
	// The fixture uses a test executable speaking app-server JSON, never Codex.
	deadline := time.Now().Add(8 * time.Second)
	for len(connectors.approvals.Pending()) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if len(connectors.approvals.Pending()) == 0 {
		connection.Close()
		<-done
		t.Fatal("fake Codex never requested approval")
	}
	fixture.control(t, map[string]any{"action": "drop-runtime"})
	select {
	case <-done:
	case <-parent.Done():
		t.Fatal("canceled fake child did not drain")
	}
	got := readRunDiagnostics(t, partition.Runs(), binding.RunID)
	if got.Cancellation == nil || got.Cancellation.Reason != "read_failed_or_unexpected_message" || !got.ProcessesStopped || !got.Finished {
		t.Fatalf("cancellation evidence %+v", got)
	}
	if len(got.Observations) != 2 || got.Observations[1].Event != "approval_interrupted" {
		t.Fatalf("pending approval evidence %+v", got)
	}
	record, err := partition.Runs().Load(binding.RunID)
	if err != nil || record.Outcome == nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(record.Outcome.Terminal), "CODEX_CANCELED") {
		t.Fatalf("expected unchanged generic error: %s", record.Outcome.Terminal)
	}
	source, _ := connectors.sources.Resolve(binding.LocalAgentID)
	if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "permission-test.txt")); !os.IsNotExist(err) {
		t.Fatal("cancellation permitted unapproved write")
	}
	// Recovery cannot start the fake Runtime again.
	if err := execution.execute(parent); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || strings.Count(string(raw), "started") != 1 {
		t.Fatal("cancellation replayed child", err)
	}
}

func TestPeerDiagnosticsHeartbeatTimeout(t *testing.T) {
	_, client, store, receipt, _ := runtimeTLSParticipant(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		socket, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer socket.CloseNow()
		// Consume heartbeat frames without acknowledging, until the participant closes.
		for {
			if _, _, err := socket.Read(r.Context()); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	socket, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	live, cancel := context.WithCancelCause(context.Background())
	connection := &RuntimeConnection{client: client, store: store, membershipID: receipt.Membership.MembershipID, digest: strings.Repeat("a", 64), socket: socket, ctx: live, cancel: cancel, readDone: make(chan struct{}), acks: make(chan int64, 1), stop: func() bool { return true }}
	go connection.read()
	defer connection.Close()
	ctx, stop := context.WithTimeout(context.Background(), 250*time.Millisecond)
	defer stop()
	if err := connection.Heartbeat(ctx); !errors.Is(err, ErrTransport) {
		t.Fatal("heartbeat error changed", err)
	}
	connection.Wait()
	got := classifyDiagnostic(context.Cause(live))
	if got.Source != "runtime_connection" || got.Reason != "heartbeat_timeout" {
		t.Fatalf("lost heartbeat cause %+v", got)
	}
}

func TestPeerDiagnosticsRemoteDenialRetainsOnlyContractCodes(t *testing.T) {
	f, now := readAdmissionFixture(t)
	signer, err := NewLocalSigner(f.LocalIdentity)
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewClient("http://127.0.0.1:1", f.Joined.Human.Host, signer, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	client.clock = func() time.Time { return now }
	client.http.Transport = peerRoundTrip(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 403, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"code":"REVOKED"}`)), Request: r}, nil
	})
	err = client.identity(context.Background(), "op_diagnostic001")
	var remote *RemoteError
	if !errors.As(err, &remote) || !publicationDenied(err) {
		t.Fatal("denial semantics changed", err)
	}
	got := classifyDiagnostic(err)
	if got.RemoteCode != "REVOKED" || got.HTTPStatus != 403 || got.Reason != "host_denied" {
		t.Fatalf("lost denial metadata %+v", got)
	}
	if _, err := time.Parse(time.RFC3339Nano, got.At); err != nil {
		t.Fatal("missing source timestamp", err)
	}
	unsafe := classifyDiagnostic(&RemoteError{Code: "secret-token-and-private-path"})
	raw, _ := json.Marshal(unsafe)
	if strings.Contains(string(raw), "secret-token") {
		t.Fatal("unrecognized code escaped")
	}
}
