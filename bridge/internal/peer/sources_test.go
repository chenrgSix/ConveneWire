package peer

import (
	"testing"

	"convenewire.dev/bridge/internal/config"
)

func TestNativeSourcesPinIndependentRestrictedCopiesAndActualAdapterCapabilities(t *testing.T) {
	local := fixtureExportSource()
	agent := local.Configuration
	agent.Adapter, agent.RuntimeKind = "codex", "codex"
	agent.Sandbox, agent.AuthorityNodeID = "danger-full-access", "node_deviceauthority001"
	agent.TrustedExecutionRevision, agent.CentralApprovalRevision = 8, 9
	agent.Command = []string{"codex", "app-server"}
	agent.EnvAllowlist = []string{"LOCAL_RUNTIME_KEY"}
	sources, err := NewSources([]config.AgentConfig{agent}, map[string]string{agent.Name: local.AgentID})
	if err != nil {
		t.Fatal(err)
	}
	agent.Command[0], agent.EnvAllowlist[0] = "changed", "CHANGED"
	source, err := sources.Resolve(local.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	cfg := source.Configuration
	if cfg.Command[0] != "codex" || cfg.EnvAllowlist[0] != "LOCAL_RUNTIME_KEY" || cfg.Sandbox != "workspace-write" ||
		cfg.AuthorityNodeID != "" || cfg.TrustedExecutionRevision != 0 || cfg.CentralApprovalRevision != 0 ||
		!source.Capabilities.SupportsResume || !source.Capabilities.SupportsStreaming || !source.Capabilities.SupportsInterrupt ||
		source.Capabilities.SupportsOwnerPrivateOutput {
		t.Fatal("Peer source inherited Device authority or caller mutations", source)
	}
	if agent.Sandbox != "danger-full-access" || agent.TrustedExecutionRevision != 8 {
		t.Fatal("Device policy was mutated")
	}
	source.Configuration.Command[0] = "remote-command"
	again, _ := sources.Resolve(local.AgentID)
	if again.Configuration.Command[0] != "codex" {
		t.Fatal("returned source mutated core epoch")
	}
	if _, err := sources.Resolve("agent_remoteprojection001"); err == nil {
		t.Fatal("Host projection selected a local executable")
	}
	for _, kind := range []string{"generic", "pi", "codex", "unknown", "private"} {
		t.Run(kind, func(t *testing.T) {
			a := fixtureExportSource().Configuration
			a.Adapter, a.RuntimeKind = kind, kind
			if kind == "private" {
				a.Adapter, a.RuntimeKind, a.OwnerPrivateOutput = "codex", "codex", true
			}
			s, err := NewSources([]config.AgentConfig{a}, map[string]string{a.Name: local.AgentID})
			if err != nil {
				t.Fatal(err)
			}
			got, err := s.Resolve(local.AgentID)
			if kind == "unknown" || kind == "private" {
				if err == nil {
					t.Fatal("unsupported source was exportable")
				}
				return
			}
			if err != nil || got.Capabilities.SupportsResume != (kind != "generic") || got.Capabilities.SupportsStreaming != (kind != "generic") {
				t.Fatal("capabilities did not match actual adapter", got, err)
			}
		})
	}
	if _, err := NewSources([]config.AgentConfig{agent}, nil); err == nil {
		t.Fatal("missing stable ID accepted")
	}
	if _, err := NewSources([]config.AgentConfig{agent, agent}, map[string]string{agent.Name: local.AgentID}); err == nil {
		t.Fatal("duplicate identity accepted")
	}
}

func TestNativeSourceEpochReplacementInvalidatesReviewedExport(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	local := fixtureExportSource()
	ids := map[string]string{local.Configuration.Name: local.AgentID}
	sources, _ := NewSources([]config.AgentConfig{local.Configuration}, ids)
	exporter, _ := NewExporter(store, sources.Resolve)
	source, _ := sources.Resolve(local.AgentID)
	request := fixtureExportRequest(state, source)
	if _, err := exporter.Prepare(1, request, now); err != nil {
		t.Fatal(err)
	}
	if _, err := exporter.Current(request.MembershipID, local.AgentID, now); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"command", "workspace", "capabilities", "private"} {
		t.Run(field, func(t *testing.T) {
			a := cloneSourceConfig(local.Configuration)
			switch field {
			case "command":
				a.Command[0] = "/different/runtime"
			case "workspace":
				a.Workspace = "/different/workspace"
			case "capabilities":
				a.OutputProtocol = config.OutputProtocolConveneWireJSONLV1
			case "private":
				a.OwnerPrivateOutput = true
			}
			next, _ := NewSources([]config.AgentConfig{a}, ids)
			e, _ := NewExporter(store, next.Resolve)
			if _, err := e.Current(request.MembershipID, local.AgentID, now); err == nil {
				t.Fatal("new epoch reused old grant")
			}
		})
	}
}
