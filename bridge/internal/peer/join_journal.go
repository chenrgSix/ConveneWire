package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type PendingJoin struct {
	SchemaVersion int64                 `json:"schemaVersion"`
	Participant   wire.PeerNodeIdentity `json:"participant"`
	LocalUserID   string                `json:"localUserId"`
	Invitation    wire.PeerInvitation   `json:"invitation"`
	Secret        string                `json:"secret"`
	OperationID   string                `json:"operationId"`
	DisplayName   string                `json:"displayName"`
	PreviewProof  wire.PeerProof        `json:"previewProof"`
	CreatedAt     string                `json:"createdAt"`
}
type JoinJournal struct {
	mu        *sync.Mutex
	directory string
	runtime   *Store
	human     *HumanVault
}

var peerOperationID = regexp.MustCompile(`^op_[A-Za-z0-9_-]{8,128}$`)

func OpenJoinJournal(runtime *Store, human *HumanVault) (*JoinJournal, error) {
	if runtime == nil || human == nil || human.runtime != runtime {
		return nil, ErrStore
	}
	directory := filepath.Join(filepath.Dir(runtime.directory), "peer-joins")
	lock, _ := storeLocks.LoadOrStore(directory, &sync.Mutex{})
	return &JoinJournal{mu: lock.(*sync.Mutex), directory: directory, runtime: runtime, human: human}, nil
}
func (j *JoinJournal) valid(pending PendingJoin, at time.Time) bool {
	return closed("PeerPendingJoin", pending) && pending.Participant == j.runtime.participant && pending.LocalUserID == j.runtime.localUserID &&
		VerifyInvitationPreview(InvitationPreview{SchemaVersion: 1, Invitation: pending.Invitation, Proof: pending.PreviewProof},
			wire.PeerNodeIdentity{NodeID: pending.Invitation.Host.NodeID, PublicKey: pending.Invitation.Host.PublicKey}, pending.Participant,
			pending.Invitation.HostOrigin, pending.Invitation.InvitationID, pending.OperationID, pending.PreviewProof.Payload.Nonce, at) == nil
}

// Save precedes any claim request and follows authenticated local Owner review.
// An existing frozen operation is never rewritten using a new preview or recipient.
func (j *JoinJournal) Save(pending PendingJoin, now time.Time) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	if !closed("PeerPendingJoin", pending) {
		return ErrStore
	}
	if existing, err := j.load(pending.OperationID); err == nil {
		if equalJSON(existing, pending) {
			return nil
		}
		return ErrConflict
	} else if !os.IsNotExist(err) {
		return err
	}
	at, err := time.Parse(time.RFC3339Nano, pending.CreatedAt)
	if err != nil || at.After(now) || !j.valid(pending, at) || !j.valid(pending, now) {
		return ErrStore
	}
	names, err := os.ReadDir(j.directory)
	if err != nil && !os.IsNotExist(err) {
		return ErrStore
	}
	count := 0
	for _, name := range names {
		if peerOperationID.MatchString(trimJSON(name.Name())) {
			count++
		}
	}
	if count >= 64 {
		return ErrStore
	}
	raw, err := json.Marshal(pending)
	if err != nil {
		return ErrStore
	}
	return writePrivateState(j.directory, pending.OperationID+".json", raw)
}
func (j *JoinJournal) Load(operationID string) (PendingJoin, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.load(operationID)
}
func (j *JoinJournal) load(operationID string) (PendingJoin, error) {
	if !peerOperationID.MatchString(operationID) {
		return PendingJoin{}, ErrStore
	}
	if _, err := os.Lstat(j.directory); err != nil {
		return PendingJoin{}, err
	}
	if privatefs.EnsureDirectory(j.directory) != nil {
		return PendingJoin{}, ErrStore
	}
	filename := filepath.Join(j.directory, operationID+".json")
	if _, err := os.Lstat(filename); err != nil {
		return PendingJoin{}, err
	}
	raw, err := privatefs.ReadFile(filename, wire.MaximumJSONBytes)
	if err != nil {
		return PendingJoin{}, err
	}
	var pending PendingJoin
	if wire.Decode("PeerPendingJoin", raw, &pending) != nil || pending.OperationID != operationID {
		return PendingJoin{}, ErrStore
	}
	at, err := time.Parse(time.RFC3339Nano, pending.CreatedAt)
	if err != nil || !j.valid(pending, at) {
		return PendingJoin{}, ErrStore
	}
	return pending, nil
}
func trimJSON(value string) string {
	if filepath.Ext(value) != ".json" {
		return ""
	}
	return value[:len(value)-5]
}
func (j *JoinJournal) Pending() ([]PendingJoin, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	names, err := os.ReadDir(j.directory)
	if os.IsNotExist(err) {
		return []PendingJoin{}, nil
	}
	if err != nil {
		return nil, ErrStore
	}
	if privatefs.EnsureDirectory(j.directory) != nil {
		return nil, ErrStore
	}
	result := []PendingJoin{}
	for _, name := range names {
		id := trimJSON(name.Name())
		if !peerOperationID.MatchString(id) {
			continue
		}
		if len(result) >= 64 {
			return nil, ErrStore
		}
		pending, err := j.load(id)
		if err != nil {
			return nil, err
		}
		result = append(result, pending)
	}
	return result, nil
}

// RecordJoined commits only the exact pending operation. A failure between the
// two private stores leaves the journal available for a fresh Host claim retry.
func (j *JoinJournal) RecordJoined(operationID, nonce string, joined Joined, now time.Time) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	pending, err := j.load(operationID)
	if err != nil {
		return err
	}
	if VerifyJoined(joined, pending.Invitation, pending.Participant, pending.LocalUserID, operationID, nonce, now) != nil {
		return ErrProof
	}
	state, err := j.runtime.Read()
	if err != nil {
		return err
	}
	wanted, err := JoinReceiptDigest(joined.Runtime)
	if err != nil {
		return err
	}
	found := false
	for _, connection := range state.Connections {
		if connection.Receipt.Invitation.InvitationID != pending.Invitation.InvitationID && connection.Receipt.Proof.Payload.OperationID != operationID {
			continue
		}
		existing, err := JoinReceiptDigest(connection.Receipt)
		if err != nil || existing != wanted || connection.State != "active" {
			return ErrConflict
		}
		found = true
	}
	if !found {
		previous := state.Revision
		state.Revision++
		state.Connections = append(state.Connections, LocalConnection{Receipt: joined.Runtime, State: "active", Exports: []wire.AgentExportGrant{}, Acceptances: []wire.RemoteAgentAcceptance{}})
		if err = j.runtime.Update(previous, state, now); err != nil {
			return err
		}
	}
	if err = j.human.Bind(joined, now); err != nil {
		return err
	}
	filename := filepath.Join(j.directory, operationID+".json")
	if err = os.Remove(filename); err != nil {
		return err
	}
	return durablefs.SyncParent(filename)
}
