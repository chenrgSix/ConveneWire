package peer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/privatefs"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func runExecutionFixture(t *testing.T, modes ...string) (*peerHTTPFixture, *Client, *Connectors, *RuntimePartition, wire.PeerExecutionBinding) {
	t.Helper()
	mode := "generic"
	if len(modes) != 0 {
		mode = modes[0]
	}
	t.Setenv("CONVENE_WIRE_PEER_RUNTIME_FIXTURE", mode)
	cfg := config.AgentConfig{Name: "Peer writer", Role: "Reviewer", Adapter: "generic", RuntimeKind: "generic", Sandbox: "workspace-write",
		Workspace: t.TempDir(), Command: []string{os.Args[0], "-test.run=^TestPeerRuntimeProcessFixture$"}, EnvAllowlist: []string{"CONVENE_WIRE_PEER_RUNTIME_FIXTURE"}}
	if mode == "codex" {
		cfg.Adapter, cfg.RuntimeKind = "codex", "codex"
		cfg.Command = append(cfg.Command, "--", "app-server")
	}
	if mode == "pi" {
		cfg.RuntimeKind, cfg.PresetVersion = "pi", config.CurrentPresetVersion
		cfg.Command = append(cfg.Command, "--")
	}
	if mode == "generic-burst" {
		cfg.OutputProtocol = config.OutputProtocolConveneWireJSONLV1
	}
	id := "agent_localexecution001"
	sources, err := NewSources([]config.AgentConfig{cfg}, map[string]string{cfg.Name: id})
	if err != nil {
		t.Fatal(err)
	}
	source, err := sources.Resolve(id)
	if err != nil {
		t.Fatal(err)
	}
	f, client, store, membership, binding, now := executionTLSFixtureSource(t, source, time.Now().UTC().Truncate(time.Millisecond))
	connectors, err := NewConnectors(store, sources, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	connectors.clock = func() time.Time { return now }
	root := filepath.Dir(store.directory)
	partitions, err := NewRuntimePartitions(root, store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := delivery.CanonicalWorkspace(cfg.Workspace)
	if err != nil {
		t.Fatal(err)
	}
	gate := &delivery.MappedExecutionGate{Shared: &delivery.ResourceGate{}, Resources: map[string]delivery.LocalResource{id: {AgentID: id, Workspace: workspace}}, Paths: map[string]string{id: cfg.Workspace}}
	processRoot := filepath.Join(root, "node-processes")
	if err := privatefs.EnsureDirectory(processRoot); err != nil {
		t.Fatal(err)
	}
	processes, err := admission.OpenNodeProcessStore(context.Background(), processRoot, admission.NodeProcessOwner{SchemaVersion: 1,
		NodeID: client.signer.Identity().NodeID, PublicKey: client.signer.Identity().PublicKey, LocalUserID: client.signer.LocalUserID()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { connectors.approvals.Close(); _ = processes.Close() })
	if err := connectors.BindRuntime(partitions, gate, processes); err != nil {
		t.Fatal(err)
	}
	partition, err := partitions.Open(membership)
	if err != nil {
		t.Fatal(err)
	}
	return f, client, connectors, partition, binding
}

func TestPeerRunExecutionSettlesRevocationAfterActualProcessStops(t *testing.T) {
	for _, mode := range []string{"Host revoke", "local leave", "Host cancel"} {
		t.Run(mode, func(t *testing.T) {
			f, client, connectors, partition, binding := runExecutionFixture(t, "generic-hold")
			connection, err := client.ConnectRuntime(context.Background(), connectors.store, partition.receipt.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			received, err := client.PollRuns(context.Background(), connection, nil)
			if err != nil || received == nil {
				t.Fatal(err)
			}
			execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			done := make(chan error, 1)
			finished := make(chan struct{})
			go func() { defer close(finished); done <- execution.execute(ctx) }()
			t.Cleanup(func() {
				cancel()
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("revoked execution did not drain")
				}
			})
			source, _ := connectors.sources.Resolve(binding.LocalAgentID)
			ticker := time.NewTicker(10 * time.Millisecond)
			defer ticker.Stop()
			for {
				if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-started")); err == nil {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("child did not start")
				case <-ticker.C:
				}
			}
			if mode == "Host revoke" {
				f.control(t, map[string]any{"action": "revoke", "membershipId": partition.receipt.MembershipID})
			} else if mode == "Host cancel" {
				f.control(t, map[string]any{"action": "cancel-run", "runId": binding.RunID})
			} else {
				state, _ := connectors.store.Read()
				state.Connections[0].State = "left"
				state.Revision++
				if err := connectors.store.Update(state.Revision-1, state, connectors.clock()); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal("revoked settlement", err)
				}
			case <-ctx.Done():
				t.Fatal("revocation did not drain child")
			}
			record, err := partition.Runs().Load(binding.RunID)
			if err != nil || record.Outcome == nil || record.Outcome.State != "canceled" {
				t.Fatalf("revoked local truth %+v, %v", record.Outcome, err)
			}
			diagnostic := readRunDiagnostics(t, partition.Runs(), binding.RunID)
			if diagnostic.Cancellation == nil || diagnostic.Cancellation.Source != "authorization" || !diagnostic.ProcessesStopped {
				t.Fatalf("lost revocation cause: %+v", diagnostic)
			}
			probe, stop := context.WithTimeout(context.Background(), time.Second)
			defer stop()
			release, err := connectors.runtime.gate.Acquire(probe, binding.LocalAgentID)
			if err != nil {
				t.Fatal("confirmed child retained resource", err)
			}
			release()
			var result struct {
				State                        string
				Events, Replies, Settlements int
			}
			f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
			if result.State != "canceled" || result.Replies != 0 || result.Settlements != 1 {
				t.Fatalf("revoked Host result %+v", result)
			}
		})
	}
}

