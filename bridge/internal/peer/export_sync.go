package peer

import (
	"context"
	"strconv"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type ExportSyncReceipt struct {
	SchemaVersion int64          `json:"schemaVersion"`
	PeerID        string         `json:"peerId"`
	LocalAgentID  string         `json:"localAgentId"`
	HistoryDigest string         `json:"historyDigest"`
	ExportID      string         `json:"exportId"`
	GrantRevision int64          `json:"grantRevision"`
	GrantDigest   string         `json:"grantDigest"`
	Proof         wire.PeerProof `json:"proof"`
}

// History is one complete reviewed local Agent history. Expired/withdrawn heads
// can be synchronized without a present Runtime, but cannot become current work.
func (e *Exporter) History(membershipID, localAgentID string, now time.Time) ([]AgentOffer, error) {
	state, err := e.store.Read()
	if err != nil {
		return nil, err
	}
	_, connection, found := exportConnection(state, membershipID)
	if !found || connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) ||
		!after(connection.Receipt.MachineCredential.ExpiresAt, now) {
		return nil, ErrExport
	}
	head, found := currentLocalGrant(connection, localAgentID)
	if !found {
		return nil, ErrExport
	}
	if head.State == "active" && after(head.ExpiresAt, now) {
		current, err := e.Current(membershipID, localAgentID, now)
		if err != nil || !equalJSON(current.Offer.Grant, head) {
			return nil, ErrExport
		}
	}
	key := func(grant wire.AgentExportGrant) string {
		return grant.ExportID + "/" + strconv.FormatInt(grant.Revision, 10)
	}
	metadata := map[string]AgentOffer{}
	for _, entry := range connection.LocalExports {
		metadata[key(entry.Offer.Grant)] = entry.Offer
	}
	offers := []AgentOffer{}
	for _, grant := range connection.Exports {
		if grant.LocalAgentID != localAgentID {
			continue
		}
		offer, found := metadata[key(grant)]
		if !found || !equalJSON(offer.Grant, grant) {
			return nil, ErrExport
		}
		offers = append(offers, offer)
	}
	return offers, nil
}

func exportHistoryContent(localAgentID string, offers []AgentOffer) map[string]any {
	return map[string]any{"schemaVersion": 1, "localAgentId": localAgentID, "offers": offers}
}
func VerifyExportSyncReceipt(receipt ExportSyncReceipt, offers []AgentOffer, peerID, localAgentID string,
	host, participant wire.PeerNodeIdentity, operationID, nonce string, now time.Time) error {
	historyDigest, err := semanticDigest(exportHistoryContent(localAgentID, offers))
	if err != nil || !closed("PeerAgentSyncReceipt", receipt) || receipt.HistoryDigest != historyDigest ||
		receipt.PeerID != peerID || receipt.LocalAgentID != localAgentID {
		return ErrProof
	}
	connection := LocalConnection{}
	for _, offer := range offers {
		connection.Exports = append(connection.Exports, offer.Grant)
	}
	head, found := currentLocalGrant(connection, localAgentID)
	digest, err := semanticDigest(head)
	if !found || err != nil || receipt.ExportID != head.ExportID || receipt.GrantRevision != head.Revision || receipt.GrantDigest != digest {
		return ErrProof
	}
	subject, err := semanticDigest(map[string]any{"peerId": peerID, "localAgentId": localAgentID, "historyDigest": historyDigest,
		"exportId": head.ExportID, "grantRevision": head.Revision, "grantDigest": digest})
	if err != nil {
		return ErrProof
	}
	return VerifyProof(receipt.Proof, host, ProofContext{Purpose: "agent.export", AudienceNodeID: participant.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: subject}, now)
}

func (c *Client) SyncExports(ctx context.Context, exporter *Exporter, membershipID, localAgentID, operationID string) (ExportSyncReceipt, error) {
	if exporter == nil {
		return ExportSyncReceipt{}, ErrExport
	}
	offers, err := exporter.History(membershipID, localAgentID, c.clock())
	if err != nil {
		return ExportSyncReceipt{}, err
	}
	state, err := exporter.store.Read()
	if err != nil {
		return ExportSyncReceipt{}, err
	}
	_, connection, found := exportConnection(state, membershipID)
	if !found || state.Participant != c.signer.Identity() || state.LocalUserID != c.signer.LocalUserID() ||
		!equalJSON(connection.Receipt.Invitation.Host, c.host) || connection.Receipt.Invitation.HostOrigin != c.origin {
		return ExportSyncReceipt{}, ErrProof
	}
	if err = c.identity(ctx, operationID); err != nil {
		return ExportSyncReceipt{}, err
	}
	current, err := exporter.History(membershipID, localAgentID, c.clock())
	if err != nil || !equalJSON(current, offers) {
		return ExportSyncReceipt{}, ErrExport
	}
	nonce, err := NewNonce()
	if err != nil {
		return ExportSyncReceipt{}, err
	}
	request := exportHistoryContent(localAgentID, offers)
	digest, err := semanticDigest(request)
	if err != nil {
		return ExportSyncReceipt{}, err
	}
	proof, err := c.signer.Sign(ProofContext{Purpose: "agent.export", AudienceNodeID: c.host.NodeID,
		OperationID: operationID, Nonce: nonce, SubjectDigest: digest}, c.clock())
	if err != nil {
		return ExportSyncReceipt{}, err
	}
	request["proof"] = proof
	var receipt ExportSyncReceipt
	if err = c.postMachine(ctx, "/api/peer/agents/sync", "PeerAgentSyncRequest", request, "PeerAgentSyncReceipt", &receipt,
		connection.Receipt.MachineCredential.Token); err != nil {
		return ExportSyncReceipt{}, err
	}
	if err = VerifyExportSyncReceipt(receipt, offers, connection.Receipt.Membership.PeerID, localAgentID,
		c.host, c.signer.Identity(), operationID, nonce, c.clock()); err != nil {
		return ExportSyncReceipt{}, err
	}
	current, err = exporter.History(membershipID, localAgentID, c.clock())
	if err != nil || !equalJSON(current, offers) {
		return ExportSyncReceipt{}, ErrExport
	}
	return receipt, nil
}
