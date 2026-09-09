package peer

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func acceptanceFixture(t *testing.T) (*Exporter, *Store, string, *ExportSource, LocalExport, *Signer, time.Time) {
	t.Helper()
	state, _, now := fixtureState(t)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	exporter, _ := NewExporter(store, func(string) (ExportSource, error) { return source, nil })
	entry, err := exporter.Prepare(1, fixtureExportRequest(state, source), now)
	if err != nil {
		t.Fatal(err)
	}
	host := &Signer{identity: wire.PeerNodeIdentity(state.Connections[0].Receipt.Invitation.Host), key: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))}
	return exporter, store, root, &source, entry, host, now
}

func fixtureAcceptance(t *testing.T, connection LocalConnection, offer AgentOffer, revision int64) AcceptanceRecord {
	t.Helper()
	g := offer.Grant
	digest, _ := semanticDigest(g)
	value := map[string]any{"schemaVersion": 1, "sequence": revision, "offerDigest": mustDigest(t, offer),
		"acceptance": map[string]any{"schemaVersion": 1, "acceptanceId": "acceptance_localhistory001", "revision": revision,
			"state": "active", "issuedAt": g.IssuedAt, "expiresAt": g.ExpiresAt, "exportId": g.ExportID, "grantRevision": g.Revision,
			"grantDigest": digest, "peerId": g.PeerID, "participantNodeId": g.ParticipantNodeID, "authorityNodeId": g.AuthorityNodeID,
			"memberId": connection.Receipt.Membership.MemberID, "teamId": g.TeamID, "roomIds": g.RoomIDS, "capabilities": g.Capabilities},
		"projection": map[string]any{"schemaVersion": 1, "projectionAgentId": "agent_remoteprojection001", "peerId": g.PeerID,
			"authorityNodeId": g.AuthorityNodeID, "teamId": g.TeamID, "localAgentId": g.LocalAgentID, "exportId": g.ExportID,
			"acceptanceId": "acceptance_localhistory001", "acceptanceRevision": revision, "displayName": offer.DisplayName,
			"role": offer.Role, "capabilities": g.Capabilities}}
	raw, _ := json.Marshal(value)
	var record AcceptanceRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	return record
}

func mustDigest(t *testing.T, value any) string {
	t.Helper()
	digest, err := semanticDigest(value)
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func signedAcceptanceSnapshot(t *testing.T, host *Signer, offers []AgentOffer, records []AcceptanceRecord, now time.Time) ExportSyncReceipt {
	t.Helper()
	connection := LocalConnection{}
	for _, offer := range offers {
		connection.Exports = append(connection.Exports, offer.Grant)
	}
	g, _ := currentLocalGrant(connection, offers[0].Grant.LocalAgentID)
	result := ExportSyncReceipt{SchemaVersion: 1, PeerID: g.PeerID, LocalAgentID: g.LocalAgentID,
		ExportID: g.ExportID, GrantRevision: g.Revision, GrantDigest: mustDigest(t, g), ExportHistoryLength: int64(len(offers)),
		HistoryDigest: mustDigest(t, exportHistoryContent(g.LocalAgentID, offers)), AcceptanceHistory: records}
	return resignAcceptanceSnapshot(t, host, result, g.ParticipantNodeID, now)
}

func resignAcceptanceSnapshot(t *testing.T, host *Signer, snapshot ExportSyncReceipt, participantID string, now time.Time) ExportSyncReceipt {
	t.Helper()
	raw, _ := json.Marshal(snapshot)
	var content map[string]any
	if err := json.Unmarshal(raw, &content); err != nil {
		t.Fatal(err)
	}
	delete(content, "schemaVersion")
	delete(content, "proof")
	nonce, _ := NewNonce()
	proof, err := host.Sign(ProofContext{Purpose: "agent.export", AudienceNodeID: participantID,
		OperationID: "op_acceptancesnapshot001", Nonce: nonce, SubjectDigest: mustDigest(t, content)}, now)
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Proof = proof
	return snapshot
}

func TestAcceptanceSnapshotRequiresBothSidesAndRetainsSignedEvidenceAfterRestart(t *testing.T) {
	e, store, root, source, entry, host, now := acceptanceFixture(t)
	state, _ := store.Read()
	m := state.Connections[0].Receipt.Membership
	room := entry.Offer.Grant.RoomIDS[0]
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now); err == nil {
		t.Fatal("offer became acceptance")
	}
	first := fixtureAcceptance(t, state.Connections[0], entry.Offer, 1)
	snapshot := signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer}, []AcceptanceRecord{first}, now)
	if err := e.installAcceptanceSnapshot(m.MembershipID, snapshot, now); err != nil {
		t.Fatal("install", err)
	}
	if effective, err := e.Effective(m.MembershipID, source.AgentID, room, now); err != nil || !equalJSON(effective, first) {
		t.Fatal("bilateral intersection", err)
	}
	reopened, err := OpenStore(root, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	e, _ = NewExporter(reopened, func(string) (ExportSource, error) { return *source, nil })
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now.Add(time.Minute)); err != nil {
		t.Fatal("stored evidence outlives short proof", err)
	}
	expires, _ := time.Parse(time.RFC3339Nano, first.Acceptance.ExpiresAt)
	for _, at := range []time.Time{now.Add(-time.Minute), expires} {
		if _, err := e.Effective(m.MembershipID, source.AgentID, room, at); err == nil {
			t.Fatal("future or expired authority accepted")
		}
	}
	if _, err := e.Effective(m.MembershipID, source.AgentID, "room_notexported001", now); err == nil {
		t.Fatal("Room widened")
	}
	source.Configuration.Command = []string{"/changed/runtime"}
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now); err == nil {
		t.Fatal("Runtime configuration changed")
	}
	*source = fixtureExportSource()
	state, _ = reopened.Read()
	request := fixtureExportRequest(state, *source)
	request.OperationID = "op_exportsecond001"
	revised, err := e.Prepare(state.Revision, request, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now); err == nil {
		t.Fatal("old acceptance authorized new grant")
	}
	second := fixtureAcceptance(t, state.Connections[0], revised.Offer, 2)
	snapshot = signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer, revised.Offer}, []AcceptanceRecord{first, second}, now)
	if err = e.installAcceptanceSnapshot(m.MembershipID, snapshot, now); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now); err != nil {
		t.Fatal(err)
	}
	revoked := second
	revoked.Sequence = 3
	revoked.Acceptance.Revision = 3
	revoked.Acceptance.State = "revoked"
	revoked.Projection.AcceptanceRevision = 3
	withdrawn := signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer, revised.Offer}, []AcceptanceRecord{first, second, revoked}, now)
	if err = e.installAcceptanceSnapshot(m.MembershipID, withdrawn, now); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Effective(m.MembershipID, source.AgentID, room, now); err == nil {
		t.Fatal("Host revocation ignored")
	}
	if e.installAcceptanceSnapshot(m.MembershipID, snapshot, now) == nil {
		t.Fatal("older signed response revived head")
	}
	if _, err := OpenStore(root, state.Participant, state.LocalUserID); err != nil {
		t.Fatal("revoked evidence cannot reopen", err)
	}
	state, _ = reopened.Read()
	state.Connections[0].State = "left"
	state.Revision++
	if err := reopened.Update(state.Revision-1, state, now); err != nil {
		t.Fatal(err)
	}
	if e.installAcceptanceSnapshot(m.MembershipID, withdrawn, now) == nil {
		t.Fatal("left membership resumed synchronization")
	}
}

