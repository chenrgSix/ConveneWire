package peer

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"path/filepath"
	"sync/atomic"
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

var peerPiSessionID = flag.String("session-id", "", "offline Peer Pi session")
var peerPiSessionName = flag.String("name", "", "offline Peer Pi name")

type runtimeFactoryFixture struct {
	connectors *Connectors
	membership string
	binding    wire.PeerExecutionBinding
	request    bridgeruntime.Request
	workspace  string
	gate       *delivery.MappedExecutionGate
	processes  *admission.GovernedProcessStore
	root       string
	now        time.Time
}

func newRuntimeFactoryFixture(t *testing.T, kind string) runtimeFactoryFixture {
	t.Helper()
	t.Setenv("CONVENE_WIRE_PEER_RUNTIME_FIXTURE", kind)
	state, _, now := fixtureState(t)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	cfg := config.AgentConfig{Name: "Local writer", Role: "Reviewer", Adapter: kind, RuntimeKind: kind,
		Sandbox: "workspace-write", Workspace: t.TempDir(),
		Command:      []string{os.Args[0], "-test.run=^TestPeerRuntimeProcessFixture$", "--", "app-server"},
		EnvAllowlist: []string{"CONVENE_WIRE_PEER_RUNTIME_FIXTURE"}}
	id := "agent_runtimefactory001"
	sources, err := NewSources([]config.AgentConfig{cfg}, map[string]string{cfg.Name: id})
	if err != nil {
		t.Fatal(err)
	}
	participant := &Signer{identity: state.Participant, localUserID: state.LocalUserID}
	c, err := NewConnectors(store, sources, participant, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	c.clock = func() time.Time { return now }
	source, _ := sources.Resolve(id)
	entry, err := c.exporter.Prepare(state.Revision, fixtureExportRequest(state, source), now)
	if err != nil {
		t.Fatal(err)
	}
	state, _ = store.Read()
	host := &Signer{identity: wire.PeerNodeIdentity(state.Connections[0].Receipt.Invitation.Host), key: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))}
	record := fixtureAcceptance(t, state.Connections[0], entry.Offer, 1)
	membership := state.Connections[0].Receipt.Membership.MembershipID
	snapshot := signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer}, []AcceptanceRecord{record}, now)
	if err := c.exporter.installAcceptanceSnapshot(membership, snapshot, now); err != nil {
		t.Fatal(err)
	}
	partitions, err := NewRuntimePartitions(root, store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := delivery.CanonicalWorkspace(cfg.Workspace)
	if err != nil {
		t.Fatal(err)
	}
	gate := &delivery.MappedExecutionGate{Shared: &delivery.ResourceGate{},
		Resources: map[string]delivery.LocalResource{id: {AgentID: id, Workspace: workspace}}, Paths: map[string]string{id: cfg.Workspace}}
	processRoot := filepath.Join(root, "node-processes")
	if err := privatefs.EnsureDirectory(processRoot); err != nil {
		t.Fatal(err)
	}
	processes, err := admission.OpenNodeProcessStore(context.Background(), processRoot, admission.NodeProcessOwner{
		SchemaVersion: 1, NodeID: state.Participant.NodeID, PublicKey: state.Participant.PublicKey, LocalUserID: state.LocalUserID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.approvals.Close(); _ = processes.Close() })
	if err := c.BindRuntime(partitions, gate, processes); err != nil {
		t.Fatal(err)
	}
	a, g := record.Acceptance, entry.Offer.Grant
	binding := wire.PeerExecutionBinding{SchemaVersion: 1, AuthorityNodeID: a.AuthorityNodeID, ParticipantNodeID: a.ParticipantNodeID,
		PeerID: a.PeerID, TeamID: a.TeamID, RoomID: a.RoomIDS[0], RunID: "run_runtimefactory001", LocalAgentID: id,
		ProjectionAgentID: record.Projection.ProjectionAgentID, ExportID: g.ExportID, GrantRevision: g.Revision, GrantDigest: mustDigest(t, g),
		AcceptanceID: a.AcceptanceID, AcceptanceRevision: a.Revision, AcceptanceDigest: mustDigest(t, a), RequestDigest: mustDigest(t, "runtime fixture")}
	deadline := time.Now().Add(time.Minute)
	if !deadline.After(now) {
		deadline = now.Add(time.Minute)
	}
	request := bridgeruntime.Request{Run: contracts.RunRequestedPayload{RunID: binding.RunID, RoomID: binding.RoomID,
		TargetAgentID: binding.ProjectionAgentID, Instruction: "Offline Peer fixture", Deadline: deadline}}
	return runtimeFactoryFixture{c, membership, binding, request, cfg.Workspace, gate, processes, root, now}
}

