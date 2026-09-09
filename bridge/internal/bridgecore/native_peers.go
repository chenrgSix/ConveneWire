package bridgecore

import (
	"context"
	"errors"
	"time"

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

func (n *NativeNode) newPeerConnectors(cfg config.Config, identities map[string]string) (*peer.Connectors, error) {
	store, err := n.peerStore()
	if err != nil {
		return nil, err
	}
	sources, err := peer.NewSources(cfg.Agents, identities)
	if err != nil {
		return nil, err
	}
	return peer.NewConnectors(store, sources, n.signer, n.checkIdentity)
}

// The native core owns both connector families. A Device setup/transport error
// retries only Device work; a Peer store/transport error stays in Peer status.
// Configuration replacement and native identity failure drain the whole epoch.
func runNativeConnectors(ctx context.Context, node *NativeNode, cfg config.Config, identities map[string]string,
	observer operations.Observer, device func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	peers, peerErr := node.newPeerConnectors(cfg, identities)
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