func TestPeerRunExecutionRecoversLostTerminalAndPossibleStartWithoutReplay(t *testing.T) {
	for _, mode := range []string{"lost terminal", "possible start"} {
		t.Run(mode, func(t *testing.T) {
			f, client, connectors, partition, binding := runExecutionFixture(t)
			connection, err := client.ConnectRuntime(context.Background(), connectors.store, partition.receipt.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			received, err := client.PollRuns(context.Background(), connection, nil)
			if err != nil || received == nil {
				t.Fatal(err)
			}
			journal := partition.Runs()
			if _, err := journal.ReceiveDelivery(*received, connectors.clock()); err != nil {
				t.Fatal(err)
			}
			execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: journal, membership: partition.receipt.MembershipID, delivery: *received}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if mode == "possible start" {
				proof, err := client.AuthorizeExecution(ctx, connectors.store, partition.receipt.MembershipID, binding)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := journal.Begin(binding.RunID, proof, connectors.clock()); err != nil {
					t.Fatal(err)
				}
			} else {
				client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
					terminal := false
					if request.URL.Path == "/api/peer/runs/events" {
						raw, _ := io.ReadAll(request.Body)
						request.Body = io.NopCloser(strings.NewReader(string(raw)))
						terminal = strings.Contains(string(raw), `"status":"completed"`)
					}
					response, err := client.transport.RoundTrip(request)
					if err == nil && terminal {
						_ = response.Body.Close()
						return nil, io.ErrUnexpectedEOF
					}
					return response, err
				})
				if err := execution.execute(ctx); err == nil {
					t.Fatal("lost terminal acknowledged")
				}
				client.http.Transport = client.transport
			}
			partitions, err := NewRuntimePartitions(filepath.Dir(connectors.store.directory), connectors.store, func() error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			reopened, err := partitions.Open(partition.receipt.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			execution.journal = reopened.Runs()
			if err := execution.execute(ctx); err != nil {
				t.Fatal("recovery", err)
			}
			source, _ := connectors.sources.Resolve(binding.LocalAgentID)
			marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
			if mode == "possible start" && !os.IsNotExist(err) || mode == "lost terminal" && (err != nil || string(marker) != "started\n") {
				t.Fatal("replayed native child", string(marker), err)
			}
			var result struct {
				State                        string
				Events, Replies, Settlements int
			}
			f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
			want := "completed"
			if mode == "possible start" {
				want = "outcome_unknown"
			}
			if result.State != want || result.Settlements != 1 {
				t.Fatalf("recovered Host result %+v", result)
			}
		})
	}
}

