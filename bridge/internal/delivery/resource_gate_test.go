package delivery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	contracts "convenewire.dev/contracts/generated/go"
)

func waitResources(t *testing.T, g *ResourceGate, count int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		g.mu.Lock()
		n := len(g.waiting)
		g.mu.Unlock()
		if n == count {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("resource queue did not settle")
}
func TestResourceGateOrdersConflictsAndAllowsIndependentWorkAndQueueCancellation(t *testing.T) {
	root := t.TempDir()
	g := &ResourceGate{}
	ctx := context.Background()
	first, err := g.Acquire(ctx, LocalResource{"agent_local001", root})
	if err != nil {
		t.Fatal(err)
	}
	next := make(chan func(), 1)
	go func() {
		release, _ := g.Acquire(ctx, LocalResource{"agent_other001", filepath.Join(root, "child")})
		next <- release
	}()
	waitResources(t, g, 1)
	canceled, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { _, err := g.Acquire(canceled, LocalResource{"agent_local001", t.TempDir()}); done <- err }()
	waitResources(t, g, 2)
	cancel()
	if !errors.Is(<-done, context.Canceled) {
		t.Fatal("lost cancellation")
	}
	waitResources(t, g, 1)
	independent, err := g.Acquire(ctx, LocalResource{"agent_independent", t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	independent()
	select {
	case <-next:
		t.Fatal("overlapping Workspace started concurrently")
	default:
	}
	first()
	first()
	select {
	case release := <-next:
		release()
	case <-time.After(time.Second):
		t.Fatal("waiter never admitted")
	}
	waitResources(t, g, 0)
}

func TestPhysicalAliasesAndEarlierOverlappingWaiterCannotBeBypassed(t *testing.T) {
	parent := t.TempDir()
	child := filepath.Join(parent, "child")
	if err := os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(parent, alias); err != nil {
		t.Fatal(err)
	}
	resolved, err := CanonicalWorkspace(alias)
	if err != nil {
		t.Fatal(err)
	}
	actual, _ := CanonicalWorkspace(parent)
	if resolved != actual {
		t.Fatal("symlink remained a separate Workspace")
	}
	g := &ResourceGate{}
	ctx := context.Background()
	held, _ := g.Acquire(ctx, LocalResource{"agent_one", child})
	second := make(chan func(), 1)
	go func() { r, _ := g.Acquire(ctx, LocalResource{"agent_two", parent}); second <- r }()
	waitResources(t, g, 1)
	sibling := make(chan func(), 1)
	go func() {
		r, _ := g.Acquire(ctx, LocalResource{"agent_three", filepath.Join(parent, "sibling")})
		sibling <- r
	}()
	waitResources(t, g, 2)
	held()
	release := <-second
	select {
	case <-sibling:
		t.Fatal("bypassed earlier conflicting waiter")
	default:
	}
	release()
	(<-sibling)()
}

func TestAuthorityProofIsRecheckedAfterWaitingBeforeRuntimeStart(t *testing.T) {
	root := t.TempDir()
	g := &ResourceGate{}
	workspace := t.TempDir()
	canonical, _ := CanonicalWorkspace(workspace)
	held, _ := g.Acquire(context.Background(), LocalResource{"agent_local001", canonical})
	inbox, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	started := false
	checked := make(chan struct{}, 1)
	handler := Handler{Inbox: inbox, Gate: &MappedExecutionGate{Shared: g, Resources: map[string]LocalResource{"agent_projection001": {"agent_local001", canonical}}, Paths: map[string]string{"agent_projection001": workspace}},
		BeforeStart: func(context.Context) error {
			checked <- struct{}{}
			return errors.New("Device was revoked while waiting")
		}, OnNew: func(context.Context, Record, Sender) error { started = true; return nil }}
	request := contracts.RunRequestedMessage{Payload: contracts.RunRequestedPayload{RunID: "run_queued001", TraceID: "trace_queued001", TargetAgentID: "agent_projection001", IdempotencyKey: "idem_queued001"}}
	done := make(chan error, 1)
	go func() {
		done <- handler.Handle(context.Background(), request, func(context.Context, any) error { return nil })
	}()
	waitResources(t, g, 1)
	select {
	case <-checked:
		t.Fatal("proof happened before resource wait")
	default:
	}
	held()
	if err := <-done; err == nil {
		t.Fatal("ignored revoked authority")
	}
	if started {
		t.Fatal("started revoked Runtime")
	}
	<-checked
	if _, err := g.Acquire(context.Background(), LocalResource{"agent_local001", canonical}); err != nil {
		t.Fatal("failed to release resource")
	}
}