func (f runtimeFactoryFixture) execute(ctx context.Context, current func(context.Context) error, emit bridgeruntime.EmitFunc) error {
	return f.connectors.ExecuteRuntime(ctx, f.membership, f.binding, f.request, current, emit)
}

func ignoreRuntimeEvent(context.Context, bridgeruntime.Event) error { return nil }

func TestPeerRuntimeFactorySharesPhysicalGateAndRechecksAfterQueue(t *testing.T) {
	for _, mode := range []string{"run", "Host unavailable", "withdraw", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			f := newRuntimeFactoryFixture(t, "generic")
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			// Simulate a Device projection borrowing the very same local resource.
			device := &delivery.MappedExecutionGate{Shared: f.gate.Shared,
				Resources: map[string]delivery.LocalResource{"device-projection": f.gate.Resources[f.binding.LocalAgentID]},
				Paths:     map[string]string{"device-projection": f.workspace}}
			release, err := device.Acquire(ctx, "device-projection")
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			checked := make(chan struct{}, 1)
			var calls atomic.Int32
			current := func(context.Context) error {
				if calls.Add(1) == 1 {
					checked <- struct{}{}
				} else if mode == "Host unavailable" {
					return errors.New("Host freshness unavailable")
				}
				return nil
			}
			done := make(chan error, 1)
			var reply string
			go func() {
				done <- f.execute(ctx, current, func(_ context.Context, event bridgeruntime.Event) error { reply += event.Reply; return nil })
			}()
			select {
			case <-checked:
			case err := <-done:
				t.Fatal("Run did not reach initial admission", err)
			case <-ctx.Done():
				t.Fatal("initial admission timed out")
			}
			if _, err := os.Stat(filepath.Join(f.workspace, "runtime-started")); !os.IsNotExist(err) {
				t.Fatal("Peer started while Device held physical resource")
			}
			if mode == "withdraw" {
				state, _ := f.connectors.store.Read()
				if _, err := f.connectors.exporter.Withdraw(state.Revision, f.membership, f.binding.ExportID, f.binding.GrantRevision,
					"op_runtimewithdraw001", f.now); err != nil {
					t.Fatal(err)
				}
			}
			if mode == "cancel" {
				cancel()
			}
			release()
			select {
			case err = <-done:
			case <-ctx.Done():
				select {
				case err = <-done:
				case <-time.After(time.Second):
					t.Fatal("queued Runtime did not drain")
				}
			}
			_, started := os.Stat(filepath.Join(f.workspace, "runtime-started"))
			if mode == "run" {
				if err != nil || started != nil || reply != "peer-completed" || calls.Load() < 2 {
					t.Fatal("actual Peer Runtime failed", err, started, reply, calls.Load())
				}
				// Durable Node process evidence, not only an in-memory dedup map.
				if err := f.execute(ctx, current, ignoreRuntimeEvent); err == nil {
					t.Fatal("completed Peer process was replayed")
				}
			} else if err == nil || !os.IsNotExist(started) {
				t.Fatal("lost authority started queued Runtime", err, started)
			}
			probe, stop := context.WithTimeout(context.Background(), time.Second)
			defer stop()
			unlock, err := device.Acquire(probe, "device-projection")
			if err != nil {
				t.Fatal("Runtime retained shared resource after teardown", err)
			}
			unlock()
		})
	}
}

