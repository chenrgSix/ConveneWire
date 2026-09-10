package peer

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
)

func TestOwnerExportReviewPinsConfigurationAndRedactsPrivateReceipts(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	sources, _ := NewSources([]config.AgentConfig{source.Configuration}, map[string]string{source.Configuration.Name: source.AgentID})
	review := sources.Reviews()[0]
	resolved, _ := sources.Resolve(source.AgentID)
	exporter, _ := NewExporter(store, sources.Resolve)
	request := fixtureExportRequest(state, resolved)
	if _, err := exporter.PrepareReviewed(state.Revision, strings.Repeat("0", 64), request, now); err == nil {
		t.Fatal("unreviewed configuration exported")
	}
	entry, err := exporter.PrepareReviewed(state.Revision, review.ConfigurationDigest, request, now)
	if err != nil {
		t.Fatal(err)
	}
	view, err := exporter.OwnerState(now)
	if err != nil || len(view.Connections) != 1 || len(view.Connections[0].Exports) != 1 || !view.Connections[0].Exports[0].Current {
		t.Fatal("owner view", view, err)
	}
	raw, _ := json.Marshal(view)
	for _, secret := range []string{"machineCredential", "humanCredential", "proof", "token", source.Configuration.Command[0]} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("owner inventory exposed a private receipt", secret)
		}
	}
	// Runtime removal does not remove durable local withdrawal authority.
	removed, _ := NewSources(nil, nil)
	revoker, _ := NewExporter(store, removed.Resolve)
	withdrawn, err := revoker.Withdraw(view.Revision, request.MembershipID, entry.Offer.Grant.ExportID, entry.Offer.Grant.Revision, "op_ownerwithdraw001", now)
	if err != nil || withdrawn.Offer.Grant.State != "revoked" {
		t.Fatal("removed Runtime prevented withdrawal", err)
	}
	view, err = revoker.OwnerState(now)
	if err != nil || view.Connections[0].Exports[0].Current {
		t.Fatal("withdrawn source remains current", err)
	}
}

func TestOwnerReviewCannotRaceIntoAnotherResolverConfiguration(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	digest, _ := semanticDigest(source)
	current := source
	reads := 0
	exporter, _ := NewExporter(store, func(string) (ExportSource, error) {
		reads++
		if reads > 1 {
			current.Configuration = cloneSourceConfig(source.Configuration)
			current.Configuration.Command[0] = "/unreviewed/runtime"
		}
		return current, nil
	})
	entry, err := exporter.PrepareReviewed(state.Revision, digest, fixtureExportRequest(state, source), now)
	if err != nil || entry.ConfigurationDigest != digest {
		t.Fatal("review switched into another configuration", err)
	}
	if _, err := exporter.Current(state.Connections[0].Receipt.Membership.MembershipID, source.AgentID, now); err == nil {
		t.Fatal("changed local Runtime consumed reviewed authority")
	}
}

func TestOwnerInventoryKeepsNewestExportLineageAfterOldLineageWithdrawal(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	exporter, _ := NewExporter(store, func(string) (ExportSource, error) { return source, nil })
	request := fixtureExportRequest(state, source)
	first, err := exporter.Prepare(1, request, now)
	if err != nil {
		t.Fatal(err)
	}
	request.OperationID, request.ReplaceLineage = "op_ownernewlineage001", true
	second, err := exporter.Prepare(2, request, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := exporter.Withdraw(3, request.MembershipID, first.Offer.Grant.ExportID, 1, "op_owneroldwithdraw001", now); err != nil {
		t.Fatal(err)
	}
	view, err := exporter.OwnerState(now)
	if err != nil || view.Connections[0].Exports[0].Offer.Grant.ExportID != second.Offer.Grant.ExportID || !view.Connections[0].Exports[0].Current {
		t.Fatal("old lineage hid the new export", err)
	}
}

func TestOwnerInventoryDistinguishesLocalGrantFromRetainedHostAcceptance(t *testing.T) {
	exporter, store, _, source, entry, host, now := acceptanceFixture(t)
	state, _ := store.Read()
	connection := state.Connections[0]
	room := entry.Offer.Grant.RoomIDS[0]
	inventory := func(at time.Time) OwnerExportView {
		t.Helper()
		state, err := exporter.OwnerState(at)
		if err != nil || len(state.Connections) != 1 || len(state.Connections[0].Exports) != 1 {
			t.Fatal("missing owner projection", err)
		}
		return state.Connections[0].Exports[0]
	}
	initial := inventory(now)
	if !initial.Current || len(initial.EffectiveRoomIDs) != 0 || initial.Acceptance != nil {
		t.Fatal("local offer became Host acceptance")
	}
	record := fixtureAcceptance(t, connection, entry.Offer, 1)
	record.Acceptance.ExpiresAt = now.Add(time.Minute).UTC().Format(peerTimeFormat)
	receipt := signedAcceptanceSnapshot(t, host, []AgentOffer{entry.Offer}, []AcceptanceRecord{record}, now)
	if err := exporter.installAcceptanceSnapshot(connection.Receipt.Membership.MembershipID, receipt, now); err != nil {
		t.Fatal(err)
	}
	accepted := inventory(now)
	if !accepted.Current || len(accepted.EffectiveRoomIDs) != 1 || accepted.EffectiveRoomIDs[0] != room || accepted.Acceptance == nil {
		t.Fatal("missing bilateral projection")
	}
	expired := inventory(now.Add(time.Minute))
	if !expired.Current || len(expired.EffectiveRoomIDs) != 0 || expired.Acceptance == nil {
		t.Fatal("expired Host acceptance changed local grant or stayed effective")
	}
	oldWorkspace := source.Configuration.Workspace
	source.Configuration.Workspace = t.TempDir()
	changed := inventory(now)
	if changed.Current || len(changed.EffectiveRoomIDs) != 0 {
		t.Fatal("changed Workspace reused old consent")
	}
	source.Configuration.Workspace = oldWorkspace
	saved, _ := store.Read()
	if _, err := exporter.Withdraw(saved.Revision, connection.Receipt.Membership.MembershipID, entry.Offer.Grant.ExportID, entry.Offer.Grant.Revision, "op_ownerwithdrawstate001", now); err != nil {
		t.Fatal(err)
	}
	withdrawn := inventory(now)
	if withdrawn.Current || len(withdrawn.EffectiveRoomIDs) != 0 || withdrawn.Acceptance == nil || withdrawn.Offer.Grant.State != "revoked" {
		t.Fatal("withdrawal hid retained history or stayed effective")
	}
}
