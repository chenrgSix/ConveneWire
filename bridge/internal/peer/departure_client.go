package peer

import (
	"context"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type LeaveIntent struct {
	SchemaVersion int64                 `json:"schemaVersion"`
	OperationID   string                `json:"operationId"`
	Host          wire.PeerNodeIdentity `json:"host"`
	HostOrigin    string                `json:"hostOrigin"`
	Participant   wire.PeerNodeIdentity `json:"participant"`
	PeerID        string                `json:"peerId"`
	MembershipID  string                `json:"membershipId"`
}

type LeaveReceipt struct {
	SchemaVersion int64          `json:"schemaVersion"`
	Intent        LeaveIntent    `json:"intent"`
	State         string         `json:"state"`
	RecordedAt    string         `json:"recordedAt"`
	Proof         wire.PeerProof `json:"proof"`
}

func VerifyLeaveReceipt(receipt LeaveReceipt, intent LeaveIntent, nonce string, now time.Time) error {
	if !closed("PeerLeaveReceipt", receipt) || !equalJSON(receipt.Intent, intent) || ValidateOrigin(intent.HostOrigin) != nil {
		return ErrProof
	}
	recorded, err := time.Parse(time.RFC3339Nano, receipt.RecordedAt)
	issued, issueErr := time.Parse(time.RFC3339Nano, receipt.Proof.Payload.IssuedAt)
	if err != nil || issueErr != nil || recorded.After(issued) {
		return ErrProof
	}
	digest, err := semanticDigest(map[string]any{"intent": intent, "state": receipt.State, "recordedAt": receipt.RecordedAt})
	if err != nil {
		return ErrProof
	}
	return VerifyProof(receipt.Proof, intent.Host, ProofContext{Purpose: "peer.leave", AudienceNodeID: intent.Participant.NodeID,
		OperationID: intent.OperationID, Nonce: nonce, SubjectDigest: digest}, now)
}

// Leave transports an Owner's frozen departure after the local execution fence
// is durable. A fresh Node proof can only revoke its exact existing membership;
// no revoked business bearer or human secret is sent or reconstructed.
func (c *Client) Leave(ctx context.Context, intent LeaveIntent) (LeaveReceipt, error) {
	if !closed("PeerLeaveIntent", intent) || intent.Host != c.host || intent.HostOrigin != c.origin || intent.Participant != c.signer.Identity() {
		return LeaveReceipt{}, ErrProof
	}
	if err := c.identity(ctx, intent.OperationID); err != nil {
		return LeaveReceipt{}, err
	}
	nonce, err := NewNonce()
	if err != nil {
		return LeaveReceipt{}, err
	}
	digest, err := semanticDigest(intent)
	if err != nil {
		return LeaveReceipt{}, err
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "peer.leave", AudienceNodeID: c.host.NodeID,
		OperationID: intent.OperationID, Nonce: nonce, SubjectDigest: digest}, c.clock())
	if err != nil {
		return LeaveReceipt{}, err
	}
	request := map[string]any{"schemaVersion": 1, "intent": intent, "proof": proof}
	var receipt LeaveReceipt
	if err := c.post(ctx, "/api/peer/memberships/leave", "PeerLeaveRequest", request, "PeerLeaveReceipt", &receipt); err != nil {
		return LeaveReceipt{}, err
	}
	if err := VerifyLeaveReceipt(receipt, intent, nonce, c.clock()); err != nil {
		return LeaveReceipt{}, err
	}
	return receipt, nil
}
