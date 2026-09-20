package bridgecore

import (
	"context"
	"path/filepath"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/desktopcodex"
	"convenewire.dev/bridge/internal/identity"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

// Only the owning native shell can install the authenticated Hub control closure.
func (n *NativeNode) ConfigureDesktopHandoff(descriptor string, hub desktopcodex.HubControl) error {
	n.ownerMu.Lock()
	defer n.ownerMu.Unlock()
	if err := n.checkIdentity(); err != nil {
		return err
	}
	if n.desktop != nil {
		return nil
	}
	guardedHub := func(ctx context.Context, input localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
		if err := n.checkIdentity(); err != nil {
			return localwire.DesktopHandoffScope{}, err
		}
		return hub(ctx, input)
	}
	resolver := func(agentID string) (config.AgentConfig, error) {
		if err := n.checkIdentity(); err != nil {
			return config.AgentConfig{}, err
		}
		cfg, err := config.Load(filepath.Join(n.root, "bridge.json"))
		if err != nil {
			return config.AgentConfig{}, err
		}
		if err = n.checkConfiguration(cfg); err != nil {
			return config.AgentConfig{}, err
		}
		identities, err := identity.LoadOrCreate(cfg.DataDir, cfg.Agents)
		if err != nil {
			return config.AgentConfig{}, err
		}
		for _, agent := range cfg.Agents {
			if identities[agent.Name] == agentID {
				return agent, nil
			}
		}
		return config.AgentConfig{}, desktopcodex.ErrUnavailable
	}
	var err error
	n.desktop, err = desktopcodex.NewCoordinator(filepath.Join(n.root, "codex-adoptions"), n.identity.NodeID, descriptor, guardedHub, resolver)
	return err
}
func (n *NativeNode) DesktopHandoff() (*desktopcodex.Coordinator, error) {
	n.ownerMu.Lock()
	defer n.ownerMu.Unlock()
	if err := n.checkIdentity(); err != nil {
		return nil, err
	}
	if n.desktop == nil {
		return nil, desktopcodex.ErrUnavailable
	}
	return n.desktop, nil
}
