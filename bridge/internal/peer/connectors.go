package peer

import (
	"context"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// ConnectorStatus is safe for the authenticated local Console. Transport errors
// are classified here; credentials, HTTP bodies and local commands never enter it.
type ConnectorStatus struct {
	PeerID          string `json:"peerId"`
	MembershipID    string `json:"membershipId"`
	HostNodeID      string `json:"hostNodeId"`
	HostOrigin      string `json:"hostOrigin"`
	State           string `json:"state"`
	Attempt         int    `json:"attempt"`
	ErrorCode       string `json:"errorCode,omitempty"`
	ExportSyncError string `json:"exportSyncError,omitempty"`
}

type ConnectorSnapshot struct {
	State       string            `json:"state"`
	ErrorCode   string            `json:"errorCode,omitempty"`
	Connections []ConnectorStatus `json:"connections"`
}

type peerWorker struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	local  LocalConnection
	digest string
}

// Connectors owns the independent Peer lifetimes of one immutable core epoch.
// It never retries a Run or borrows a Device transport. Store changes can stop
// one Peer immediately; network loss and Export sync cannot stop other Peers.
type Connectors struct {
	store             *Store
	exporter          *Exporter
	approvals         *Approvals
	newClient         func(string, wire.PeerNodeIdentity) (*Client, error)
	clock             func() time.Time
	pollInterval      time.Duration
	heartbeatInterval time.Duration
	syncInterval      time.Duration
	retryInterval     time.Duration
	wake              chan struct{}
	started           atomic.Bool
	mu                sync.Mutex
	workers           map[string]*peerWorker
	statuses          map[string]ConnectorStatus
	state             string
	errorCode         string
	wg                sync.WaitGroup
	checkIdentity     func() error
}

func NewConnectors(store *Store, sources *Sources, signer *Signer, checkIdentity func() error) (*Connectors, error) {
	if store == nil || sources == nil || signer == nil || checkIdentity == nil || checkIdentity() != nil {
		return nil, ErrStore
	}
	state, err := store.Read()
	if err != nil || state.Participant != signer.Identity() || state.LocalUserID != signer.LocalUserID() {
		return nil, ErrStore
	}
	exporter, err := NewExporter(store, sources.Resolve)
	if err != nil {
		return nil, err
	}
	return &Connectors{store: store, exporter: exporter, approvals: &Approvals{}, clock: time.Now, checkIdentity: checkIdentity,
		pollInterval: time.Second, heartbeatInterval: 5 * time.Second, syncInterval: 10 * time.Second, retryInterval: time.Second,
		wake: make(chan struct{}, 1), workers: map[string]*peerWorker{}, statuses: map[string]ConnectorStatus{}, state: "stopped",
		newClient: func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
			return NewClient(origin, host, signer, nil)
		},
	}, nil
}

func (c *Connectors) Wake() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}
func (c *Connectors) Approvals() *Approvals { return c.approvals }

// An Owner mutation calls this only after persistence. Replaying an unchanged
// operation must not cancel a newer live epoch for the same Peer.
func (c *Connectors) LocalChange(peerID string) {
	defer c.Wake()
	state, err := c.store.Read()
	if err != nil {
		c.stopAll("unavailable", "PEER_STORAGE_UNAVAILABLE")
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	worker := c.workers[peerID]
	if worker == nil {
		return
	}
	for _, local := range state.Connections {
		if local.Receipt.Membership.PeerID == peerID && (local.State != "active" || peerAuthorizationDigest(local) != worker.digest) {
			worker.cancel()
			c.approvals.RevokePeer(peerID)
			return
		}
	}
}

func peerAuthorizationDigest(local LocalConnection) string {
	digest, _ := semanticDigest(map[string]any{"receipt": local.Receipt, "exports": local.Exports, "acceptances": local.Acceptances})
	return digest
}
func (c *Connectors) Snapshot() ConnectorSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	view := ConnectorSnapshot{State: c.state, ErrorCode: c.errorCode, Connections: []ConnectorStatus{}}
	for _, value := range c.statuses {
		view.Connections = append(view.Connections, value)
	}
	sort.Slice(view.Connections, func(i, j int) bool { return view.Connections[i].PeerID < view.Connections[j].PeerID })
	return view
}

func (c *Connectors) Run(ctx context.Context) error {
	if !c.started.CompareAndSwap(false, true) {
		return ErrConflict
	}
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()
	defer func() {
		c.stopAll("stopped", "")
		c.wg.Wait()
		c.approvals.Close()
	}()
	for ctx.Err() == nil {
		c.reconcile(ctx)
		select {
		case <-ctx.Done():
		case <-ticker.C:
		case <-c.wake:
		}
	}
	return nil
}

func (c *Connectors) stopAll(state, code string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state, c.errorCode = state, code
	for id, worker := range c.workers {
		worker.cancel()
		c.approvals.RevokePeer(id)
		view := c.statuses[id]
		view.State, view.ErrorCode = state, code
		c.statuses[id] = view
	}
}

