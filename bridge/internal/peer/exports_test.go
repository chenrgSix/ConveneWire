package peer

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func fixtureExportSource() ExportSource {
	return ExportSource{AgentID: "agent_localexport001", Configuration: config.AgentConfig{
		Name: "Local writer", Role: "Reviewer", Adapter: "generic", RuntimeKind: "generic", PresetVersion: 1,
		Command: []string{"/private/owner/runtime", "--local-settings"}, Workspace: "/private/owner/project",
	}, Capabilities: wire.PeerCapabilities{SupportsStart: true, SupportsStreaming: true, SupportsTaskContextIsolation: true}}
}
func fixtureExportRequest(state State, source ExportSource) ExportRequest {
	m := state.Connections[0].Receipt.Membership
	return ExportRequest{MembershipID: m.MembershipID, LocalAgentID: source.AgentID, OperationID: "op_localexport001",
		RoomIDs: []string{*m.Scope.RoomID}, Capabilities: source.Capabilities, ExpiresAt: m.ExpiresAt}
}
func TestLocalExportPersistsOwnerIntentWithoutRuntimeConfigurationAndSurvivesReopen(t *testing.T) {
	state, _, now := fixtureState(t)
	store, root := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	resolve := func(id string) (ExportSource, error) {
		if id != source.AgentID {
			return ExportSource{}, ErrExport
		}
		return source, nil
	}
	exporter, _ := NewExporter(store, resolve)
	request := fixtureExportRequest(state, source)
	entry, err := exporter.Prepare(1, request, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := exporter.Current(request.MembershipID, request.LocalAgentID, now.Add(-time.Minute)); err == nil {
		t.Fatal("future grant accepted after local clock rollback")
	}
	if current, err := exporter.Current(request.MembershipID, request.LocalAgentID, now); err != nil || !equalJSON(current, entry) {
		t.Fatal("current", err)
	}
	if old, err := exporter.Prepare(1, request, now.Add(time.Hour)); err != nil || !equalJSON(old, entry) {
		t.Fatal("same operation renewed", err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "peer-state", "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{source.Configuration.Workspace, source.Configuration.Command[0], "--local-settings", "configuration\""} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("configuration leaked", secret)
		}
	}
	reopened, err := OpenStore(root, state.Participant, state.LocalUserID)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := NewExporter(reopened, resolve)
	if got, err := restored.Current(request.MembershipID, request.LocalAgentID, now); err != nil || !equalJSON(got, entry) {
		t.Fatal("reopen", err)
	}
	changed, _ := reopened.Read()
	changed.Connections[0].LocalExports[0].Offer.DisplayName = "Unreviewed rename"
	changed.Revision++
	if reopened.Update(changed.Revision-1, changed, now) == nil {
		t.Fatal("immutable metadata rewritten")
	}
	changed, _ = reopened.Read()
	changed.Connections[0].LocalExports = nil
	changed.Revision++
	if reopened.Update(changed.Revision-1, changed, now) == nil {
		t.Fatal("review history removed")
	}
}

func TestLocalExportRejectsConfigChangePrivateOutputDeviceTrustAndExpandedCapabilities(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	exporter, _ := NewExporter(store, func(id string) (ExportSource, error) { return source, nil })
	request := fixtureExportRequest(state, source)
	entry, err := exporter.Prepare(1, request, now)
	if err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ExportSource){
		func(s *ExportSource) { s.Configuration.Workspace = "/private/different" },
		func(s *ExportSource) { s.Configuration.Command = []string{"/private/different"} },
		func(s *ExportSource) { s.Capabilities.SupportsStreaming = false },
		func(s *ExportSource) { s.Configuration.OwnerPrivateOutput = true },
		func(s *ExportSource) { s.Configuration.TrustedExecutionRevision = 1 },
		func(s *ExportSource) { s.Configuration.CentralApprovalRevision = 1 },
		func(s *ExportSource) { s.Configuration.AuthorityNodeID = "node_deviceauthority001" },
		func(s *ExportSource) { s.AgentID = "agent_different001" },
	} {
		source = fixtureExportSource()
		mutate(&source)
		if _, err := exporter.Current(request.MembershipID, request.LocalAgentID, now); err == nil {
			t.Fatal("changed source retained authority")
		}
	}
	source = fixtureExportSource()
	bad := request
	bad.OperationID = "op_expanded001"
	bad.Capabilities.SupportsResume = true
	if _, err := exporter.Prepare(2, bad, now); err == nil {
		t.Fatal("unsupported capability exported")
	}
	bad = request
	bad.RoomIDs = []string{"room_outside001"}
	if _, err := exporter.Prepare(2, bad, now); err == nil {
		t.Fatal("same operation scope changed")
	}
	source.Configuration.Name = "Renamed by owner"
	if _, err := exporter.Prepare(2, request, now); !errors.Is(err, ErrConflict) {
		t.Fatal("same operation renamed", err)
	}
	request.OperationID = "op_reviewrename001"
	next, err := exporter.Prepare(2, request, now)
	if err != nil {
		t.Fatal(err)
	}
	if next.Offer.Grant.ExportID != entry.Offer.Grant.ExportID || next.Offer.Grant.Revision != 2 || next.ConfigurationDigest == entry.ConfigurationDigest {
		t.Fatal("configuration change did not revise grant")
	}
}

