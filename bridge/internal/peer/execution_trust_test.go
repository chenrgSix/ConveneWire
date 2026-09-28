package peer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestPeerExecutionTrustDefaultPersistenceAndConflicts(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "generic")
	s := f.connectors.store
	trust, err := s.executionTrust(f.membership, f.now)
	if err != nil || !trust.Enabled || trust.Revision != 0 {
		t.Fatal("default", trust, err)
	}
	peerID, trust, err := f.connectors.exporter.SetExecutionTrust(f.membership, 0, false, f.now)
	if err != nil || peerID != f.binding.PeerID || trust.Enabled || trust.Revision != 1 {
		t.Fatal("disable", trust, err)
	}
	saved, _ := s.Read()
	reopened, err := OpenStore(f.root, saved.Participant, saved.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	retained, err := reopened.executionTrust(f.membership, f.now)
	if err != nil || retained != trust {
		t.Fatal("restart lost explicit off", retained, err)
	}
	if _, _, err = f.connectors.exporter.SetExecutionTrust(f.membership, 0, false, f.now); err != nil {
		t.Fatal("lost-response retry", err)
	}
	afterRetry, _ := s.Read()
	if afterRetry.Revision != saved.Revision {
		t.Fatal("retry changed state")
	}
	if _, _, err = f.connectors.exporter.SetExecutionTrust(f.membership, 0, true, f.now); !errors.Is(err, ErrConflict) {
		t.Fatal("stale enable accepted", err)
	}
	if _, _, err = f.connectors.exporter.SetExecutionTrust("peermember_other001", 1, true, f.now); err == nil {
		t.Fatal("foreign membership accepted")
	}
	for _, mutate := range []func(*LocalConnection){
		func(c *LocalConnection) { c.ExecutionTrust = nil },
		func(c *LocalConnection) { c.ExecutionTrust.Enabled = true },
		func(c *LocalConnection) { c.ExecutionTrust.Revision += 2 },
		func(c *LocalConnection) { c.Receipt.Invitation.Host.NodeID = "node_foreign001" },
	} {
		state, _ := s.Read()
		mutate(&state.Connections[0])
		state.Revision++
		if s.Update(state.Revision-1, state, f.now) == nil {
			t.Fatal("reset or foreign trust accepted")
		}
	}
	// Unrelated synchronization preserves the opt-out without adopting a global revision.
	state, _ := s.Read()
	state.Revision++
	if err := s.Update(state.Revision-1, state, f.now); err != nil {
		t.Fatal(err)
	}
	if _, trust, err = f.connectors.exporter.SetExecutionTrust(f.membership, 1, true, f.now); err != nil || !trust.Enabled || trust.Revision != 2 {
		t.Fatal("enable", trust, err)
	}
	state, _ = s.Read()
	state.Connections[0].State = "left"
	state.Revision++
	if err := s.Update(state.Revision-1, state, f.now); err != nil {
		t.Fatal(err)
	}
	if _, _, err = f.connectors.exporter.SetExecutionTrust(f.membership, 2, false, f.now); err == nil {
		t.Fatal("ended membership mutated")
	}
}

func TestPeerExecutionTrustCannotArriveInJoin(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	state.Connections[0].ExecutionTrust = &wire.PeerExecutionTrust{Enabled: true, Revision: 1}
	if store.Update(0, state, now) == nil {
		t.Fatal("join supplied local execution trust")
	}
}

func TestPeerExecutionTrustDefaultRunsCodexWithoutApproval(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "codex-full")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := f.execute(ctx, func(context.Context) error { return nil }, ignoreRuntimeEvent); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(f.workspace, "permission-test.txt"))
	if err != nil || string(content) != "trusted" || len(f.connectors.approvals.Pending()) != 0 {
		t.Fatal("full trust did not execute", err)
	}
	if _, _, err := f.connectors.exporter.SetExecutionTrust(f.membership, 0, false, f.now); err != nil {
		t.Fatal(err)
	}
	_ = f.execute(ctx, func(context.Context) error { return nil }, ignoreRuntimeEvent)
	started, err := os.ReadFile(filepath.Join(f.workspace, "runtime-started"))
	if err != nil || string(started) != "started\n" {
		t.Fatal("mode change replayed completed Run", string(started), err)
	}
}

func TestPeerExecutionTrustChangesWhileWaitingForHost(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "codex-full")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := f.execute(ctx, func(context.Context) error {
		_, _, err := f.connectors.exporter.SetExecutionTrust(f.membership, 0, false, f.now)
		return err
	}, ignoreRuntimeEvent)
	if err == nil {
		t.Fatal("stale permission started after Host wait")
	}
	if _, err := os.Stat(filepath.Join(f.workspace, "runtime-started")); !os.IsNotExist(err) {
		t.Fatal("child launched", err)
	}
}