func (c *Connectors) reconcile(ctx context.Context) {
	if c.checkIdentity() != nil {
		c.stopAll("unavailable", "NODE_IDENTITY_UNAVAILABLE")
		return
	}
	state, err := c.store.Read()
	if err != nil {
		c.stopAll("unavailable", "PEER_STORAGE_UNAVAILABLE")
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state, c.errorCode = "running", ""
	for id, worker := range c.workers {
		select {
		case <-worker.done:
			delete(c.workers, id)
		default:
		}
	}
	for _, local := range state.Connections {
		m := local.Receipt.Membership
		id := m.PeerID
		view := ConnectorStatus{PeerID: id, MembershipID: m.MembershipID, HostNodeID: m.HostNodeID,
			HostOrigin: local.Receipt.Invitation.HostOrigin, State: local.State}
		eligible := local.State == "active" && after(m.ExpiresAt, c.clock()) && after(local.Receipt.MachineCredential.ExpiresAt, c.clock())
		if local.State == "active" && !eligible {
			view.State = "expired"
		}
		// Proof snapshot refreshes are excluded; only immutable grant/acceptance
		// history changes invalidate a live execution/approval epoch.
		digest := peerAuthorizationDigest(local)
		if worker := c.workers[id]; worker != nil {
			if !eligible || worker.digest != digest {
				worker.cancel()
				c.approvals.RevokePeer(id)
				if eligible {
					view.State = "reconfiguring"
				}
				c.statuses[id] = view
			}
			continue // Drain the old lifetime before starting its replacement.
		}
		if !eligible {
			c.statuses[id] = view
			continue
		}
		workerCtx, cancel := context.WithCancel(ctx)
		worker := &peerWorker{ctx: workerCtx, cancel: cancel, done: make(chan struct{}), local: local, digest: digest}
		c.workers[id] = worker
		view.State = "connecting"
		c.statuses[id] = view
		c.wg.Add(1)
		go func() {
			defer c.wg.Done()
			defer close(worker.done)
			defer c.Wake()
			c.runWorker(worker)
		}()
	}
}

func (c *Connectors) update(worker *peerWorker, change func(*ConnectorStatus)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := worker.local.Receipt.Membership.PeerID
	if c.workers[id] != worker || worker.ctx.Err() != nil {
		return
	}
	view := c.statuses[id]
	change(&view)
	c.statuses[id] = view
}

func (c *Connectors) runWorker(worker *peerWorker) {
	local := worker.local
	id := local.Receipt.Membership.PeerID
	defer c.approvals.RevokePeer(id)
	client, err := c.newClient(local.Receipt.Invitation.HostOrigin, wire.PeerNodeIdentity(local.Receipt.Invitation.Host))
	if err != nil {
		c.update(worker, func(v *ConnectorStatus) { v.State, v.ErrorCode = "unavailable", "PEER_CLIENT_UNAVAILABLE" })
		// Await a real local change. A bad pinned identity must not hot-loop.
		<-worker.ctx.Done()
		return
	}
	defer client.Close()
	client.beforeOperation = c.checkIdentity
	for worker.ctx.Err() == nil {
		c.update(worker, func(v *ConnectorStatus) { v.State, v.ErrorCode = "connecting", ""; v.Attempt++ })
		connection, err := client.ConnectRuntime(worker.ctx, c.store, local.Receipt.Membership.MembershipID)
		if err == nil {
			c.update(worker, func(v *ConnectorStatus) { v.State, v.ErrorCode = "online", "" })
			c.serve(worker, client, connection)
			c.approvals.RevokePeer(id)
		}
		if worker.ctx.Err() != nil {
			return
		}
		c.update(worker, func(v *ConnectorStatus) { v.State, v.ErrorCode = "retrying", "PEER_RUNTIME_UNAVAILABLE" })
		timer := time.NewTimer(c.retryInterval)
		select {
		case <-worker.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (c *Connectors) serve(worker *peerWorker, client *Client, connection *RuntimeConnection) {
	defer connection.Wait()
	defer connection.Close()
	revoked := make(chan struct{})
	stop := context.AfterFunc(connection.Context(), func() {
		c.approvals.RevokePeer(connection.Binding().PeerID)
		close(revoked)
	})
	defer func() {
		if !stop() {
			<-revoked
		}
	}()
	syncDone := make(chan struct{})
	go func() {
		defer close(syncDone)
		ticker := time.NewTicker(c.syncInterval)
		defer ticker.Stop()
		for connection.Context().Err() == nil {
			c.syncExports(worker, client, connection.Context())
			select {
			case <-connection.Context().Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { connection.Close(); <-syncDone }()
	ticker := time.NewTicker(c.heartbeatInterval)
	defer ticker.Stop()
	for {
		select {
		case <-connection.Context().Done():
			return
		case <-ticker.C:
			if connection.Heartbeat(worker.ctx) != nil {
				return
			}
		}
	}
}

func (c *Connectors) syncExports(worker *peerWorker, client *Client, ctx context.Context) {
	state, err := c.store.Read()
	if err != nil {
		c.Wake()
		return
	}
	membershipID := worker.local.Receipt.Membership.MembershipID
	_, local, found := exportConnection(state, membershipID)
	if !found || local.State != "active" {
		c.Wake()
		return
	}
	ids := map[string]bool{}
	for _, entry := range local.LocalExports {
		ids[entry.Offer.Grant.LocalAgentID] = true
	}
	failed := false
	for id := range ids {
		if ctx.Err() != nil {
			return
		}
		nonce, err := NewNonce()
		if err == nil {
			_, err = client.SyncExports(ctx, c.exporter, membershipID, id, "op_"+nonce)
		}
		if err != nil {
			failed = true
		}
	}
	c.update(worker, func(v *ConnectorStatus) {
		v.ExportSyncError = ""
		if failed {
			v.ExportSyncError = "PEER_EXPORT_SYNC_UNAVAILABLE"
		}
	})
	c.Wake()
}