func TestPeerRuntimeFactoryRejectsUnboundAndInheritedAuthority(t *testing.T) {
	f := newRuntimeFactoryFixture(t, "generic")
	for _, mode := range []string{"Host", "Peer", "Participant", "Team", "Room", "projection", "grant", "acceptance", "private", "Device", "Central", "governed", "no freshness"} {
		t.Run(mode, func(t *testing.T) {
			trial := f
			current := func(context.Context) error { return nil }
			switch mode {
			case "Host":
				trial.binding.AuthorityNodeID = "node_otherhost001"
			case "Peer":
				trial.binding.PeerID = "peer_otherpeer001"
			case "Participant":
				trial.binding.ParticipantNodeID = "node_otherlocal001"
			case "Team":
				trial.binding.TeamID = "team_otherteam001"
			case "Room":
				trial.binding.RoomID = "room_otherroom001"
				trial.request.Run.RoomID = trial.binding.RoomID
			case "projection":
				trial.binding.ProjectionAgentID = "agent_otherprojection001"
				trial.request.Run.TargetAgentID = trial.binding.ProjectionAgentID
			case "grant":
				trial.binding.GrantRevision++
			case "acceptance":
				trial.binding.AcceptanceRevision++
			case "private":
				value := true
				trial.request.Run.OwnerPrivateOutput = &value
			case "Device":
				trial.request.Run.DeviceTrust = &contracts.PayloadDeviceTrust{Mode: "full", Revision: 1}
			case "Central":
				trial.request.Run.CentralApproval = &contracts.PayloadCentralApproval{Revision: 1}
			case "governed":
				trial.request.Run.ContextManifest = &contracts.ContextManifest{Execution: &contracts.Execution{}}
			case "no freshness":
				current = nil
			}
			if trial.execute(context.Background(), current, ignoreRuntimeEvent) == nil {
				t.Fatal("unbound authority reached Runtime")
			}
		})
	}
	if _, err := os.Stat(filepath.Join(f.workspace, "runtime-started")); !os.IsNotExist(err) {
		t.Fatal("rejected input started a child")
	}
}

func TestPeerRuntimeFactoryUsesLocalConsoleApprovalAndPrivateSessions(t *testing.T) {
	for _, mode := range []string{"allow", "Host revoked while pending", "local withdraw while pending"} {
		t.Run(mode, func(t *testing.T) {
			f := newRuntimeFactoryFixture(t, "codex")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			var revoked atomic.Bool
			current := func(context.Context) error {
				if revoked.Load() {
					return errors.New("Host freshness unavailable")
				}
				return nil
			}
			done := make(chan error, 1)
			go func() { done <- f.execute(ctx, current, ignoreRuntimeEvent) }()
			var pending ApprovalView
			for pending.RequestID == "" && ctx.Err() == nil {
				views := f.connectors.Approvals().Pending()
				if len(views) == 1 {
					pending = views[0]
					break
				}
				select {
				case err := <-done:
					t.Fatal("Runtime exited before local approval", err)
				case <-time.After(5 * time.Millisecond):
				}
			}
			if pending.RequestID == "" || pending.Binding != f.binding {
				t.Fatal("Console approval lost exact Peer binding")
			}
			if _, err := os.Stat(filepath.Join(f.workspace, "permission-test.txt")); !os.IsNotExist(err) {
				t.Fatal("child wrote before local decision")
			}
			if mode == "Host revoked while pending" {
				revoked.Store(true)
			}
			if mode == "local withdraw while pending" {
				state, _ := f.connectors.store.Read()
				if _, err := f.connectors.exporter.Withdraw(state.Revision, f.membership, f.binding.ExportID, f.binding.GrantRevision,
					"op_approvalwithdraw001", f.now); err != nil {
					t.Fatal(err)
				}
			}
			if err := f.connectors.Approvals().Decide(approvalDecision(pending)); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-ctx.Done():
				t.Fatal("local approval did not drain child")
			}
			_, err := os.Stat(filepath.Join(f.workspace, "permission-test.txt"))
			if (mode == "allow") != (err == nil) {
				t.Fatal("post-approval authorization lost", err)
			}
			if len(f.connectors.Approvals().Pending()) != 0 || !errors.Is(f.connectors.Approvals().Decide(approvalDecision(pending)), ErrApproval) {
				t.Fatal("finished child retained approval")
			}
			if mode == "allow" {
				partition, err := f.connectors.runtime.partitions.Open(f.membership)
				if err != nil {
					t.Fatal(err)
				}
				files, err := os.ReadDir(filepath.Join(partition.DataDir(), "runtime-sessions"))
				if err != nil || len(files) != 1 {
					t.Fatal("actual Codex Session escaped Peer partition", err)
				}
				raw, err := os.ReadFile(filepath.Join(partition.DataDir(), "runtime-sessions", files[0].Name()))
				if err != nil || !bytes.Contains(raw, []byte("thread-peer-test")) {
					t.Fatal("Peer Session was not persisted", err)
				}
			}
		})
	}
}