func TestAcceptanceSnapshotRejectsSignedGapsReorderingForgeryAndProjectionSubstitution(t *testing.T) {
	e, store, _, _, entry, host, now := acceptanceFixture(t)
	state, _ := store.Read()
	m := state.Connections[0].Receipt.Membership
	first := fixtureAcceptance(t, state.Connections[0], entry.Offer, 1)
	second := fixtureAcceptance(t, state.Connections[0], entry.Offer, 2)
	base := signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer}, []AcceptanceRecord{first, second}, now)
	mutations := []struct {
		name   string
		change func(*ExportSyncReceipt)
	}{
		{"gap", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].Sequence = 3 }},
		{"reorder", func(s *ExportSyncReceipt) {
			s.AcceptanceHistory[0], s.AcceptanceHistory[1] = s.AcceptanceHistory[1], s.AcceptanceHistory[0]
		}},
		{"missing first", func(s *ExportSyncReceipt) { s.AcceptanceHistory = s.AcceptanceHistory[1:] }},
		{"different mapping", func(s *ExportSyncReceipt) {
			s.AcceptanceHistory[1].Projection.ProjectionAgentID = "agent_substituted001"
		}},
		{"different Peer", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].Acceptance.PeerID = "peer_substituted001" }},
		{"different member", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].Acceptance.MemberID = "member_substituted001" }},
		{"different local Agent", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].Projection.LocalAgentID = "agent_substituted001" }},
		{"different label", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].Projection.DisplayName = "Unreviewed" }},
		{"different offer", func(s *ExportSyncReceipt) { s.AcceptanceHistory[1].OfferDigest = mustDigest(t, "other") }},
		{"wider room", func(s *ExportSyncReceipt) {
			s.AcceptanceHistory[1].Acceptance.RoomIDS = []string{"room_substituted001"}
		}},
		{"private capability", func(s *ExportSyncReceipt) {
			s.AcceptanceHistory[1].Acceptance.Capabilities.SupportsOwnerPrivateOutput = true
			s.AcceptanceHistory[1].Projection.Capabilities.SupportsOwnerPrivateOutput = true
		}},
		{"wrong history length", func(s *ExportSyncReceipt) { s.ExportHistoryLength = 2 }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			raw, _ := json.Marshal(base)
			var changed ExportSyncReceipt
			_ = json.Unmarshal(raw, &changed)
			mutation.change(&changed)
			changed = resignAcceptanceSnapshot(t, host, changed, m.ParticipantNodeID, now)
			if e.installAcceptanceSnapshot(m.MembershipID, changed, now) == nil {
				t.Fatal("invalid signed history accepted")
			}
			actual, _ := store.Read()
			if !equalJSON(actual, state) {
				t.Fatal("failed install changed durable state")
			}
		})
	}
	forged := base
	forged.Proof.Signature = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if e.installAcceptanceSnapshot(m.MembershipID, forged, now) == nil {
		t.Fatal("forged Host signature")
	}
	if e.installAcceptanceSnapshot(m.MembershipID, base, now.Add(time.Minute)) == nil {
		t.Fatal("expired live callback")
	}
	if err := e.installAcceptanceSnapshot(m.MembershipID, base, now); err != nil {
		t.Fatal("valid catchup", err)
	}
	current, _ := store.Read()
	current.Connections[0].AcceptanceSnapshots = nil
	current.Revision++
	if store.Update(current.Revision-1, current, now) == nil {
		t.Fatal("verified snapshot removed")
	}
}