func TestPeerRunExecutionRetainsClarificationWithoutCompletingTheHostRun(t *testing.T) {
	f, client, connectors, partition, binding := runExecutionFixture(t, "generic-clarification")
	connection, err := client.ConnectRuntime(context.Background(), connectors.store, partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	received, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || received == nil {
		t.Fatal(err)
	}
	execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := execution.execute(ctx); err != nil {
		t.Fatal(err)
	}
	record, err := partition.Runs().Load(binding.RunID)
	if err != nil || record.Outcome == nil || record.Outcome.State != "input_required" || !strings.Contains(string(record.Outcome.Terminal), "Which region?") {
		t.Fatalf("missing durable clarification: %+v, %v", record.Outcome, err)
	}
	// Reopen the native journal and replay only the already retained event.
	partitions, err := NewRuntimePartitions(filepath.Dir(connectors.store.directory), connectors.store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := partitions.Open(partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	execution.journal = reopened.Runs()
	if err := execution.execute(ctx); err != nil {
		t.Fatal("clarification recovery", err)
	}
	state, err := execution.journal.Transport(binding.RunID)
	if err != nil || state.Settlement != nil || state.Acknowledged() != int64(len(state.Events)) {
		t.Fatal("clarification became completion", err)
	}
	if _, err := execution.journal.PrepareSettlement(binding.RunID); err == nil {
		t.Fatal("business question used settlement capability")
	}
	var result struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
	if result.State != "input_required" || result.Replies != 0 || result.Settlements != 0 {
		t.Fatalf("Host lost human wait: %+v", result)
	}
}

func TestPeerRunEventProjectionKeepsNativeSessionPrivateAndRedactsNestedContent(t *testing.T) {
	completed := contracts.Completed
	scope := "private-provider-session"
	event := bridgeruntime.Event{Status: &completed, Session: &contracts.LogicalSessionStatus{ContextCursor: 1, RuntimeScopeID: &scope}}
	value := peerStatus(event)
	value["sequence"] = 3
	raw, err := marshalPeerEvent(value)
	var decoded any
	if err != nil || wire.Decode("PeerRunStatusEvent", raw, &decoded) != nil || strings.Contains(string(raw), "session") {
		t.Fatal("terminal session escaped", string(raw), err)
	}
	working := contracts.Working
	event.Status = &working
	event.Session.Disposition = contracts.Started
	value = peerStatus(event)
	value["sequence"] = 2
	raw, err = marshalPeerEvent(value)
	if err != nil || wire.Decode("PeerRunStatusEvent", raw, &decoded) != nil || strings.Contains(string(raw), scope) {
		t.Fatal("working session escaped", string(raw), err)
	}
	raw, err = marshalPeerEvent(map[string]any{"type": "reply", "sequence": 3, "content": "done", "assessment": map[string]any{"confidence": 0.875, "openQuestions": []any{map[string]any{"id": "question_001", "question": "token=very-sensitive", "importance": "blocking"}}}})
	if err != nil || strings.Contains(string(raw), "very-sensitive") || !strings.Contains(string(raw), "0.875") {
		t.Fatal("nested public content bypassed redaction")
	}
}

func TestPeerRunExecutionUsesActualHostAndRestrictedNativeChild(t *testing.T) {
	assertPeerRunUsesActualHostAndRestrictedNativeChild(t)
}

func assertPeerRunUsesActualHostAndRestrictedNativeChild(t *testing.T) {
	t.Helper()
	f, client, connectors, partition, binding := runExecutionFixture(t)
	store, membership := connectors.store, partition.receipt.MembershipID
	connection, err := client.ConnectRuntime(context.Background(), store, membership)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	received, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || received == nil {
		t.Fatal(err)
	}
	execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: membership, delivery: *received}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := execution.execute(ctx); err != nil {
		t.Fatal("actual Peer execution", err)
	}
	if err := execution.execute(ctx); err != nil {
		t.Fatal("completed recovery", err)
	}
	record, err := partition.Runs().Load(binding.RunID)
	if err != nil || record.Outcome == nil || record.Outcome.State != "completed" || record.Outcome.Reply != "peer-completed" {
		t.Fatalf("local outcome %+v, %v", record.Outcome, err)
	}
	diagnostic := readRunDiagnostics(t, partition.Runs(), binding.RunID)
	if diagnostic.Cancellation != nil || !diagnostic.ProcessesStopped || !diagnostic.Finished {
		t.Fatalf("success reported cancellation: %+v", diagnostic)
	}
	transport, err := partition.Runs().Transport(binding.RunID)
	if err != nil || transport.SettlementReceipt == nil || transport.Acknowledged() != int64(len(transport.Events)) {
		t.Fatal("transport did not close", err)
	}
	for _, raw := range transport.Events {
		var event map[string]any
		if json.Unmarshal(raw, &event) != nil {
			t.Fatal("event")
		}
		if event["deviceId"] != nil || event["runtimeScopeId"] != nil {
			t.Fatal("inherited authority escaped")
		}
	}
	var result struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
	if result.State != "completed" || result.Replies != 1 || result.Settlements != 1 {
		t.Fatalf("Host result %+v", result)
	}
}

func TestPeerRunWorkerPollsExecutesAndRecoversThroughRealConnection(t *testing.T) {
	f, client, connectors, partition, binding := runExecutionFixture(t)
	connectors.newClient = func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
		value, err := NewClient(origin, host, client.signer, f.roots)
		if err == nil {
			value.clock = connectors.clock
		}
		return value, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- connectors.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("Peer worker did not drain")
		}
	})
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			t.Fatal("automatic Peer execution", ctx.Err(), connectors.Snapshot())
		case <-ticker.C:
			record, err := partition.Runs().Load(binding.RunID)
			if err != nil || record.Outcome == nil {
				continue
			}
			state, err := partition.Runs().Transport(binding.RunID)
			if err != nil || state.SettlementReceipt == nil {
				continue
			}
			if record.Outcome.State != "completed" || record.Outcome.Reply != "peer-completed" {
				t.Fatalf("worker outcome %+v", record.Outcome)
			}
			var result struct {
				State                        string
				Events, Replies, Settlements int
			}
			f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
			if result.State != "completed" || result.Replies != 1 || result.Settlements != 1 {
				t.Fatalf("Host worker result %+v", result)
			}
			return
		}
	}
}
