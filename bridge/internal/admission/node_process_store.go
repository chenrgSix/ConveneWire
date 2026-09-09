package admission

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"

	peerwire "convenewire.dev/contracts/generated/go/peer"
)

const nodeProcessOwnerFile = "node-process-owner.json"

// NodeProcessOwner is local process-lifecycle ownership, not a Run permission.
// Node identity is supplied by the native installation holding the root lease.
type NodeProcessOwner struct {
	SchemaVersion int64  `json:"schemaVersion"`
	NodeID        string `json:"nodeId"`
	PublicKey     string `json:"publicKey"`
	LocalUserID   string `json:"localUserId"`
}

func validNodeProcessOwner(owner NodeProcessOwner) bool {
	if owner.SchemaVersion != 1 || !regexp.MustCompile(`^user_[A-Za-z0-9_-]{8,128}$`).MatchString(owner.LocalUserID) {
		return false
	}
	identity := peerwire.PeerNodeIdentity{NodeID: owner.NodeID, PublicKey: owner.PublicKey}
	raw, err := json.Marshal(identity)
	return err == nil && peerwire.Decode("PeerNodeIdentity", raw, &identity) == nil
}

// OpenNodeProcessStore requires a dedicated private directory. Its immutable
// binding prevents a changed Node identity from selecting an empty namespace
// and overlooking processes left behind by the original installation.
func OpenNodeProcessStore(ctx context.Context, dataDir string, owner NodeProcessOwner) (*GovernedProcessStore, error) {
	if !validNodeProcessOwner(owner) {
		return nil, ErrAdmissionInvalid
	}
	return openProcessStore(ctx, dataDir, Owner{}, &owner)
}

func bindNodeProcessOwner(root string, owner NodeProcessOwner) error {
	target := filepath.Join(root, nodeProcessOwnerFile)
	var previous NodeProcessOwner
	if err := readAdmission(target, &previous); err == nil {
		if previous != owner {
			return ErrAdmissionChanged
		}
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return ErrAdmissionChanged
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() != ".bridge-owner.lock" {
			return ErrAdmissionChanged
		}
	}
	raw, err := json.Marshal(owner)
	if err != nil {
		return ErrAdmissionInvalid
	}
	return writeExclusive(target, raw)
}

func (s *GovernedProcessStore) matchesProcessOwner(record governedProcessPreparedRecord) bool {
	if s.nodeOwner != nil {
		return record.Version == 4 && record.Owner == nil && record.NodeOwner != nil && *record.NodeOwner == *s.nodeOwner
	}
	return record.Version == 1 && record.NodeOwner == nil && record.Owner != nil && *record.Owner == s.owner
}

func requireNodeProcessNamespace(parent, name string) error {
	entries, err := os.ReadDir(parent)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return ErrAdmissionChanged
	}
	for _, entry := range entries {
		if entry.Name() != name || !entry.IsDir() {
			return ErrAdmissionChanged
		}
	}
	return nil
}
