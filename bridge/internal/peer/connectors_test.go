package peer

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func waitConnectors(t *testing.T, c *Connectors, predicate func(ConnectorSnapshot) bool) ConnectorSnapshot {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		view := c.Snapshot()
		if predicate(view) {
			return view
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Peer connectors did not reach expected state", c.Snapshot())
	return ConnectorSnapshot{}
}

func connectorState(view ConnectorSnapshot, id string) string {
	for _, v := range view.Connections {
		if v.PeerID == id {
			return v.State
		}
	}
	return ""
}

func TestNativePeerConnectorsUseTwoRealHostsSyncGrantsAndIsolateRevocation(t *testing.T) {
	f, client, store, first, now := runtimeTLSParticipant(t)
	other := peerTLSFixture(t, now)
	otherClient, err := NewClient(other.Origin, other.Host, client.signer, other.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer otherClient.Close()
	otherClient.clock = client.clock
	operation := "op_connectorsecond001"
	preview, err := otherClient.Preview(context.Background(), other.Invitation.InvitationID, other.Secret, operation)
	if err != nil {
		t.Fatal(err)
	}
	vault, err := OpenHumanVault(filepath.Dir(store.directory), store)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJoinJournal(store, vault)
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.Save(PendingJoin{SchemaVersion: 1, Participant: client.signer.Identity(), LocalUserID: client.signer.LocalUserID(),
		Invitation: preview.Invitation, Secret: other.Secret, OperationID: operation, DisplayName: "Same local user",
		PreviewProof: preview.Proof, CreatedAt: now.Format(peerTimeFormat)}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := otherClient.ClaimPending(context.Background(), journal, operation); err == nil {
		t.Fatal("fixture did not drop first response")
	}
	second, err := otherClient.ClaimPending(context.Background(), journal, operation)
	if err != nil {
		t.Fatal(err)
	}
	local := fixtureExportSource()
	sources, err := NewSources([]config.AgentConfig{local.Configuration}, map[string]string{local.Configuration.Name: local.AgentID})
	if err != nil {
		t.Fatal(err)
	}
	c, err := NewConnectors(store, sources, client.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	c.clock = client.clock
	c.pollInterval, c.retryInterval, c.heartbeatInterval, c.syncInterval = 20*time.Millisecond, 50*time.Millisecond, 100*time.Millisecond, 500*time.Millisecond
	c.newClient = func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
		roots := f.roots
		if origin == other.Origin {
			roots = other.roots
		}
		value, err := NewClient(origin, host, client.signer, roots)
		if err == nil {
			value.clock = client.clock
		}
		return value, err
	}
	state, _ := store.Read()
	source, _ := sources.Resolve(local.AgentID)
	request := fixtureExportRequest(state, source)
	if _, err := c.exporter.Prepare(state.Revision, request, now); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("Peer workers failed to drain")
		}
	})
	firstID, secondID := first.Membership.PeerID, second.Membership.PeerID
	waitConnectors(t, c, func(v ConnectorSnapshot) bool {
		return connectorState(v, firstID) == "online" && connectorState(v, secondID) == "online"
	})
	// The automatic sync recovers its deliberately lost HTTP response.
	waitConnectors(t, c, func(v ConnectorSnapshot) bool {
		state, err := store.Read()
		return err == nil && len(state.Connections[0].AcceptanceSnapshots) > 0
	})
	counts := f.control(t, map[string]any{"action": "accept-agent"})
	if counts["offers"] != 1 || counts["acceptances"] != 1 {
		t.Fatal("real Host did not receive reviewed export", counts)
	}
	waitConnectors(t, c, func(v ConnectorSnapshot) bool {
		_, err := c.exporter.Effective(first.Membership.MembershipID, local.AgentID, *first.Membership.Scope.RoomID, now)
		return err == nil && connectorState(v, firstID) == "online"
	})
	// Wait for the acceptance history to finish replacing its old connection.
	time.Sleep(150 * time.Millisecond)
	waitConnectors(t, c, func(v ConnectorSnapshot) bool {
		return connectorState(v, firstID) == "online" && connectorState(v, secondID) == "online"
	})
	firstBinding, secondBinding := approvalBinding(), approvalBinding()
	firstBinding.PeerID, secondBinding.PeerID = firstID, secondID
	firstSession, err := c.Approvals().Open(ctx, firstBinding, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer firstSession.Close()
	secondSession, err := c.Approvals().Open(ctx, secondBinding, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer secondSession.Close()
	firstInput, secondInput := approvalInput(firstBinding, "approval_firstpeer001"), approvalInput(secondBinding, "approval_secondpeer001")
	firstDecision := askApproval(ctx, firstSession, firstInput)
	secondDecision := askApproval(ctx, secondSession, secondInput)
	firstView := waitApproval(t, c.Approvals(), firstInput.RequestID)
	secondView := waitApproval(t, c.Approvals(), secondInput.RequestID)
	// A retry notification with unchanged durable authority must be inert.
	c.LocalChange(secondID)
	f.control(t, map[string]any{"action": "revoke", "membershipId": first.Membership.MembershipID})
	select {
	case result := <-firstDecision:
		if result.err == nil || result.allow {
			t.Fatal("revoked Peer retained approval")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("actual Host revoke did not cancel approval")
	}
	if c.Approvals().Decide(approvalDecision(firstView)) == nil {
		t.Fatal("late first-Peer decision accepted")
	}
	if err := c.Approvals().Decide(approvalDecision(secondView)); err != nil {
		t.Fatal("other Peer was revoked", err)
	}
	select {
	case result := <-secondDecision:
		if result.err != nil || !result.allow {
			t.Fatal("unrelated approval canceled", result)
		}
	case <-time.After(time.Second):
		t.Fatal("other Peer approval blocked")
	}
	if counts := other.control(t, map[string]any{"action": "stats"}); counts["runtimeUpgrades"] != 1 {
		t.Fatal("one Peer failure restarted the other", counts)
	}
	state, _ = store.Read()
	state.Connections[1].State = "left"
	state.Revision++
	if err := store.Update(state.Revision-1, state, now); err != nil {
		t.Fatal(err)
	}
	c.LocalChange(secondID)
	view := waitConnectors(t, c, func(v ConnectorSnapshot) bool { return connectorState(v, secondID) == "left" })
	raw, _ := json.Marshal(view)
	for _, secret := range []string{first.MachineCredential.Token, second.MachineCredential.Token, f.Secret, other.Secret, local.Configuration.Command[0]} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("local connector status exposed private data")
		}
	}
}