func TestPeerExecutionTrustRetiresOnlyChangedConnectorAndApproval(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "generic")
	c := f.connectors
	state, _ := c.store.Read()
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(context.Canceled)
	other, stopOther := context.WithCancelCause(context.Background())
	defer stopOther(context.Canceled)
	c.workers[f.binding.PeerID] = &peerWorker{ctx: ctx, cancel: cancel, digest: peerAuthorizationDigest(state.Connections[0])}
	c.workers["peer_unrelated001"] = &peerWorker{ctx: other, cancel: stopOther, digest: "unrelated"}
	session, err := c.approvals.Open(ctx, f.binding, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	input := approvalInput(f.binding, "approval_trustchange001")
	decision := askApproval(ctx, session, input)
	pending := waitApproval(t, c.approvals, input.RequestID)
	c.LocalChange(f.binding.PeerID)
	if ctx.Err() != nil {
		t.Fatal("unchanged preference canceled worker")
	}
	if _, _, err := c.exporter.SetExecutionTrust(f.membership, 0, false, f.now); err != nil {
		t.Fatal(err)
	}
	c.LocalChange(f.binding.PeerID)
	if ctx.Err() == nil || other.Err() != nil {
		t.Fatal("wrong connector canceled")
	}
	select {
	case result := <-decision:
		if result.allow || result.err == nil {
			t.Fatal("old approval survived")
		}
	case <-time.After(time.Second):
		t.Fatal("pending approval not canceled")
	}
	if c.approvals.Decide(approvalDecision(pending)) == nil {
		t.Fatal("retired approval accepted")
	}
}

func TestPeerExecutionTrustSeparatesSessionsAcrossModeEpochs(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "codex-full")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	current := func(context.Context) error { return nil }
	if err := f.execute(ctx, current, ignoreRuntimeEvent); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.connectors.exporter.SetExecutionTrust(f.membership, 0, false, f.now); err != nil {
		t.Fatal(err)
	}
	f.binding.RunID = "run_trustrestricted001"
	f.request.Run.RunID = f.binding.RunID
	t.Setenv("CONVENE_WIRE_PEER_RUNTIME_FIXTURE", "codex")
	done, finished := make(chan error, 1), make(chan struct{})
	go func() { defer close(finished); done <- f.execute(ctx, current, ignoreRuntimeEvent) }()
	t.Cleanup(func() { cancel(); <-finished })
	var pending ApprovalView
	for pending.RequestID == "" {
		if views := f.connectors.approvals.Pending(); len(views) == 1 {
			pending = views[0]
			break
		}
		select {
		case err := <-done:
			t.Fatal("restricted execution did not ask", err)
		case <-ctx.Done():
			t.Fatal("approval timed out")
		case <-time.After(5 * time.Millisecond):
		}
	}
	decision := approvalDecision(pending)
	decision.Allow = false
	if err := f.connectors.approvals.Decide(decision); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("denied execution did not drain")
	}
	content, err := os.ReadFile(filepath.Join(f.workspace, "permission-test.txt"))
	if err != nil || string(content) != "trusted" {
		t.Fatal("restricted execution ignored denial", string(content), err)
	}
	if _, _, err := f.connectors.exporter.SetExecutionTrust(f.membership, 1, true, f.now); err != nil {
		t.Fatal(err)
	}
	f.binding.RunID = "run_trustreenabled001"
	f.request.Run.RunID = f.binding.RunID
	t.Setenv("CONVENE_WIRE_PEER_RUNTIME_FIXTURE", "codex-full")
	if err := f.execute(ctx, current, ignoreRuntimeEvent); err != nil {
		t.Fatal(err)
	}
	partition, err := f.connectors.runtime.partitions.Open(f.membership)
	if err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(filepath.Join(partition.DataDir(), "runtime-sessions"))
	if err != nil || len(files) != 3 {
		t.Fatal("permission epochs reused a native Session", len(files), err)
	}
}

func TestPeerExecutionTrustStopsRunningCodexAndSettlesWithoutReplay(t *testing.T) {
	_, client, connectors, partition, binding := runExecutionFixture(t, "codex-full-hold")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	connection, err := client.ConnectRuntime(ctx, connectors.store, partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	received, err := client.PollRuns(ctx, connection, nil)
	if err != nil || received == nil {
		t.Fatal("delivery", err)
	}
	execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
	done, finished := make(chan error, 1), make(chan struct{})
	go func() { defer close(finished); done <- execution.execute(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Error("child did not drain")
		}
	})
	source, _ := connectors.sources.Resolve(binding.LocalAgentID)
	for {
		if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "permission-test.txt")); err == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatal("child ended early", err)
		case <-ctx.Done():
			t.Fatal("child did not start")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if _, _, err := connectors.exporter.SetExecutionTrust(partition.receipt.MembershipID, 0, false, connectors.clock()); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal("settlement", err)
		}
	case <-ctx.Done():
		t.Fatal("trust change did not stop child")
	}
	record, err := partition.Runs().Load(binding.RunID)
	if err != nil || record.Outcome == nil || record.Outcome.State == "completed" {
		t.Fatal("process cleanup", record.Outcome, err)
	}
	if len(connectors.approvals.Pending()) != 0 {
		t.Fatal("unexpected approval")
	}
	if err := execution.execute(ctx); err != nil {
		t.Fatal("settlement recovery", err)
	}
	started, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || string(started) != "started\n" {
		t.Fatal("canceled Run replayed", string(started), err)
	}
	release, err := connectors.runtime.gate.Acquire(ctx, binding.LocalAgentID)
	if err != nil {
		t.Fatal("child retained physical resource", err)
	}
	release()
}
