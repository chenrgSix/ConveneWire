package peer

import (
	"context"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type ExecutionAdmission struct {
	SchemaVersion int64                     `json:"schemaVersion"`
	Binding       wire.PeerExecutionBinding `json:"binding"`
	Proof         wire.PeerProof            `json:"proof"`
}

func VerifyExecutionAdmission(receipt ExecutionAdmission, binding wire.PeerExecutionBinding,
	host, participant wire.PeerNodeIdentity, operationID, nonce string, now time.Time) error {
	if !closed("PeerAdmission", receipt) || receipt.Binding != binding || host.NodeID == participant.NodeID ||
		binding.AuthorityNodeID != host.NodeID || binding.ParticipantNodeID != participant.NodeID {
		return ErrProof
	}
	digest, err := semanticDigest(binding)
	if err != nil {
		return err
	}
	return VerifyProof(receipt.Proof, host, ProofContext{Purpose: "run.admission", AudienceNodeID: participant.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, now)
}

// AuthorizeExecution obtains fresh Host authority for an already verified,
// immutable Peer request. It never creates a Run or supplies execution content.
// The native factory separately rechecks local grants after this network wait.
func (c *Client) AuthorizeExecution(ctx context.Context, store *Store, membershipID string,
	binding wire.PeerExecutionBinding) (ExecutionAdmission, error) {
	if !closed("PeerExecutionBinding", binding) {
		return ExecutionAdmission{}, ErrProof
	}
	local, err := c.runtimeMembership(store, membershipID)
	if err != nil {
		return ExecutionAdmission{}, err
	}
	m := local.Receipt.Membership
	if binding.AuthorityNodeID != c.host.NodeID || binding.ParticipantNodeID != c.signer.Identity().NodeID ||
		binding.PeerID != m.PeerID || binding.TeamID != m.Scope.TeamID || m.Scope.Kind == "room" && (m.Scope.RoomID == nil || *m.Scope.RoomID != binding.RoomID) {
		return ExecutionAdmission{}, ErrProof
	}
	nonce, err := NewNonce()
	if err != nil {
		return ExecutionAdmission{}, err
	}
	operationID := "op_" + nonce
	if err := c.identity(ctx, operationID); err != nil {
		return ExecutionAdmission{}, err
	}
	current, err := c.runtimeMembership(store, membershipID)
	if err != nil || !equalJSON(current.Receipt, local.Receipt) {
		return ExecutionAdmission{}, ErrProof
	}
	digest, err := semanticDigest(binding)
	if err != nil {
		return ExecutionAdmission{}, err
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "run.admission", AudienceNodeID: c.host.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, c.clock())
	if err != nil {
		return ExecutionAdmission{}, err
	}
	request := ExecutionAdmission{SchemaVersion: 1, Binding: binding, Proof: proof}
	var receipt ExecutionAdmission
	if err := c.postMachine(ctx, "/api/peer/runs/admit", "PeerAdmission", request, "PeerAdmission", &receipt,
		local.Receipt.MachineCredential.Token); err != nil {
		return ExecutionAdmission{}, err
	}
	if err := VerifyExecutionAdmission(receipt, binding, c.host, c.signer.Identity(), operationID, nonce, c.clock()); err != nil {
		return ExecutionAdmission{}, err
	}
	current, err = c.runtimeMembership(store, membershipID)
	if err != nil || !equalJSON(current.Receipt, local.Receipt) {
		return ExecutionAdmission{}, ErrProof
	}
	return receipt, nil
}
