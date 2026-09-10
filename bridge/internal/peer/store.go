// Package peer holds independent Peer authority. Device credentials never enter this store.
package peer

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrStore = errors.New("Peer owner storage is missing, changed or bound to a different identity")
var ErrConflict = errors.New("Peer owner storage revision conflict")
var storeLocks sync.Map

// These internal representations are validated against PeerParticipantState on every read/write.
type JoinReceipt struct {
	SchemaVersion     int64                      `json:"schemaVersion"`
	Invitation        wire.PeerInvitation        `json:"invitation"`
	Membership        wire.PeerMembership        `json:"membership"`
	MachineCredential wire.PeerMachineCredential `json:"machineCredential"`
	Proof             wire.PeerProof             `json:"proof"`
}
type LocalConnection struct {
	Receipt             JoinReceipt                  `json:"receipt"`
	State               string                       `json:"state"`
	Exports             []wire.AgentExportGrant      `json:"exports"`
	Acceptances         []wire.RemoteAgentAcceptance `json:"acceptances"`
	LocalExports        []LocalExport                `json:"localExports,omitempty"`
	AcceptanceSnapshots []ExportSyncReceipt          `json:"acceptanceSnapshots,omitempty"`
	Departure           *LocalDeparture              `json:"departure,omitempty"`
}
type State struct {
	SchemaVersion int64                 `json:"schemaVersion"`
	Participant   wire.PeerNodeIdentity `json:"participant"`
	LocalUserID   string                `json:"localUserId"`
	Revision      int64                 `json:"revision"`
	Connections   []LocalConnection     `json:"connections"`
}

type Store struct {
	mu          *sync.Mutex
	directory   string
	participant wire.PeerNodeIdentity
	localUserID string
	observed    int64
}

