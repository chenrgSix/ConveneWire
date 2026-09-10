package bridgecore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/peer"
)

func (n *NativeNode) PeerStatus() peer.ConnectorSnapshot {
	if n.checkIdentity() != nil {
		return peer.ConnectorSnapshot{State: "unavailable", ErrorCode: "NODE_IDENTITY_UNAVAILABLE", Connections: []peer.ConnectorStatus{}}
	}
	n.peerMu.Lock()
	defer n.peerMu.Unlock()
	if n.peers != nil {
		return n.peers.Snapshot()
	}
	state := "stopped"
	if n.peerError != "" {
		state = "unavailable"
	}
	return peer.ConnectorSnapshot{State: state, ErrorCode: n.peerError, Connections: []peer.ConnectorStatus{}}
}

func (n *NativeNode) PeerApprovals() ([]peer.ApprovalView, error) {
	if err := n.checkIdentity(); err != nil {
		return nil, err
	}
	n.peerMu.Lock()
	defer n.peerMu.Unlock()
	if n.peers == nil {
		return []peer.ApprovalView{}, nil
	}
	return n.peers.Approvals().Pending(), nil
}

func (n *NativeNode) DecidePeerApproval(decision peer.ApprovalDecision) error {
	if err := n.checkIdentity(); err != nil {
		return err
	}
	n.peerMu.Lock()
	defer n.peerMu.Unlock()
	if n.peers == nil {
		return peer.ErrApproval
	}
	return n.peers.Approvals().Decide(decision)
}

// The Console supplies its locked current local configuration, never an HTTP
// configuration payload. A read cannot create or rename stable Agent identities.
func (n *NativeNode) PeerExports(cfg config.Config) (*peer.Exporter, *peer.Sources, error) {
	if err := n.checkIdentity(); err != nil {
		return nil, nil, err
	}
	if cfg.LocalNodeID != n.identity.NodeID || cfg.DataDir != filepath.Join(n.root, "bridge") ||
		cfg.ServerURL != fmt.Sprintf("http://127.0.0.1:%d", n.identity.Port) {
		return nil, nil, errNativeNode
	}
	store, err := n.peerStore()
	if err != nil {
		return nil, nil, err
	}
	ids, err := authority.ReadLocalIdentities(cfg.DataDir, cfg.Agents)
	if err != nil {
		_, missing := os.Lstat(filepath.Join(cfg.DataDir, "agent-identities.json"))
		if len(cfg.Agents) != 0 || !errors.Is(missing, os.ErrNotExist) {
			return nil, nil, err
		}
		ids = map[string]string{}
	}
	sources, err := peer.NewSources(cfg.Agents, ids)
	if err != nil {
		return nil, nil, err
	}
	exporter, err := peer.NewExporter(store, sources.Resolve)
	return exporter, sources, err
}

func (n *NativeNode) PeerAuthorizationChanged(peerID string) {
	n.peerMu.Lock()
	defer n.peerMu.Unlock()
	if n.peers != nil {
		n.peers.LocalChange(peerID)
	}
}

func (n *NativeNode) PeerWithdrawal() (*peer.Exporter, error) {
	store, err := n.peerStore()
	if err != nil {
		return nil, err
	}
	return peer.NewExporter(store, func(string) (peer.ExportSource, error) { return peer.ExportSource{}, peer.ErrExport })
}

func (n *NativeNode) newPeerConnectors(cfg config.Config, identities map[string]string, resources *nativeResources) (*peer.Connectors, error) {
	store, err := n.peerStore()
	if err != nil {
		return nil, err
	}
	sources, err := peer.NewSources(cfg.Agents, identities)
	if err != nil {
		return nil, err
	}
	connectors, err := peer.NewConnectors(store, sources, n.signer, n.checkIdentity)
	if err != nil {
		return nil, err
	}
	partitions, err := n.peerPartitions()
	if err != nil || resources == nil {
		return nil, errNativeNode
	}
	if err := connectors.BindRuntime(partitions, resources.primary, resources.processes); err != nil {
		return nil, err
	}
	return connectors, nil
}

// The native core owns both connector families. A Device setup/transport error
// retries only Device work; a Peer store/transport error stays in Peer status.
// Configuration replacement and native identity failure drain the whole epoch.
func runNativeConnectors(ctx context.Context, node *NativeNode, cfg config.Config, identities map[string]string,
	resources *nativeResources, observer operations.Observer, device func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	peers, peerErr := node.newPeerConnectors(cfg, identities, resources)
	node.peerMu.Lock()
	if node.peers != nil {
		node.peerMu.Unlock()
		return errNativeNode
	}
	node.peers, node.peerError = peers, ""
	if peerErr != nil {
		node.peerError = "PEER_CONFIGURATION_UNAVAILABLE"
	}
	node.peerMu.Unlock()
	peerDone := make(chan struct{})
	go func() {
		defer close(peerDone)
		if peers != nil {
			_ = peers.Run(ctx)
		}
	}()
	deviceDone := make(chan error, 1)
	go func() {
		for ctx.Err() == nil {
			err := device(ctx)
			if errors.Is(err, connection.ErrConfigurationChanged) {
				deviceDone <- err
				return
			}
			if ctx.Err() != nil {
				break
			}
			observer.Connection(operations.ConnectionEvent{At: time.Now().UTC(), State: operations.ConnectionRetrying, Error: "Device connector unavailable"})
			timer := time.NewTimer(time.Second)
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
		}
		deviceDone <- nil
	}()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var result error
	deviceExited := false
loop:
	for {
		select {
		case <-ctx.Done():
			break loop
		case result = <-deviceDone:
			deviceExited = true
			break loop
		case <-ticker.C:
			if err := node.checkIdentity(); err != nil {
				result = err
				break loop
			}
		}
	}
	cancel()
	if !deviceExited {
		<-deviceDone
	}
	<-peerDone
	node.peerMu.Lock()
	if node.peers == peers {
		node.peers = nil
	}
	node.peerMu.Unlock()
	return result
}