// An offline child using the real Generic/Codex adapters and OS process tracker.
func TestPeerRuntimeProcessFixture(t *testing.T) {
	kind := os.Getenv("CONVENE_WIRE_PEER_RUNTIME_FIXTURE")
	if kind == "" {
		return
	}
	defer os.Exit(0)
	marker, err := os.OpenFile("runtime-started", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		os.Exit(4)
	}
	_, _ = marker.WriteString("started\n")
	_ = marker.Close()
	if kind == "pi" {
		if *peerPiSessionID == "" || *peerPiSessionName == "" {
			os.Exit(5)
		}
		_, _ = os.Stdout.WriteString("{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"Peer Pi completed.\"}],\"stopReason\":\"stop\"}}\n")
		return
	}
	if kind == "generic-hold" {
		for {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if kind == "generic-controlled" {
		if err := os.Mkdir("runtime-exclusive", 0700); err != nil {
			_ = os.WriteFile("runtime-overlapped", []byte("overlap"), 0600)
			os.Exit(6)
		}
		defer os.Remove("runtime-exclusive")
		for {
			if _, err := os.Stat("runtime-release"); err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		_, _ = os.Stdout.WriteString("peer-completed")
		return
	}
	if kind == "generic-clarification" {
		_, _ = os.Stdout.WriteString(`<agentroom-clarification>{"kind":"task","question":"Which region?","choices":["EU","US"]}</agentroom-clarification>`)
		return
	}
	if kind == "generic" {
		_, _ = os.Stdout.WriteString("peer-completed")
		return
	}
	encoder, scanner := json.NewEncoder(os.Stdout), bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message struct {
			ID     int            `json:"id"`
			Params map[string]any `json:"params"`
			Result map[string]any `json:"result"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(2)
		}
		switch message.ID {
		case 1:
			_ = encoder.Encode(map[string]any{"id": 1, "result": map[string]any{}})
		case 2:
			if message.Params["sandbox"] != "workspace-write" || message.Params["approvalPolicy"] != "on-request" || message.Params["approvalsReviewer"] != "user" {
				os.Exit(3)
			}
			_ = encoder.Encode(map[string]any{"id": 2, "result": map[string]any{"thread": map[string]string{"id": "thread-peer-test"}, "approvalPolicy": "on-request", "approvalsReviewer": "user"}})
		case 3:
			_ = encoder.Encode(map[string]any{"id": 3, "result": map[string]any{"turn": map[string]string{"id": "turn-peer-test"}}})
			cwd, _ := os.Getwd()
			_ = encoder.Encode(map[string]any{"id": 8, "method": "item/commandExecution/requestApproval", "params": map[string]any{
				"threadId": "thread-peer-test", "turnId": "turn-peer-test", "itemId": "command-peer-test", "environmentId": "local", "command": "write permission-test.txt", "cwd": cwd}})
		case 8:
			if message.Result["decision"] == "accept" {
				_ = os.WriteFile("permission-test.txt", []byte("approved"), 0600)
			}
			_ = encoder.Encode(map[string]any{"method": "item/completed", "params": map[string]any{"threadId": "thread-peer-test", "turnId": "turn-peer-test",
				"item": map[string]string{"id": "reply-peer-test", "type": "agentMessage", "text": "Peer approval completed."}}})
			_ = encoder.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": "thread-peer-test", "turn": map[string]string{"id": "turn-peer-test", "status": "completed"}}})
		}
	}
}
