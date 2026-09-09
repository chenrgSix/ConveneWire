package bridgecore

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/pairing"
	wire "convenewire.dev/contracts/generated/go/authority"
)

func TestExplicitProjectionSharesLocalIdentityWithoutCopyingTrustOrPrivateSession(t *testing.T) {
	root := t.TempDir()
	credential := pairing.Credential{ServerURL: "http://127.0.0.1:48121", TeamID: "team_primary001", DeviceID: "device_primary001", OwnerMemberID: "member_primary001", Token: "primary-secret"}
	cfg := config.Config{DataDir: root, ServerURL: credential.ServerURL, ServerToken: "primary-machine-secret", ShareReasoningSummaries: true,
		DeviceExecutionTrust: &config.DeviceExecutionTrust{Mode: "full", Revision: 5, ServerURL: credential.ServerURL, DeviceID: credential.DeviceID, OwnerMemberID: credential.OwnerMemberID},
		Agents:               []config.AgentConfig{{Name: "Owner Agent", Adapter: "codex", RuntimeKind: "codex", Workspace: t.TempDir(), Command: []string{"codex", "app-server"}, OwnerPrivateOutput: true}}}
	extra := pairing.Credential{ServerURL: "http://127.0.0.1:48122", TeamID: "team_secondary001", DeviceID: "device_secondary001", OwnerMemberID: "member_secondary001", Token: "secondary-secret"}
	source := filepath.Join(t.TempDir(), "issued")
	if err := pairing.Save(source, extra); err != nil {
		t.Fatal(err)
	}
	var connections wire.AuthorityConnectionsConfig
	raw, _ := json.Marshal(map[string]any{"schemaVersion": 1, "primary": map[string]string{"authorityNodeId": "node_primary001", "publicKey": strings.Repeat("a", 43), "serverOrigin": credential.ServerURL},
		"connectors": []any{map[string]any{"mode": "device", "pin": map[string]string{"authorityNodeId": "node_secondary001", "publicKey": strings.Repeat("b", 43), "serverOrigin": extra.ServerURL},
			"teamId": extra.TeamID, "deviceId": extra.DeviceID, "ownerMemberId": extra.OwnerMemberID, "label": "Other Host", "credentialDir": source,
			"projections": []any{map[string]string{"name": "Remote Alias", "localAgentId": "agent_local001", "projectionAgentId": "agent_remote001"}}}}})
	if err := wire.Decode("AuthorityConnectionsConfig", raw, &connections); err != nil {
		t.Fatal(err)
	}
	shared := &delivery.ResourceGate{}
	built, err := configureAuthorities(cfg, credential, map[string]string{"Owner Agent": "agent_local001"}, connections, shared)
	if err != nil {
		t.Fatal(err)
	}
	secondary := built[1]
	if secondary.gate.Shared != built[0].gate.Shared || secondary.gate.Resources["agent_remote001"].AgentID != "agent_local001" {
		t.Fatal("created a second execution identity")
	}
	if secondary.config.DeviceExecutionTrust != nil || secondary.config.ServerToken != "" || secondary.config.ShareReasoningSummaries || !secondary.config.Agents[0].OwnerPrivateOutput || secondary.config.Agents[0].AuthorityNodeID != "node_secondary001" {
		t.Fatal("copied consent, downgraded private output or reused native session scope")
	}
	if cfg.Agents[0].Name != "Owner Agent" || !cfg.Agents[0].OwnerPrivateOutput || cfg.Agents[0].AuthorityNodeID != "" {
		t.Fatal("mutated primary configuration")
	}
	connections.Connectors[0].Projections[0].LocalAgentID = "agent_unconfigured001"
	if _, err := configureAuthorities(cfg, credential, map[string]string{"Owner Agent": "agent_local001"}, connections, shared); err == nil {
		t.Fatal("admitted an unconfigured local Agent")
	}
}
