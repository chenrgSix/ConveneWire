package admission

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func nodeProcessStoreFixture(t *testing.T) (*GovernedProcessStore, string, NodeProcessOwner) {
	t.Helper()
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	owner := NodeProcessOwner{SchemaVersion: 1, NodeID: "node_processowner001", LocalUserID: "user_processowner001", PublicKey: strings.Repeat("A", 43)}
	store, err := OpenNodeProcessStore(context.Background(), directory, owner)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, directory, owner
}

func TestNodeProcessOwnershipRetainsRecoveryWithoutDeviceCredentials(t *testing.T) {
	store, directory, owner := nodeProcessStoreFixture(t)
	identity := governedProcessIdentityFixture()
	lease, err := store.PrepareProcess(identity)
	if err != nil || lease.InheritedLockFile() == nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(store.path(identity.RunID, governedProcessPrepared))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{`"owner":`, `"deviceId"`, `"serverUrl"`, `"teamId"`, `"ownerMemberId"`, directory} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("Node process inherited Device authority or local path")
		}
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenNodeProcessStore(context.Background(), directory, owner)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	if err := reopened.FenceAll(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := reopened.RequireFinished(identity); !errors.Is(err, ErrAdmissionChanged) {
		t.Fatal("abandonment became execution proof", err)
	}
	if _, err := reopened.PrepareProcess(identity); !errors.Is(err, ErrAdmissionConflict) {
		t.Fatal("possible-start identity reused", err)
	}
	view, err := reopened.get(identity.RunID)
	if err != nil || view.prepared.Version != 4 || view.prepared.Owner != nil || *view.prepared.NodeOwner != owner ||
		view.terminalStage != governedProcessAbandoned {
		t.Fatal("restored Node process evidence", err)
	}
}

func TestNodeProcessOwnerChangeMissingMarkerAndForeignNamespacesFailClosed(t *testing.T) {
	for _, mutation := range []string{"node", "user", "key", "missing marker", "Device", "foreign namespace", "live marker"} {
		t.Run(mutation, func(t *testing.T) {
			store, directory, owner := nodeProcessStoreFixture(t)
			if _, err := store.PrepareProcess(governedProcessIdentityFixture()); err != nil {
				t.Fatal(err)
			}
			if mutation == "live marker" {
				if err := os.Remove(filepath.Join(directory, nodeProcessOwnerFile)); err != nil {
					t.Fatal(err)
				}
				if err := store.FenceAll(context.Background()); !errors.Is(err, ErrAdmissionChanged) {
					t.Fatal(err)
				}
				return
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			switch mutation {
			case "node":
				owner.NodeID = "node_otherowner001"
			case "user":
				owner.LocalUserID = "user_otherowner001"
			case "key":
				owner.PublicKey = strings.Repeat("B", 42) + "A"
			case "missing marker":
				if err := os.Remove(filepath.Join(directory, nodeProcessOwnerFile)); err != nil {
					t.Fatal(err)
				}
			case "foreign namespace":
				if err := os.Mkdir(filepath.Join(directory, governedProcessDirectory, strings.Repeat("f", 64)), 0o700); err != nil {
					t.Fatal(err)
				}
			case "Device":
				_, err := OpenGovernedProcessStore(context.Background(), directory, Owner{ServerURL: "https://host.example", TeamID: "team_otherowner001", DeviceID: "device_otherowner001", OwnerMemberID: "member_otherowner001"})
				if !errors.Is(err, ErrAdmissionChanged) {
					t.Fatal("Node store reinterpreted as Device", err)
				}
				return
			}
			if _, err := OpenNodeProcessStore(context.Background(), directory, owner); !errors.Is(err, ErrAdmissionChanged) {
				t.Fatal("changed ownership overlooked process history", err)
			}
		})
	}
}

func TestNodePreparedRecordCannotMixOrReinterpretDeviceOwnership(t *testing.T) {
	for _, change := range []string{"mixed", "old version", "different node"} {
		t.Run(change, func(t *testing.T) {
			store, directory, owner := nodeProcessStoreFixture(t)
			identity := governedProcessIdentityFixture()
			if _, err := store.PrepareProcess(identity); err != nil {
				t.Fatal(err)
			}
			target := store.path(identity.RunID, governedProcessPrepared)
			raw, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			var record governedProcessPreparedRecord
			if err := json.Unmarshal(raw, &record); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "mixed":
				record.Owner = &Owner{ServerURL: "https://host.example", DeviceID: "device_otherowner001", TeamID: "team_otherowner001", OwnerMemberID: "member_otherowner001"}
			case "old version":
				record.Version = 1
			case "different node":
				record.NodeOwner.NodeID = "node_otherowner001"
			}
			raw, _ = json.Marshal(record)
			if err := os.WriteFile(target, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			reopened, err := OpenNodeProcessStore(context.Background(), directory, owner)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if err := reopened.FenceAll(context.Background()); !errors.Is(err, ErrAdmissionChanged) {
				t.Fatal("mixed process identity", err)
			}
		})
	}
}

func TestDeviceProcessRecordBytesAndNamespaceRemainCompatible(t *testing.T) {
	store, _, owner := governedProcessStoreFixture(t)
	identity := governedProcessIdentityFixture()
	lease, err := store.PrepareProcess(identity)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Abandon()
	raw, err := os.ReadFile(store.path(identity.RunID, governedProcessPrepared))
	if err != nil {
		t.Fatal(err)
	}
	// Decode through the pre-Peer record shape, then require byte-for-byte
	// equivalence: the existing prepared digest and namespace must not change.
	var original struct {
		Version    int    `json:"version"`
		Owner      Owner  `json:"owner"`
		Identity   any    `json:"identity"`
		LockDigest string `json:"lockDigest"`
		PreparedAt string `json:"preparedAt"`
	}
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	// Keep the original concrete identity field order instead of map ordering.
	encoded, _ := json.Marshal(struct {
		Version    int         `json:"version"`
		Owner      Owner       `json:"owner"`
		Identity   interface{} `json:"identity"`
		LockDigest string      `json:"lockDigest"`
		PreparedAt string      `json:"preparedAt"`
	}{original.Version, original.Owner, identity, original.LockDigest, original.PreparedAt})
	if string(encoded) != string(raw) || original.Owner != owner || original.Version != 1 {
		t.Fatal("legacy process bytes changed")
	}
	ownerJSON, _ := json.Marshal(owner)
	if filepath.Base(store.root) != digest(ownerJSON) {
		t.Fatal("legacy namespace changed")
	}
}

func TestNodeProcessStoreRejectsInvalidIdentityBeforeAcquiringOwner(t *testing.T) {
	store, directory, owner := nodeProcessStoreFixture(t)
	defer store.Close()
	for _, change := range []func(*NodeProcessOwner){
		func(o *NodeProcessOwner) { o.SchemaVersion = 2 },
		func(o *NodeProcessOwner) { o.NodeID = "device_processowner001" },
		func(o *NodeProcessOwner) { o.LocalUserID = "member_processowner001" },
		func(o *NodeProcessOwner) { o.PublicKey = strings.Repeat("A", 42) + "B" },
	} {
		invalid := owner
		change(&invalid)
		if _, err := OpenNodeProcessStore(context.Background(), directory, invalid); !errors.Is(err, ErrAdmissionInvalid) {
			t.Fatal("invalid identity passed validation or touched owner lease", err)
		}
	}
}
