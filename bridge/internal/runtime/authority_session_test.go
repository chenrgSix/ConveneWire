package runtime

import (
	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
	"testing"
)

func TestAuthorityNamespacesBothNativePiIdentityAndRuntimeSessionScope(t *testing.T) {
	cfg := config.AgentConfig{Name: "Local", Workspace: t.TempDir(), Adapter: "generic", RuntimeKind: "pi", PresetVersion: config.CurrentPresetVersion, Command: []string{"pi", "--mode", "json"}}
	request := contracts.RunRequestedPayload{RunID: "run_same0001", RoomID: "room_same0001", TargetAgentID: "agent_same0001"}
	legacy, ok, err := planRuntimeSession("pi", cfg, request)
	if err != nil || !ok {
		t.Fatal(err)
	}
	a := cfg
	a.AuthorityNodeID = "node_authority001"
	b := cfg
	b.AuthorityNodeID = "node_authority002"
	pa, _, err := planRuntimeSession("pi", a, request)
	if err != nil {
		t.Fatal(err)
	}
	pb, _, err := planRuntimeSession("pi", b, request)
	if err != nil {
		t.Fatal(err)
	}
	if pa.Key == pb.Key || pa.Key == legacy.Key || pa.ScopeID == pb.ScopeID || pa.ScopeID == legacy.ScopeID {
		t.Fatal("cross-Authority session scope collision")
	}
	if piSessionID(pa.Key, request.RunID) == piSessionID(pb.Key, request.RunID) || piSessionID(pa.Key, request.RunID) == piSessionID(legacy.Key, request.RunID) {
		t.Fatal("cross-Authority native Pi collision")
	}
	store := NewFileRuntimeSessionStore(t.TempDir())
	binding := RuntimeSessionBinding{SessionID: "private-native-session", RuntimeSessionKey: pa.Key}
	if err := store.Save(binding); err != nil {
		t.Fatal(err)
	}
	if _, found, err := store.Load(pb.Key); err != nil || found {
		t.Fatal("resumed another Authority", err)
	}
}
