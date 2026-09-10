package bridgecore

import "convenewire.dev/bridge/internal/peer"

func (n *NativeNode) PeerOwnerAccess() (peer.OwnerOperations, error) {
	if err := n.checkIdentity(); err != nil {
		return nil, err
	}
	n.ownerMu.Lock()
	defer n.ownerMu.Unlock()
	if err := n.checkIdentity(); err != nil {
		return nil, err
	}
	if !n.ownerAccessInitialized {
		n.ownerAccessInitialized = true
		store, err := n.peerStore()
		if err == nil {
			n.ownerAccess, err = peer.NewOwnerAccess(n.root, store, n.signer, n.checkIdentity)
		}
		n.ownerAccessError = err
	}
	if n.ownerAccessError != nil {
		return nil, n.ownerAccessError
	}
	return n.ownerAccess, nil
}

// Called by the native shell before releasing the installation lease. A core
// restart leaves Owner operations available; closing the installation does not.
func (n *NativeNode) Close() {
	if n == nil {
		return
	}
	n.closed.Store(true)
	n.ownerMu.Lock()
	defer n.ownerMu.Unlock()
	if n.ownerAccess != nil {
		n.ownerAccess.Close()
	}
}
