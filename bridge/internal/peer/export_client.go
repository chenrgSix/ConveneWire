package peer

import (
	"context"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type OfferReceipt struct {
	SchemaVersion int64          `json:"schemaVersion"`
	ExportID      string         `json:"exportId"`
	GrantRevision int64          `json:"grantRevision"`
	GrantDigest   string         `json:"grantDigest"`
	OfferDigest   string         `json:"offerDigest"`
	Proof         wire.PeerProof `json:"proof"`
}

func VerifyOfferReceipt(receipt OfferReceipt, offer AgentOffer, host, participant wire.PeerNodeIdentity,
	operationID, nonce string, now time.Time) error {
	grantDigest, err := semanticDigest(offer.Grant)
	if err != nil {
		return ErrProof
	}
	offerDigest, err := semanticDigest(offer)
	if err != nil || !closed("PeerAgentOfferReceipt", receipt) || receipt.ExportID != offer.Grant.ExportID ||
		receipt.GrantRevision != offer.Grant.Revision || receipt.GrantDigest != grantDigest || receipt.OfferDigest != offerDigest {
		return ErrProof
	}
	digest, err := semanticDigest(map[string]any{"exportId": receipt.ExportID, "grantRevision": receipt.GrantRevision,
		"grantDigest": receipt.GrantDigest, "offerDigest": receipt.OfferDigest})
	if err != nil {
		return ErrProof
	}
	return VerifyProof(receipt.Proof, host, ProofContext{Purpose: "agent.export", AudienceNodeID: participant.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, now)
}

// PublishExport transports a previously reviewed and durable current offer.
// A receipt acknowledges persistence only; it cannot imply Host acceptance.
func (c *Client) PublishExport(ctx context.Context, exporter *Exporter, membershipID, localAgentID string) (OfferReceipt, error) {
	if exporter == nil {
		return OfferReceipt{}, ErrExport
	}
	entry, err := exporter.Current(membershipID, localAgentID, c.clock())
	if err != nil {
		return OfferReceipt{}, err
	}
	state, err := exporter.store.Read()
	if err != nil {
		return OfferReceipt{}, err
	}
	_, connection, found := exportConnection(state, membershipID)
	if !found || state.Participant != c.signer.Identity() || state.LocalUserID != c.signer.LocalUserID() ||
		!equalJSON(connection.Receipt.Invitation.Host, c.host) || connection.Receipt.Invitation.HostOrigin != c.origin {
		return OfferReceipt{}, ErrProof
	}
	if err = c.identity(ctx, entry.OperationID); err != nil {
		return OfferReceipt{}, err
	}
	current, err := exporter.Current(membershipID, localAgentID, c.clock())
	if err != nil || !equalJSON(current, entry) {
		return OfferReceipt{}, ErrExport
	}
	nonce, err := NewNonce()
	if err != nil {
		return OfferReceipt{}, err
	}
	digest, err := semanticDigest(entry.Offer)
	if err != nil {
		return OfferReceipt{}, err
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "agent.export", AudienceNodeID: c.host.NodeID,
		OperationID: entry.OperationID, Nonce: nonce, SubjectDigest: digest}, c.clock())
	if err != nil {
		return OfferReceipt{}, err
	}
	request := map[string]any{"schemaVersion": 1, "offer": entry.Offer, "proof": proof}
	var receipt OfferReceipt
	if err = c.postMachine(ctx, "/api/peer/agents/offers", "PeerAgentOfferRequest", request, "PeerAgentOfferReceipt", &receipt,
		connection.Receipt.MachineCredential.Token); err != nil {
		return OfferReceipt{}, err
	}
	if err = VerifyOfferReceipt(receipt, entry.Offer, c.host, c.signer.Identity(), entry.OperationID, nonce, c.clock()); err != nil {
		return OfferReceipt{}, err
	}
	current, err = exporter.Current(membershipID, localAgentID, c.clock())
	if err != nil || !equalJSON(current, entry) {
		return OfferReceipt{}, ErrExport
	}
	return receipt, nil
}
