package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"convenewire.dev/bridge/internal/privatefs"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type runtimePartitionReceipt struct {
	SchemaVersion     int                   `json:"schemaVersion"`
	Host              wire.PeerNodeIdentity `json:"host"`
	HostOrigin        string                `json:"hostOrigin"`
	Participant       wire.PeerNodeIdentity `json:"participant"`
	LocalUserID       string                `json:"localUserId"`
	PeerID            string                `json:"peerId"`
	MembershipID      string                `json:"membershipId"`
	TeamID            string                `json:"teamId"`
	MemberID          string                `json:"memberId"`
	JoinReceiptDigest string                `json:"joinReceiptDigest"`
}

// RuntimePartitions keeps Peer-local execution/context state separate from
// Device authorities. Opening a partition grants no current execution rights.
type RuntimePartitions struct {
	mu            sync.Mutex
	root          string
	store         *Store
	checkIdentity func() error
	opened        map[string]*RuntimePartition
}

type RuntimePartition struct {
	directory string
	namespace string
	owner     *RuntimePartitions
	receipt   runtimePartitionReceipt
	journalMu sync.Mutex
	journal   *RunJournal
}

func NewRuntimePartitions(root string, store *Store, checkIdentity func() error) (*RuntimePartitions, error) {
	if store == nil || root != filepath.Dir(store.directory) || checkIdentity == nil || checkIdentity() != nil {
		return nil, ErrStore
	}
	if _, err := store.Read(); err != nil {
		return nil, err
	}
	return &RuntimePartitions{root: root, store: store, checkIdentity: checkIdentity, opened: map[string]*RuntimePartition{}}, nil
}

func partitionReceipt(state State, membershipID string) (runtimePartitionReceipt, error) {
	local, found := findConnection(state, membershipID)
	if !found {
		return runtimePartitionReceipt{}, ErrStore
	}
	digest, err := JoinReceiptDigest(local.Receipt)
	if err != nil {
		return runtimePartitionReceipt{}, err
	}
	m := local.Receipt.Membership
	return runtimePartitionReceipt{SchemaVersion: 1, Host: wire.PeerNodeIdentity(local.Receipt.Invitation.Host), HostOrigin: local.Receipt.Invitation.HostOrigin,
		Participant: state.Participant, LocalUserID: state.LocalUserID, PeerID: m.PeerID, MembershipID: m.MembershipID,
		TeamID: m.Scope.TeamID, MemberID: m.MemberID, JoinReceiptDigest: digest}, nil
}

func (s *RuntimePartitions) Open(membershipID string) (*RuntimePartition, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.checkIdentity(); err != nil {
		return nil, err
	}
	state, err := s.store.Read()
	if err != nil {
		return nil, err
	}
	receipt, err := partitionReceipt(state, membershipID)
	if err != nil {
		return nil, err
	}
	if prior := s.opened[membershipID]; prior != nil {
		if !equalJSON(prior.receipt, receipt) {
			return nil, ErrStore
		}
		return prior, prior.Check()
	}
	base := filepath.Join(s.root, "peer-runtime")
	if err := privatefs.EnsureDirectory(base); err != nil {
		return nil, err
	}
	directory := filepath.Join(base, receipt.PeerID)
	namespace, err := semanticDigest(receipt)
	if err != nil {
		return nil, err
	}
	partition := &RuntimePartition{directory: directory, namespace: namespace, owner: s, receipt: receipt}
	if _, err := os.Lstat(directory); os.IsNotExist(err) {
		raw, err := json.Marshal(receipt)
		if err != nil {
			return nil, err
		}
		if err := writePrivateState(directory, "receipt.json", raw); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, ErrStore
	}
	if err := partition.Check(); err != nil {
		return nil, err
	}
	s.opened[membershipID] = partition
	return partition, nil
}

// Check authenticates the local storage owner and immutable partition pins;
// current membership/Export/Acceptance and fresh Host admission remain required.
func (p *RuntimePartition) Check() error {
	if p == nil || p.owner == nil || p.owner.checkIdentity() != nil {
		return ErrStore
	}
	state, err := p.owner.store.Read()
	if err != nil {
		return err
	}
	expected, err := partitionReceipt(state, p.receipt.MembershipID)
	if err != nil || !equalJSON(expected, p.receipt) {
		return ErrStore
	}
	for _, directory := range []string{filepath.Join(p.owner.root, "peer-runtime"), p.directory} {
		if _, err := os.Lstat(directory); err != nil || privatefs.EnsureDirectory(directory) != nil {
			return ErrStore
		}
	}
	raw, err := privatefs.ReadFile(filepath.Join(p.directory, "receipt.json"), 8192)
	if err != nil {
		return ErrStore
	}
	digest, err := wire.Digest(raw)
	if err != nil || digest != p.namespace {
		return ErrStore
	}
	return nil
}

func (p *RuntimePartition) Sessions() bridgeruntime.RuntimeSessionStore {
	return peerRuntimeSessionStore{partition: p, inner: bridgeruntime.NewFileRuntimeSessionStore(p.directory)}
}

func (p *RuntimePartition) DataDir() string   { return p.directory }
func (p *RuntimePartition) Namespace() string { return p.namespace }

type peerRuntimeSessionStore struct {
	partition *RuntimePartition
	inner     bridgeruntime.RuntimeSessionStore
}

func (s peerRuntimeSessionStore) check() error {
	if err := s.partition.Check(); err != nil {
		return err
	}
	dir := filepath.Join(s.partition.directory, "runtime-sessions")
	if _, err := os.Lstat(dir); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return ErrStore
	}
	return privatefs.EnsureDirectory(dir)
}
func (s peerRuntimeSessionStore) Load(key bridgeruntime.RuntimeSessionKey) (bridgeruntime.RuntimeSessionBinding, bool, error) {
	if err := s.check(); err != nil {
		return bridgeruntime.RuntimeSessionBinding{}, false, err
	}
	return s.inner.Load(key)
}
func (s peerRuntimeSessionStore) Save(binding bridgeruntime.RuntimeSessionBinding) error {
	if err := s.check(); err != nil {
		return err
	}
	// Establish the Peer DACL before the generic Session store creates files.
	// MkdirAll/Chmod alone leaves inherited ACLs on Windows, which the next
	// Session operation correctly rejects. Existing invalid ACLs stay denied.
	if err := privatefs.EnsureDirectory(filepath.Join(s.partition.directory, "runtime-sessions")); err != nil {
		return err
	}
	return s.inner.Save(binding)
}
func (s peerRuntimeSessionStore) Delete(key bridgeruntime.RuntimeSessionKey) error {
	if err := s.check(); err != nil {
		return err
	}
	return s.inner.Delete(key)
}
