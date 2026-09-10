package peer

import (
	"strconv"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type AcceptanceRecord struct {
	SchemaVersion int64                      `json:"schemaVersion"`
	Sequence      int64                      `json:"sequence"`
	Acceptance    wire.RemoteAgentAcceptance `json:"acceptance"`
	Projection    wire.RemoteAgentProjection `json:"projection"`
	OfferDigest   string                     `json:"offerDigest"`
}

func acceptanceKey(a wire.RemoteAgentAcceptance) string {
	return a.AcceptanceID + "/" + strconv.FormatInt(a.Revision, 10)
}

func acceptanceSnapshot(connection LocalConnection, localAgentID string) (int, ExportSyncReceipt, bool) {
	for i, snapshot := range connection.AcceptanceSnapshots {
		if snapshot.LocalAgentID == localAgentID {
			return i, snapshot, true
		}
	}
	return 0, ExportSyncReceipt{}, false
}

// Snapshots retain the Host signature across restarts. Stored proof is checked at
// its original issue time; it is evidence, never a fresh Run admission.
func validateAcceptanceSnapshots(connection LocalConnection, participant wire.PeerNodeIdentity) error {
	m := connection.Receipt.Membership
	seen := map[string]bool{}
	projections := map[string]string{}
	for _, snapshot := range connection.AcceptanceSnapshots {
		if seen[snapshot.LocalAgentID] || !closed("PeerAgentSyncReceipt", snapshot) {
			return ErrStore
		}
		seen[snapshot.LocalAgentID] = true
		offers := []AgentOffer{}
		for _, entry := range connection.LocalExports {
			if entry.Offer.Grant.LocalAgentID == snapshot.LocalAgentID && int64(len(offers)) < snapshot.ExportHistoryLength {
				offers = append(offers, entry.Offer)
			}
		}
		issued, err := time.Parse(time.RFC3339Nano, snapshot.Proof.Payload.IssuedAt)
		if err != nil || VerifyExportSyncReceipt(snapshot, offers, m.PeerID, snapshot.LocalAgentID,
			wire.PeerNodeIdentity(connection.Receipt.Invitation.Host), participant, snapshot.Proof.Payload.OperationID, snapshot.Proof.Payload.Nonce, issued) != nil {
			return ErrStore
		}
		if validateAcceptanceRecords(connection, snapshot) != nil {
			return ErrStore
		}
		if len(snapshot.AcceptanceHistory) > 0 {
			id := snapshot.AcceptanceHistory[0].Projection.ProjectionAgentID
			if other := projections[id]; other != "" && other != snapshot.LocalAgentID {
				return ErrStore
			}
			projections[id] = snapshot.LocalAgentID
		}
	}
	return nil
}

func validateAcceptanceRecords(connection LocalConnection, snapshot ExportSyncReceipt) error {
	stored := map[string]wire.RemoteAgentAcceptance{}
	for _, a := range connection.Acceptances {
		stored[acceptanceKey(a)] = a
	}
	metadata := map[string]AgentOffer{}
	agentExports := map[string]bool{}
	for _, entry := range connection.LocalExports {
		g := entry.Offer.Grant
		metadata[g.ExportID+"/"+strconv.FormatInt(g.Revision, 10)] = entry.Offer
		if g.LocalAgentID == snapshot.LocalAgentID {
			agentExports[g.ExportID] = true
		}
	}
	count := 0
	for _, a := range connection.Acceptances {
		if agentExports[a.ExportID] {
			count++
		}
	}
	if count != len(snapshot.AcceptanceHistory) {
		return ErrStore
	}
	projectionID := ""
	ordered := connection
	ordered.Acceptances = []wire.RemoteAgentAcceptance{}
	for i, record := range snapshot.AcceptanceHistory {
		a, p := record.Acceptance, record.Projection
		offer, found := metadata[a.ExportID+"/"+strconv.FormatInt(a.GrantRevision, 10)]
		digest, err := semanticDigest(offer)
		if !found || err != nil || record.Sequence != int64(i+1) || record.OfferDigest != digest ||
			!equalJSON(stored[acceptanceKey(a)], a) || p.LocalAgentID != snapshot.LocalAgentID ||
			p.LocalAgentID != offer.Grant.LocalAgentID || p.PeerID != a.PeerID || p.AuthorityNodeID != a.AuthorityNodeID ||
			p.TeamID != a.TeamID || p.ExportID != a.ExportID || p.AcceptanceID != a.AcceptanceID || p.AcceptanceRevision != a.Revision ||
			p.DisplayName != offer.DisplayName || p.Role != offer.Role || !equalJSON(p.Capabilities, a.Capabilities) ||
			(projectionID != "" && projectionID != p.ProjectionAgentID) {
			return ErrStore
		}
		projectionID = p.ProjectionAgentID
		ordered.Acceptances = append(ordered.Acceptances, a)
	}
	return validateHistory(ordered)
}

func acceptanceSnapshotTransition(previous, next LocalConnection, now time.Time) error {
	for _, old := range previous.AcceptanceSnapshots {
		_, current, found := acceptanceSnapshot(next, old.LocalAgentID)
		if !found || len(current.AcceptanceHistory) < len(old.AcceptanceHistory) || current.ExportHistoryLength < old.ExportHistoryLength {
			return ErrStore
		}
		for i, record := range old.AcceptanceHistory {
			if !equalJSON(record, current.AcceptanceHistory[i]) {
				return ErrStore
			}
		}
	}
	for _, current := range next.AcceptanceSnapshots {
		_, old, found := acceptanceSnapshot(previous, current.LocalAgentID)
		if (!found || !equalJSON(current, old)) && (next.State != "active" ||
			!wire.ProofTimeValid(wire.PeerProofPayload(current.Proof.Payload), now)) {
			return ErrStore
		}
	}
	return nil
}

// Only the authenticated synchronization client installs Host evidence. Update
// validates the signature, immutable prefix, exact grant and projection mapping.
func (e *Exporter) installAcceptanceSnapshot(membershipID string, snapshot ExportSyncReceipt, now time.Time) error {
	state, err := e.store.Read()
	if err != nil {
		return err
	}
	index, connection, found := exportConnection(state, membershipID)
	if !found || connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) ||
		!after(connection.Receipt.MachineCredential.ExpiresAt, now) {
		return ErrExport
	}
	stored := map[string]wire.RemoteAgentAcceptance{}
	for _, a := range connection.Acceptances {
		stored[acceptanceKey(a)] = a
	}
	for _, record := range snapshot.AcceptanceHistory {
		if old, exists := stored[acceptanceKey(record.Acceptance)]; exists {
			if !equalJSON(old, record.Acceptance) {
				return ErrStore
			}
		} else {
			connection.Acceptances = append(connection.Acceptances, record.Acceptance)
			stored[acceptanceKey(record.Acceptance)] = record.Acceptance
		}
	}
	if i, _, exists := acceptanceSnapshot(connection, snapshot.LocalAgentID); exists {
		connection.AcceptanceSnapshots[i] = snapshot
	} else {
		connection.AcceptanceSnapshots = append(connection.AcceptanceSnapshots, snapshot)
	}
	state.Connections[index] = connection
	state.Revision++
	return e.store.Update(state.Revision-1, state, now)
}

