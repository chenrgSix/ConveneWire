package peer

import (
	"regexp"

	"convenewire.dev/bridge/internal/config"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/peer"
)

// Sources is an immutable configuration epoch supplied by the owning core.
// Both review and execution resolve the same local IDs and restricted copy.
// No command, path, trust revision or capability is taken from a Host offer.
type Sources struct {
	agents map[string]config.AgentConfig
}

func NewSources(agents []config.AgentConfig, identities map[string]string) (*Sources, error) {
	s := &Sources{agents: map[string]config.AgentConfig{}}
	for _, agent := range agents {
		id := identities[agent.Name]
		if !regexp.MustCompile(`^agent_[A-Za-z0-9_-]{8,128}$`).MatchString(id) {
			return nil, ErrExport
		}
		if _, found := s.agents[id]; found {
			return nil, ErrExport
		}
		s.agents[id] = cloneSourceConfig(agent)
	}
	return s, nil
}

func (s *Sources) Resolve(localAgentID string) (ExportSource, error) {
	agent, found := s.agents[localAgentID]
	if !found || agent.OwnerPrivateOutput {
		return ExportSource{}, ErrExport
	}
	agent = cloneSourceConfig(agent)
	agent.AuthorityNodeID = ""
	agent.PeerRuntimeNamespace = ""
	agent.TrustedExecutionRevision, agent.CentralApprovalRevision = 0, 0
	var adapter bridgeruntime.Adapter
	switch {
	case agent.RuntimeKind == "pi":
		adapter = bridgeruntime.PiAdapter{Config: agent}
	case agent.Adapter == "codex":
		// Full Device trust never crosses into an Export. This exact restricted
		// configuration is what the Owner reviews and the Export digest pins.
		if agent.Sandbox == "" || agent.Sandbox == "danger-full-access" {
			agent.Sandbox = "workspace-write"
		}
		if agent.Sandbox != "workspace-write" && agent.Sandbox != "read-only" {
			return ExportSource{}, ErrExport
		}
		adapter = bridgeruntime.CodexAdapter{Config: agent}
	case agent.Adapter == "generic":
		adapter = bridgeruntime.GenericAdapter{Config: agent}
	default:
		return ExportSource{}, ErrExport
	}
	c := adapter.Capabilities()
	source := ExportSource{AgentID: localAgentID, Configuration: agent, Capabilities: wire.PeerCapabilities{
		SupportsStart: true, SupportsInterrupt: c.SupportsInterrupt, SupportsResume: c.SupportsResume,
		SupportsStreaming: c.SupportsStreaming, SupportsTaskContextIsolation: true,
	}}
	if err := validExportSource(source); err != nil {
		return ExportSource{}, err
	}
	return source, nil
}

func cloneSourceConfig(agent config.AgentConfig) config.AgentConfig {
	agent.Command = append([]string{}, agent.Command...)
	agent.EnvAllowlist = append([]string{}, agent.EnvAllowlist...)
	return agent
}
