package peer

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestPeerRunWorkerUsesIndependentHostsAndOnePhysicalAgent(t *testing.T) {
	first, client, c, firstPartition, firstBinding := runExecutionFixture(t, "generic-controlled")
	second := peerTLSFixture(t, c.clock())
	secondClient, err := NewClient(second.Origin, second.Host, client.signer, second.roots)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(secondClient.Close)
	secondClient.clock = c.clock
	ctx := context.Background()
	operation := "op_workersecondhost001"
	preview, err := secondClient.Preview(ctx, second.Invitation.InvitationID, second.Secret, operation)
	if err != nil {
		t.Fatal(err)
	}
	vault, err := OpenHumanVault(filepath.Dir(c.store.directory), c.store)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJoinJournal(c.store, vault)
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.Save(PendingJoin{SchemaVersion: 1, Participant: client.signer.Identity(), LocalUserID: client.signer.LocalUserID(),
		Invitation: preview.Invitation, Secret: second.Secret, OperationID: operation, DisplayName: "Independent second Host",
		PreviewProof: preview.Proof, CreatedAt: c.clock().Format(peerTimeFormat)}, c.clock()); err != nil {
		t.Fatal(err)
	}
	if _, err := secondClient.ClaimPending(ctx, journal, operation); err == nil {
		t.Fatal("fixture failed to drop the initial claim")
	}
	joined, err := secondClient.ClaimPending(ctx, journal, operation)
	if err != nil {
		t.Fatal(err)
	}
	source, _ := c.sources.Resolve(firstBinding.LocalAgentID)
	state, err := c.store.Read()
	if err != nil {
		t.Fatal(err)
	}
	request := ExportRequest{MembershipID: joined.Membership.MembershipID, LocalAgentID: source.AgentID,
		OperationID: "op_exportsecondhost001", RoomIDs: []string{*joined.Membership.Scope.RoomID},
		Capabilities: source.Capabilities, ExpiresAt: joined.Membership.ExpiresAt}
	if _, err := c.exporter.Prepare(state.Revision, request, c.clock()); err != nil {
		t.Fatal(err)
	}
	if _, err := secondClient.SyncExports(ctx, c.exporter, request.MembershipID, source.AgentID, "op_syncsecondhost001"); err == nil {
		t.Fatal("fixture failed to drop the initial export sync")
	}
	if _, err := secondClient.SyncExports(ctx, c.exporter, request.MembershipID, source.AgentID, "op_syncsecondhost001"); err != nil {
		t.Fatal(err)
	}
	second.control(t, map[string]any{"action": "accept-agent"})
	if _, err := secondClient.SyncExports(ctx, c.exporter, request.MembershipID, source.AgentID, "op_syncsecondhost002"); err != nil {
		t.Fatal(err)
	}
	var value struct{ Request json.RawMessage }
	second.controlResult(t, map[string]any{"action": "create-run"}, &value)
	var remote struct{ Binding wire.PeerExecutionBinding }
	if wire.VerifyRunRequest(value.Request) != nil || wire.Decode("PeerRunRequest", value.Request, &remote) != nil {
		t.Fatal("second Host request did not verify")
	}
	secondPartition, err := c.runtime.partitions.Open(joined.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	if firstBinding.AuthorityNodeID == remote.Binding.AuthorityNodeID || firstBinding.PeerID == remote.Binding.PeerID ||
		firstBinding.RoomID != remote.Binding.RoomID || firstBinding.LocalAgentID != remote.Binding.LocalAgentID ||
		firstPartition.DataDir() == secondPartition.DataDir() {
		t.Fatal("fixture failed to isolate two Hosts with colliding local Room/Agent IDs")
	}
	c.newClient = func(origin string, host wire.PeerNodeIdentity) (*Client, error) {
		roots := first.roots
		if origin == second.Origin {
			roots = second.roots
		} else if origin != first.Origin {
			return nil, ErrProof
		}
		client, err := NewClient(origin, host, client.signer, roots)
		if err == nil {
			client.clock = c.clock
		}
		return client, err
	}
	stop := startRunWorker(t, c)
	awaitRunWorker(t, "both Hosts did not reach the shared worker", func() bool {
		a, errA := firstPartition.Runs().Load(firstBinding.RunID)
		b, errB := secondPartition.Runs().Load(remote.Binding.RunID)
		_, child := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-started"))
		return errA == nil && errB == nil && child == nil && (a.StartedAt == "") != (b.StartedAt == "")
	})
	if err := os.WriteFile(filepath.Join(source.Configuration.Workspace, "runtime-release"), []byte("release"), 0600); err != nil {
		t.Fatal(err)
	}
	assertRunSettledOnce(t, first, firstPartition, firstBinding.RunID, "completed")
	assertRunSettledOnce(t, second, secondPartition, remote.Binding.RunID, "completed")
	stop()
	marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || strings.Count(string(marker), "started\n") != 2 {
		t.Fatal("independent Host execution was lost or repeated", string(marker), err)
	}
	if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "runtime-overlapped")); !os.IsNotExist(err) {
		t.Fatal("two Hosts bypassed the shared physical scheduler")
	}
}