// Effective checks stored bilateral authority and the current local Runtime
// configuration. Run start must additionally obtain and recheck live Host admission.
func (e *Exporter) Effective(membershipID, localAgentID, roomID string, now time.Time) (AcceptanceRecord, error) {
	current, err := e.Current(membershipID, localAgentID, now)
	if err != nil {
		return AcceptanceRecord{}, err
	}
	state, err := e.store.Read()
	if err != nil {
		return AcceptanceRecord{}, err
	}
	_, connection, found := exportConnection(state, membershipID)
	if !found {
		return AcceptanceRecord{}, ErrExport
	}
	return effectiveAcceptance(connection, current, roomID, now)
}

// Inventory and execution share the retained bilateral intersection. A Run
// still needs fresh Host admission before executing.
func effectiveAcceptance(connection LocalConnection, current LocalExport, roomID string, now time.Time) (AcceptanceRecord, error) {
	localAgentID := current.Offer.Grant.LocalAgentID
	if connection.State != "active" || !after(connection.Receipt.Membership.ExpiresAt, now) ||
		!after(connection.Receipt.MachineCredential.ExpiresAt, now) {
		return AcceptanceRecord{}, ErrExport
	}
	head, found := currentLocalGrant(connection, localAgentID)
	if !found || !equalJSON(head, current.Offer.Grant) {
		return AcceptanceRecord{}, ErrExport
	}
	_, snapshot, found := acceptanceSnapshot(connection, localAgentID)
	if !found || len(snapshot.AcceptanceHistory) == 0 {
		return AcceptanceRecord{}, ErrExport
	}
	record := snapshot.AcceptanceHistory[len(snapshot.AcceptanceHistory)-1]
	a := record.Acceptance
	digest, err := semanticDigest(head)
	if err != nil || a.State != "active" || a.ExportID != head.ExportID || a.GrantRevision != head.Revision || a.GrantDigest != digest ||
		!after(a.ExpiresAt, now) || a.IssuedAt > now.Add(wire.ProofClockSkewSeconds*time.Second).UTC().Format(peerTimeFormat) ||
		!subset([]string{roomID}, a.RoomIDS) || !subset([]string{roomID}, head.RoomIDS) ||
		!capabilitySubset(a.Capabilities, head.Capabilities) {
		return AcceptanceRecord{}, ErrExport
	}
	return record, nil
}
