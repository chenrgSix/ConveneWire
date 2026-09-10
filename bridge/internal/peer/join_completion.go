package peer

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type joinCompletion struct {
	SchemaVersion int    `json:"schemaVersion"`
	OperationID   string `json:"operationId"`
	IntentDigest  string `json:"intentDigest"`
	MembershipID  string `json:"membershipId"`
	ReceiptDigest string `json:"receiptDigest"`
}

var joinDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

func joinOwnerIntent(invitation wire.PeerInvitation, participant wire.PeerNodeIdentity, userID, displayName, secret, operationID string) (string, error) {
	invitationDigest, err := semanticDigest(invitation)
	if err != nil {
		return "", err
	}
	return joinOwnerIntentDigest(wire.PeerNodeIdentity(invitation.Host), invitation.HostOrigin, invitation.InvitationID, invitationDigest,
		participant, userID, displayName, secret, operationID)
}

func joinOwnerIntentDigest(host wire.PeerNodeIdentity, origin, invitationID, invitationDigest string,
	participant wire.PeerNodeIdentity, userID, displayName, secret, operationID string) (string, error) {
	secretDigest, err := semanticDigest(secret)
	if err != nil {
		return "", err
	}
	return semanticDigest(map[string]any{"purpose": "native.peer.join.v1", "host": host, "hostOrigin": origin,
		"invitationId": invitationID, "invitationDigest": invitationDigest, "participant": participant, "localUserId": userID,
		"displayName": displayName, "secretDigest": secretDigest, "operationId": operationID})
}

// Written before deleting the sensitive pending journal. It permits exact local
// HTTP retries after both credentials were saved, without retaining the secret.
func (j *JoinJournal) saveCompletion(pending PendingJoin, receipt JoinReceipt) error {
	intent, err := joinOwnerIntent(pending.Invitation, pending.Participant, pending.LocalUserID, pending.DisplayName, pending.Secret, pending.OperationID)
	if err != nil {
		return err
	}
	digest, err := JoinReceiptDigest(receipt)
	if err != nil {
		return err
	}
	record := joinCompletion{SchemaVersion: 1, OperationID: pending.OperationID, IntentDigest: intent,
		MembershipID: receipt.Membership.MembershipID, ReceiptDigest: digest}
	previous, found, err := j.loadCompletion(pending.OperationID)
	if err != nil {
		return err
	}
	if found {
		if previous != record {
			return ErrConflict
		}
		return nil
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return writePrivateState(filepath.Join(j.directory, "completed"), pending.OperationID+".json", raw)
}

func (j *JoinJournal) loadCompletion(operationID string) (joinCompletion, bool, error) {
	if !peerOperationID.MatchString(operationID) {
		return joinCompletion{}, false, ErrStore
	}
	directory := filepath.Join(j.directory, "completed")
	for _, path := range []string{j.directory, directory} {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			return joinCompletion{}, false, nil
		} else if err != nil || privatefs.EnsureDirectory(path) != nil {
			return joinCompletion{}, false, ErrStore
		}
	}
	path := filepath.Join(directory, operationID+".json")
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return joinCompletion{}, false, nil
	} else if err != nil {
		return joinCompletion{}, false, ErrStore
	}
	raw, err := privatefs.ReadFile(path, 2048)
	if err != nil {
		return joinCompletion{}, false, ErrStore
	}
	canonical, err := wire.CanonicalJSON(raw)
	if err != nil {
		return joinCompletion{}, false, ErrStore
	}
	var record joinCompletion
	decoder := json.NewDecoder(bytes.NewReader(canonical))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&record) != nil || record.SchemaVersion != 1 || record.OperationID != operationID ||
		!joinDigest.MatchString(record.IntentDigest) || !joinDigest.MatchString(record.ReceiptDigest) {
		return joinCompletion{}, false, ErrStore
	}
	return record, true, nil
}

func (j *JoinJournal) completion(operationID string) (joinCompletion, LocalConnection, bool, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	record, found, err := j.loadCompletion(operationID)
	if err != nil || !found {
		return record, LocalConnection{}, found, err
	}
	state, err := j.runtime.Read()
	if err != nil {
		return record, LocalConnection{}, false, err
	}
	local, found := findConnection(state, record.MembershipID)
	digest, err := JoinReceiptDigest(local.Receipt)
	if !found || err != nil || local.Receipt.Proof.Payload.OperationID != operationID || digest != record.ReceiptDigest {
		return record, LocalConnection{}, false, ErrStore
	}
	// Completion never restores missing or withdrawn human authority. Retained
	// receipts are checked at their original issue time by the separate vault.
	j.human.mu.Lock()
	defer j.human.mu.Unlock()
	human, _, err := j.human.read()
	if err != nil {
		return record, LocalConnection{}, false, err
	}
	for _, binding := range human.Bindings {
		if binding.Receipt.HumanCredential.MembershipID == record.MembershipID && binding.Receipt.JoinReceiptDigest == digest {
			// A crash after the completion marker but before unlink must not leave
			// the invitation secret behind. Only remove the exact frozen intent.
			pending, err := j.load(operationID)
			if err == nil {
				intent, err := joinOwnerIntent(pending.Invitation, pending.Participant, pending.LocalUserID, pending.DisplayName, pending.Secret, operationID)
				if err != nil || intent != record.IntentDigest {
					return record, LocalConnection{}, false, ErrConflict
				}
				path := filepath.Join(j.directory, operationID+".json")
				if err := os.Remove(path); err != nil {
					return record, LocalConnection{}, false, err
				}
				if err := durablefs.SyncParent(path); err != nil {
					return record, LocalConnection{}, false, err
				}
			} else if !os.IsNotExist(err) {
				return record, LocalConnection{}, false, err
			}
			return record, local, true, nil
		}
	}
	return record, LocalConnection{}, false, ErrStore
}
