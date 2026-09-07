package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/privatefs"
	contracts "convenewire.dev/contracts/generated/go"
)

type privateTestAdapter struct {
	events  []Event
	err     error
	calls   *int
	session **contracts.LogicalSessionRequest
}

func (a privateTestAdapter) Name() string { return "private-test" }
func (a privateTestAdapter) Capabilities() Capabilities {
	return Capabilities{SupportsStreaming: true, SupportsResume: true, SupportsInterrupt: true}
}
func (a privateTestAdapter) Execute(ctx context.Context, r Request, emit EmitFunc) error {
	if a.calls != nil {
		*a.calls++
	}
	if a.session != nil {
		*a.session = r.Run.Session
	}
	for _, event := range a.events {
		if err := emit(ctx, event); err != nil {
			return err
		}
	}
	return a.err
}
func privateStatus(status contracts.RunExecutionStatus) *contracts.RunExecutionStatus { return &status }
func TestPrivateOutputRetainsOnlyLocalCandidate(t *testing.T) {
	directory := t.TempDir()
	private := true
	sentinel := "PRIVATE_SOURCE_CANARY"
	native := &contracts.LogicalSessionRequest{}
	adapter := PrivateOutputAdapter{DataDir: directory, Inner: privateTestAdapter{session: &native, events: []Event{
		{Status: privateStatus(contracts.Working), Session: &contracts.LogicalSessionStatus{}},
		{Output: &OutputDelta{Content: sentinel}}, {Activity: &Activity{Content: sentinel}},
		{Reply: sentinel}, {Status: privateStatus(contracts.Completed)},
	}}}
	var sent []Event
	err := adapter.Execute(context.Background(), Request{Run: contracts.RunRequestedPayload{RunID: "run_private_test0001", OwnerPrivateOutput: &private, Session: &contracts.LogicalSessionRequest{}}}, func(_ context.Context, event Event) error { sent = append(sent, event); return nil })
	if err != nil {
		t.Fatal(err)
	}
	if native != nil {
		t.Fatal("native resume was forwarded")
	}
	encoded, _ := json.Marshal(sent)
	if strings.Contains(string(encoded), sentinel) || len(sent) != 2 || *sent[1].Status != contracts.Completed {
		t.Fatalf("unexpected transport: %s", encoded)
	}
	target, _ := PrivateCandidatePath(directory, "run_private_test0001")
	data, err := privatefs.ReadFile(target, 64<<10)
	if err != nil || string(data) != sentinel {
		t.Fatal("missing local candidate", err)
	}
	if adapter.Capabilities().SupportsResume || adapter.Capabilities().SupportsStreaming {
		t.Fatal("unsafe capabilities")
	}
}
func TestPrivateFailuresAndMismatchNeverExposeDetails(t *testing.T) {
	private := true
	for _, status := range []contracts.RunExecutionStatus{contracts.Failed, contracts.InputRequired, contracts.OutcomeUnknown, contracts.Completed} {
		t.Run(string(status), func(t *testing.T) {
			a := PrivateOutputAdapter{DataDir: t.TempDir(), Inner: privateTestAdapter{events: []Event{{Status: &status, Error: &contracts.ConveneWireError{Code: "SECRET", Message: "CANARY"}, Clarification: &contracts.TaskClarificationRequest{}}}}}
			var final Event
			if err := a.Execute(context.Background(), Request{Run: contracts.RunRequestedPayload{RunID: "run_private_failure0001", OwnerPrivateOutput: &private}}, func(_ context.Context, e Event) error { final = e; return nil }); err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(final)
			if strings.Contains(string(raw), "CANARY") || final.Clarification != nil || final.Error == nil || final.Error.Code != "PRIVATE_OUTPUT_WITHHELD" || *final.Status == contracts.Completed {
				t.Fatal(string(raw))
			}
		})
	}
	calls := 0
	a := PrivateOutputAdapter{DataDir: t.TempDir(), Inner: privateTestAdapter{calls: &calls, err: errors.New("PRIVATE_ERROR")}}
	if err := a.Execute(context.Background(), Request{}, func(context.Context, Event) error { return nil }); err == nil || calls != 0 {
		t.Fatal("mismatch started Runtime")
	}
}
func TestPrivateCandidateConcurrentAndSymlinkReplacementRejected(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	success := make(chan bool, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			success <- StorePrivateCandidate(dir, "run_private_race0001", []byte("one immutable candidate")) == nil
		}()
	}
	wg.Wait()
	close(success)
	count := 0
	for ok := range success {
		if ok {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("writers succeeded %d", count)
	}
	target, _ := PrivateCandidatePath(dir, "run_private_link0001")
	outside := filepath.Join(dir, "protected")
	os.WriteFile(outside, []byte("keep"), 0600)
	if err := os.Symlink(outside, target); err != nil {
		t.Skip(err)
	}
	if err := StorePrivateCandidate(dir, "run_private_link0001", []byte("overwrite")); err == nil {
		t.Fatal("followed symlink")
	}
	data, _ := os.ReadFile(outside)
	if string(data) != "keep" {
		t.Fatal("target overwritten")
	}
}
func TestPrivateModeChangesSessionFingerprint(t *testing.T) {
	cfg := config.AgentConfig{Workspace: t.TempDir(), RuntimeKind: "codex", Adapter: "codex"}
	normal, err := AgentRuntimeScopeID(cfg)
	if err != nil {
		t.Fatal(err)
	}
	cfg.OwnerPrivateOutput = true
	private, err := AgentRuntimeScopeID(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if private == normal {
		t.Fatal("private session can resume in ordinary mode")
	}
}

func TestPrivateStorageFailureNeverStartsRuntime(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocked, []byte("preserve"), 0600); err != nil {
		t.Fatal(err)
	}
	private, calls := true, 0
	a := PrivateOutputAdapter{DataDir: blocked, Inner: privateTestAdapter{calls: &calls}}
	var final Event
	err := a.Execute(context.Background(), Request{Run: contracts.RunRequestedPayload{
		RunID: "run_private_storage0001", OwnerPrivateOutput: &private,
	}}, func(_ context.Context, event Event) error { final = event; return nil })
	if err != nil || calls != 0 || final.Status == nil || *final.Status != contracts.Failed || final.Error == nil || final.Error.Code != "PRIVATE_OUTPUT_WITHHELD" {
		t.Fatalf("unsafe storage preflight: calls=%d event=%+v err=%v", calls, final, err)
	}
}