func TestLocalWithdrawalDoesNotRequireRuntimeOrHostAndRepublishNeedsExplicitNewLineage(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	removed := false
	exporter, _ := NewExporter(store, func(string) (ExportSource, error) {
		if removed {
			return ExportSource{}, ErrExport
		}
		return source, nil
	})
	request := fixtureExportRequest(state, source)
	first, err := exporter.Prepare(1, request, now)
	if err != nil {
		t.Fatal(err)
	}
	removed = true
	revoked, err := exporter.Withdraw(2, request.MembershipID, first.Offer.Grant.ExportID, 1, "op_withdraw001", now)
	if err != nil || revoked.Offer.Grant.State != "revoked" {
		t.Fatal("local withdrawal", err)
	}
	if _, err := exporter.Current(request.MembershipID, request.LocalAgentID, now); err == nil {
		t.Fatal("withdrawn export current")
	}
	if replay, err := exporter.Withdraw(2, request.MembershipID, first.Offer.Grant.ExportID, 1, "op_withdraw001", now.Add(time.Hour)); err != nil || !equalJSON(replay, revoked) {
		t.Fatal("withdraw retry", err)
	}
	removed = false
	if replay, err := exporter.Prepare(1, request, now); err != nil || !equalJSON(replay, first) {
		t.Fatal("historical operation receipt", err)
	}
	if _, err := exporter.Current(request.MembershipID, request.LocalAgentID, now); err == nil {
		t.Fatal("historical retry revived grant")
	}
	request.OperationID = "op_reexport001"
	if _, err := exporter.Prepare(3, request, now); err == nil {
		t.Fatal("revoked lineage reused")
	}
	request.ReplaceLineage = true
	fresh, err := exporter.Prepare(3, request, now)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.Offer.Grant.ExportID == first.Offer.Grant.ExportID || fresh.Offer.Grant.Revision != 1 {
		t.Fatal("new lineage missing")
	}
	left, _ := store.Read()
	left.Connections[0].State = "left"
	left.Revision++
	if err := store.Update(4, left, now); err != nil {
		t.Fatal(err)
	}
	if _, err := exporter.Current(request.MembershipID, request.LocalAgentID, now); err == nil {
		t.Fatal("left Peer exported")
	}
	removed = true
	if _, err := exporter.Withdraw(5, request.MembershipID, fresh.Offer.Grant.ExportID, 1, "op_withdrawleft001", now.Add(40*24*time.Hour)); err != nil {
		t.Fatal("expired/left withdrawal", err)
	}
}

func TestConcurrentLocalExportReviewHasOneWinnerAndCannotInventLocalIdentity(t *testing.T) {
	state, _, now := fixtureState(t)
	store, _ := newStore(t, state)
	if err := store.Update(0, state, now); err != nil {
		t.Fatal(err)
	}
	source := fixtureExportSource()
	exporter, _ := NewExporter(store, func(string) (ExportSource, error) { return source, nil })
	request := fixtureExportRequest(state, source)
	request.LocalAgentID = "agent_invented001"
	if _, err := exporter.Prepare(1, request, now); err == nil {
		t.Fatal("invented local identity accepted")
	}
	request.LocalAgentID = source.AgentID
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, op := range []string{"op_reviewone001", "op_reviewtwo001"} {
		workers.Add(1)
		go func(op string) {
			defer workers.Done()
			r := request
			r.OperationID = op
			_, err := exporter.Prepare(1, r, now)
			results <- err
		}(op)
	}
	workers.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("concurrent reviews", successes, conflicts)
	}
}
