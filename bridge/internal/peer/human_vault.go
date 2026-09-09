package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type localHumanBinding struct {
	Receipt HumanReceipt `json:"receipt"`
	State   string       `json:"state"`
}
type humanVaultState struct {
	SchemaVersion int64                 `json:"schemaVersion"`
	Participant   wire.PeerNodeIdentity `json:"participant"`
	LocalUserID   string                `json:"localUserId"`
	Revision      int64                 `json:"revision"`
	Bindings      []localHumanBinding   `json:"bindings"`
}

// HumanVault is opened only by local Owner join/entry actions, never by a Runtime
// connector. Its receipts remain separate from the Runtime-only peer-state file.
type HumanVault struct {
	mu        *sync.Mutex
	directory string
	runtime   *Store
	observed  int64
}

func OpenHumanVault(root string, runtime *Store) (*HumanVault, error) {
	if runtime == nil || filepath.Clean(root) != filepath.Dir(runtime.directory) || privatefs.EnsureDirectory(root) != nil {
		return nil, ErrStore
	}
	directory := filepath.Join(root, "peer-human")
	lock, _ := storeLocks.LoadOrStore(directory, &sync.Mutex{})
	vault := &HumanVault{mu: lock.(*sync.Mutex), directory: directory, runtime: runtime}
	vault.mu.Lock()
	defer vault.mu.Unlock()
	if _, _, err := vault.read(); err != nil {
		return nil, err
	}
	return vault, nil
}
func (v *HumanVault) read() (humanVaultState, State, error) {
	runtime, err := v.runtime.Read()
	if err != nil {
		return humanVaultState{}, State{}, err
	}
	if _, err = os.Lstat(v.directory); os.IsNotExist(err) {
		if v.observed != 0 {
			return humanVaultState{}, State{}, ErrStore
		}
		return humanVaultState{SchemaVersion: 1, Participant: runtime.Participant, LocalUserID: runtime.LocalUserID, Bindings: []localHumanBinding{}}, runtime, nil
	} else if err != nil || privatefs.EnsureDirectory(v.directory) != nil {
		return humanVaultState{}, State{}, ErrStore
	}
	raw, err := privatefs.ReadFile(filepath.Join(v.directory, "state.json"), wire.MaximumJSONBytes)
	var state humanVaultState
	if err != nil || wire.Decode("PeerHumanVaultState", raw, &state) != nil || state.Participant != runtime.Participant ||
		state.LocalUserID != runtime.LocalUserID || state.Revision < v.observed {
		return humanVaultState{}, State{}, ErrStore
	}
	seen := map[string]bool{}
	for _, binding := range state.Bindings {
		membershipID := binding.Receipt.HumanCredential.MembershipID
		connection, ok := findConnection(runtime, membershipID)
		if !ok || seen[membershipID] || validateHumanReceipt(binding.Receipt, connection.Receipt, runtime.Participant, runtime.LocalUserID) != nil {
			return humanVaultState{}, State{}, ErrStore
		}
		seen[membershipID] = true
	}
	v.observed = state.Revision
	return state, runtime, nil
}

// Bind follows durable Runtime receipt storage; retries preserve the first human
// receipt and can never reverse local withdrawal. The new response must be fresh.
func (v *HumanVault) Bind(joined Joined, now time.Time) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	state, runtime, err := v.read()
	if err != nil {
		return err
	}
	connection, ok := findConnection(runtime, joined.Runtime.Membership.MembershipID)
	if !ok || connection.State != "active" {
		return ErrStore
	}
	before, err := JoinReceiptDigest(connection.Receipt)
	if err != nil {
		return err
	}
	after, err := JoinReceiptDigest(joined.Runtime)
	if err != nil || before != after || VerifyJoined(joined, connection.Receipt.Invitation, runtime.Participant, runtime.LocalUserID,
		connection.Receipt.Proof.Payload.OperationID, joined.Runtime.Proof.Payload.Nonce, now) != nil {
		return ErrStore
	}
	for _, binding := range state.Bindings {
		if binding.Receipt.HumanCredential.MembershipID == joined.Runtime.Membership.MembershipID {
			oldDigest, err := HumanReceiptDigest(binding.Receipt)
			if err != nil {
				return err
			}
			newDigest, err := HumanReceiptDigest(joined.Human)
			if err != nil || oldDigest != newDigest || binding.State != "active" {
				return ErrStore
			}
			return nil
		}
	}
	state.Bindings = append(state.Bindings, localHumanBinding{Receipt: joined.Human, State: "active"})
	return v.write(state)
}

// LoadForEntry is an explicit authenticated local Owner action. It never returns
// revoked/expired credentials or a binding whose Runtime membership is withdrawn.
func (v *HumanVault) LoadForEntry(membershipID string, now time.Time) (HumanReceipt, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	state, runtime, err := v.read()
	if err != nil {
		return HumanReceipt{}, err
	}
	connection, ok := findConnection(runtime, membershipID)
	if !ok || connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) {
		return HumanReceipt{}, ErrStore
	}
	for _, binding := range state.Bindings {
		if binding.Receipt.HumanCredential.MembershipID == membershipID && binding.State == "active" && after(binding.Receipt.HumanCredential.ExpiresAt, now) {
			return binding.Receipt, nil
		}
	}
	return HumanReceipt{}, ErrStore
}
func (v *HumanVault) Revoke(membershipID string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	state, _, err := v.read()
	if err != nil {
		return err
	}
	for i, binding := range state.Bindings {
		if binding.Receipt.HumanCredential.MembershipID == membershipID {
			if binding.State == "revoked" {
				return nil
			}
			state.Bindings[i].State = "revoked"
			return v.write(state)
		}
	}
	return ErrStore
}
func (v *HumanVault) write(state humanVaultState) error {
	state.Revision++
	if !closed("PeerHumanVaultState", state) {
		return ErrStore
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return ErrStore
	}
	if err = writePrivateState(v.directory, "state.json", raw); err != nil {
		return err
	}
	v.observed = state.Revision
	return nil
}
func findConnection(state State, membershipID string) (LocalConnection, bool) {
	for _, connection := range state.Connections {
		if connection.Receipt.Membership.MembershipID == membershipID {
			return connection, true
		}
	}
	return LocalConnection{}, false
}

func writePrivateState(directory, filename string, raw []byte) error {
	nonce, err := NewNonce()
	if err != nil {
		return err
	}
	canonical, err := wire.CanonicalJSON(raw)
	if err != nil {
		return ErrStore
	}
	if _, err = os.Lstat(directory); os.IsNotExist(err) {
		temporary := filepath.Join(filepath.Dir(directory), ".peer-install-"+nonce)
		if err = privatefs.CreateDirectory(temporary); err != nil {
			return err
		}
		defer os.RemoveAll(temporary)
		if err = privatefs.WriteFile(filepath.Join(temporary, filename), canonical); err != nil {
			return err
		}
		if _, err = os.Lstat(directory); !os.IsNotExist(err) {
			return ErrConflict
		}
		if err = os.Rename(temporary, directory); err != nil {
			return err
		}
		return durablefs.SyncParent(directory)
	}
	if err != nil || privatefs.EnsureDirectory(directory) != nil {
		return ErrStore
	}
	temporary := filepath.Join(directory, ".peer-write-"+nonce)
	if err = privatefs.WriteFile(temporary, canonical); err != nil {
		return err
	}
	defer os.Remove(temporary)
	if err = os.Rename(temporary, filepath.Join(directory, filename)); err != nil {
		return err
	}
	return durablefs.SyncParent(filepath.Join(directory, filename))
}
