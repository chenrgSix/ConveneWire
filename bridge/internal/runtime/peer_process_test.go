package runtime

import (
	"context"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
	peerwire "convenewire.dev/contracts/generated/go/peer"
)

func peerProcessBinding() peerwire.PeerExecutionBinding {
	return peerwire.PeerExecutionBinding{SchemaVersion: 1, AuthorityNodeID: "node_peerhost001", ParticipantNodeID: "node_peerlocal001",
		PeerID: "peer_process001", TeamID: "team_peerprocess001", RoomID: "room_peerprocess001", RunID: "run_peerprocess001",
		ProjectionAgentID: "agent_peerprojection001", LocalAgentID: "agent_peerlocal001", ExportID: "export_peerprocess001",
		GrantRevision: 1, GrantDigest: strings.Repeat("a", 64), AcceptanceID: "acceptance_peerprocess001", AcceptanceRevision: 1,
		AcceptanceDigest: strings.Repeat("b", 64), RequestDigest: strings.Repeat("c", 64)}
}

type peerProcessProbe struct {
	execute func(context.Context, Request) error
}

func (p peerProcessProbe) Name() string               { return "probe" }
func (p peerProcessProbe) Capabilities() Capabilities { return Capabilities{} }
func (p peerProcessProbe) Execute(ctx context.Context, request Request, _ EmitFunc) error {
	return p.execute(ctx, request)
}

func TestPeerProcessNamespacesIsolatePeersAndConflictOnChangedPins(t *testing.T) {
	binding := peerProcessBinding()
	request := Request{Run: contracts.RunRequestedPayload{RunID: binding.RunID, RoomID: binding.RoomID, TargetAgentID: binding.ProjectionAgentID, Instruction: "original"}}
	tracker := &governedProcessTrackerStub{}
	var captured GovernedProcessIdentity
	probe := peerProcessProbe{execute: func(ctx context.Context, _ Request) error {
		captured = ctx.Value(authorityProcessContextKey{}).(*authorityProcessContext).identity()
		return nil
	}}
	peer := PeerProcessAdapter{Adapter: probe, Tracker: tracker, Binding: binding}
	if err := peer.Execute(context.Background(), request, nil); err != nil {
		t.Fatal(err)
	}
	first := captured
	if err := peer.Execute(context.Background(), request, nil); err != nil || captured != first {
		t.Fatal("exact retry changed process identity", err)
	}
	changedContent := request
	changedContent.Run.Instruction = "replaced input"
	if err := peer.Execute(context.Background(), changedContent, nil); err != nil || captured.RunID != first.RunID || captured.AdmissionDigest == first.AdmissionDigest {
		t.Fatal("changed content escaped existing Run fence", err)
	}
	peer.Binding.PeerID = "peer_otherprocess001"
	if err := peer.Execute(context.Background(), request, nil); err != nil || captured.RunID == first.RunID {
		t.Fatal("two Peers shared process identity", err)
	}
	peer.Binding = binding
	peer.Binding.GrantRevision++
	peer.Binding.RequestDigest = strings.Repeat("d", 64)
	if err := peer.Execute(context.Background(), request, nil); err != nil || captured.RunID != first.RunID ||
		captured.StartDigest != first.StartDigest || captured.AdmissionDigest == first.AdmissionDigest {
		t.Fatal("changed pins escaped existing Run fence", err)
	}
	legacy := AuthorityProcessAdapter{Adapter: probe, Tracker: tracker, AuthorityNodeID: binding.AuthorityNodeID}
	if err := legacy.Execute(context.Background(), request, nil); err != nil || captured.RunID == first.RunID {
		t.Fatal("Peer borrowed Device process namespace", err)
	}
	for _, mutate := range []func(*Request){
		func(r *Request) { r.Run.RunID = "run_changed001" },
		func(r *Request) { r.Run.RoomID = "room_changed001" },
		func(r *Request) { r.Run.TargetAgentID = "agent_changed001" },
	} {
		changed := request
		mutate(&changed)
		if err := peer.Execute(context.Background(), changed, nil); err == nil {
			t.Fatal("wrong Runtime request entered Peer process")
		}
	}
	peer.Binding = binding
	peer.Binding.GrantRevision = 0
	if err := peer.Execute(context.Background(), request, nil); err == nil {
		t.Fatal("invalid execution binding accepted")
	}
}

func TestPeerRuntimeNamespaceSeparatesNativeSessionsWithinOneHost(t *testing.T) {
	cfg := config.AgentConfig{AuthorityNodeID: "node_peerhost001", Adapter: "generic", RuntimeKind: "pi", Command: []string{"pi"}, Workspace: t.TempDir()}
	request := contracts.RunRequestedPayload{RunID: "run_same0001", RoomID: "room_same0001", TargetAgentID: "agent_same0001"}
	device, _, err := planRuntimeSession("pi", cfg, request)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PeerRuntimeNamespace = strings.Repeat("a", 64)
	first, _, err := planRuntimeSession("pi", cfg, request)
	if err != nil {
		t.Fatal(err)
	}
	cfg.PeerRuntimeNamespace = strings.Repeat("b", 64)
	second, _, err := planRuntimeSession("pi", cfg, request)
	if err != nil {
		t.Fatal(err)
	}
	if device.Key == first.Key || first.Key == second.Key || first.ScopeID == second.ScopeID ||
		piSessionID(first.Key, request.RunID) == piSessionID(second.Key, request.RunID) {
		t.Fatal("Peer native session scope collision")
	}
	store := NewFileRuntimeSessionStore(t.TempDir())
	if err := store.Save(RuntimeSessionBinding{RuntimeSessionKey: first.Key, SessionID: "first-peer-only"}); err != nil {
		t.Fatal(err)
	}
	for _, key := range []RuntimeSessionKey{device.Key, second.Key} {
		if _, found, err := store.Load(key); err != nil || found {
			t.Fatal("another Peer or Device resumed private context", err)
		}
	}
}