// OpenStore requires the shared core's exclusive root lease for its entire lifetime.
// An absent directory means no prior Peer configuration; missing contents never do.
func OpenStore(root string, participant wire.PeerNodeIdentity, localUserID string) (*Store, error) {
	raw, err := json.Marshal(participant)
	if err != nil || wire.Decode("PeerNodeIdentity", raw, &participant) != nil || !regexp.MustCompile(`^user_[A-Za-z0-9_-]{8,128}$`).MatchString(localUserID) {
		return nil, ErrStore
	}
	if _, err = os.Lstat(root); err != nil || privatefs.EnsureDirectory(root) != nil {
		return nil, ErrStore
	}
	directory := filepath.Join(root, "peer-state")
	lock, _ := storeLocks.LoadOrStore(directory, &sync.Mutex{})
	s := &Store{mu: lock.(*sync.Mutex), directory: directory, participant: participant, localUserID: localUserID}
	if _, err = s.Read(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Read() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *Store) read() (State, error) {
	if _, err := os.Lstat(s.directory); os.IsNotExist(err) {
		if s.observed != 0 {
			return State{}, ErrStore
		}
		return State{SchemaVersion: 1, Participant: s.participant, LocalUserID: s.localUserID, Connections: []LocalConnection{}}, nil
	} else if err != nil || privatefs.EnsureDirectory(s.directory) != nil {
		return State{}, ErrStore
	}
	raw, err := privatefs.ReadFile(filepath.Join(s.directory, "state.json"), wire.MaximumJSONBytes)
	if err != nil {
		return State{}, ErrStore
	}
	var state State
	if wire.Decode("PeerParticipantState", raw, &state) != nil || validateState(state, s.participant, s.localUserID) != nil || state.Revision < s.observed {
		return State{}, ErrStore
	}
	s.observed = state.Revision
	return state, nil
}

// Update preserves every receipt/history prefix. New joins require a fresh signed Host response.
// Caller authorization remains the local Owner's explicit action or a verified Peer callback.
func (s *Store) Update(expected int64, next State, now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous, err := s.read()
	if err != nil {
		return err
	}
	if expected != previous.Revision || next.Revision != expected+1 {
		return ErrConflict
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return ErrStore
	}
	var decoded State
	if wire.Decode("PeerParticipantState", raw, &decoded) != nil || validateState(decoded, s.participant, s.localUserID) != nil {
		return ErrStore
	}
	if transition(previous, decoded, now) != nil {
		return ErrStore
	}
	raw, err = wire.CanonicalJSON(raw)
	if err != nil {
		return ErrStore
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	if previous.Revision == 0 {
		// Install the first complete private directory; a killed staging write is never a configuration.
		temporary := filepath.Join(filepath.Dir(s.directory), ".peer-state-"+hex.EncodeToString(nonce))
		if err = privatefs.CreateDirectory(temporary); err != nil {
			return err
		}
		defer os.RemoveAll(temporary)
		if err = privatefs.WriteFile(filepath.Join(temporary, "state.json"), raw); err != nil {
			return err
		}
		if _, err = os.Lstat(s.directory); !os.IsNotExist(err) {
			return ErrConflict
		}
		if err = os.Rename(temporary, s.directory); err != nil {
			return err
		}
		if err = durablefs.SyncParent(s.directory); err != nil {
			return err
		}
	} else {
		temporary := filepath.Join(s.directory, ".state-"+hex.EncodeToString(nonce))
		if err = privatefs.WriteFile(temporary, raw); err != nil {
			return err
		}
		defer os.Remove(temporary)
		if err = os.Rename(temporary, filepath.Join(s.directory, "state.json")); err != nil {
			return err
		}
		if err = durablefs.SyncParent(filepath.Join(s.directory, "state.json")); err != nil {
			return err
		}
	}
	s.observed = next.Revision
	return nil
}

func equalJSON(a, b any) bool {
	x, err := json.Marshal(a)
	if err != nil {
		return false
	}
	y, err := json.Marshal(b)
	if err != nil {
		return false
	}
	dx, err := wire.Digest(x)
	if err != nil {
		return false
	}
	dy, err := wire.Digest(y)
	return err == nil && dx == dy
}

func transition(previous, next State, now time.Time) error {
	if len(next.Connections) < len(previous.Connections) {
		return ErrStore
	}
	for i, c := range next.Connections {
		if i >= len(previous.Connections) {
			if c.State != "active" || len(c.Exports) != 0 || len(c.Acceptances) != 0 || len(c.LocalExports) != 0 || len(c.AcceptanceSnapshots) != 0 || !wire.ProofTimeValid(wire.PeerProofPayload(c.Receipt.Proof.Payload), now) {
				return ErrStore
			}
			expiry, err := time.Parse(time.RFC3339Nano, c.Receipt.Membership.ExpiresAt)
			if err != nil || !expiry.After(now) {
				return ErrStore
			}
			continue
		}
		old := previous.Connections[i]
		if acceptanceSnapshotTransition(old, c, now) != nil || departureTransition(old, c, now) != nil {
			return ErrStore
		}
		if len(c.LocalExports) < len(old.LocalExports) {
			return ErrStore
		}
		for j, v := range old.LocalExports {
			if !equalJSON(v, c.LocalExports[j]) {
				return ErrStore
			}
		}
		if !equalJSON(old.Receipt, c.Receipt) || (old.State != "active" && old.State != c.State) || len(c.Exports) < len(old.Exports) || len(c.Acceptances) < len(old.Acceptances) {
			return ErrStore
		}
		for j, v := range old.Exports {
			if !equalJSON(v, c.Exports[j]) {
				return ErrStore
			}
		}
		for j, v := range old.Acceptances {
			if !equalJSON(v, c.Acceptances[j]) {
				return ErrStore
			}
		}
		if c.State != "active" {
			for _, v := range c.Exports[len(old.Exports):] {
				if v.State != "revoked" {
					return ErrStore
				}
			}
			for _, v := range c.Acceptances[len(old.Acceptances):] {
				if v.State != "revoked" {
					return ErrStore
				}
			}
		}
	}
	return nil
}
