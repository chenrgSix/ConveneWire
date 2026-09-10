package peer

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	localwire "convenewire.dev/contracts/generated/go/localnode"
)

type peerRoundTrip func(*http.Request) (*http.Response, error)

func (f peerRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGoRuntimeIdentityChangeDuringHostProofCannotSendMachineBearer(t *testing.T) {
	f, client, store, receipt, _ := runtimeTLSParticipant(t)
	var valid atomic.Bool
	valid.Store(true)
	client.beforeOperation = func() error {
		if !valid.Load() {
			return ErrProof
		}
		return nil
	}
	client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
		response, err := client.transport.RoundTrip(request)
		if request.URL.Path == "/api/peer/identity" {
			valid.Store(false)
		}
		return response, err
	})
	if _, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID); err == nil {
		t.Fatal("changed native identity reused completed Host proof")
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["runtimeUpgrades"] != 0 {
		t.Fatal("machine bearer escaped after native identity change", counts)
	}
	client.http.Transport = client.transport
	valid.Store(true)
	connection, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	valid.Store(false)
	if err := connection.Heartbeat(context.Background()); err == nil {
		t.Fatal("heartbeat retained changed native identity")
	}
	waitRuntimeClosed(t, connection)
}

func runtimeTLSParticipant(t *testing.T) (*peerHTTPFixture, *Client, *Store, JoinReceipt, time.Time) {
	t.Helper()
	return runtimeTLSParticipantAt(t, time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC))
}

func runtimeTLSParticipantAt(t *testing.T, now time.Time) (*peerHTTPFixture, *Client, *Store, JoinReceipt, time.Time) {
	t.Helper()
	f := peerTLSFixture(t, now)
	signer, err := NewLocalSigner(localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_tlsruntime001", OwnerUserID: "user_tlsruntime001",
		Port: 40391, Secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
	if err != nil {
		t.Fatal(err)
	}
	client, err := NewClient(f.Origin, f.Host, signer, f.roots)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	client.clock = func() time.Time { return now }
	operation := "op_tlsruntimeclaim001"
	preview, err := client.Preview(context.Background(), f.Invitation.InvitationID, f.Secret, operation)
	if err != nil {
		t.Fatal(err)
	}
	store, root := newStore(t, State{Participant: signer.Identity(), LocalUserID: signer.LocalUserID()})
	human, err := OpenHumanVault(root, store)
	if err != nil {
		t.Fatal(err)
	}
	journal, err := OpenJoinJournal(store, human)
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.Save(PendingJoin{SchemaVersion: 1, Participant: signer.Identity(), LocalUserID: signer.LocalUserID(), Invitation: preview.Invitation,
		Secret: f.Secret, OperationID: operation, DisplayName: "Runtime Participant", PreviewProof: preview.Proof, CreatedAt: now.Format(peerTimeFormat)}, now); err != nil {
		t.Fatal(err)
	}
	if _, err := client.ClaimPending(context.Background(), journal, operation); err == nil {
		t.Fatal("fixture lost response was unexpectedly acknowledged")
	}
	receipt, err := client.ClaimPending(context.Background(), journal, operation)
	if err != nil {
		t.Fatal(err)
	}
	return f, client, store, receipt, now
}

func waitRuntimeClosed(t *testing.T, connection *RuntimeConnection) {
	t.Helper()
	select {
	case <-connection.Context().Done():
	case <-time.After(3 * time.Second):
		t.Fatal("Peer closure did not invalidate the local connection context")
	}
	connection.Wait()
}

func TestGoRuntimeUsesRealHostProofsAndDetectsReplacementAndRevocationWithoutPolling(t *testing.T) {
	f, client, store, receipt, _ := runtimeTLSParticipant(t)
	membership := receipt.Membership.MembershipID
	untrusted, err := NewClient(f.Origin, f.Host, client.signer, nil)
	if err != nil {
		t.Fatal(err)
	}
	untrusted.clock = client.clock
	defer untrusted.Close()
	if _, err := untrusted.ConnectRuntime(context.Background(), store, membership); err == nil {
		t.Fatal("Runtime bearer sent through untrusted TLS")
	}
	wrongHost := f.Host
	wrongHost.PublicKey = client.signer.Identity().PublicKey
	wrong, err := NewClient(f.Origin, wrongHost, client.signer, f.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer wrong.Close()
	wrong.clock = client.clock
	if _, err := wrong.ConnectRuntime(context.Background(), store, membership); err == nil {
		t.Fatal("changed Host identity opened a Runtime channel")
	}
	if count := f.control(t, map[string]any{"action": "stats"}); count["runtimeUpgrades"] != 0 {
		t.Fatal("machine bearer sent before origin and identity validation", count)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	first, err := client.ConnectRuntime(ctx, store, membership)
	if err != nil {
		t.Fatal("actual TLS Runtime handshake", err)
	}
	defer first.Close()
	if first.Binding().PeerID != receipt.Membership.PeerID || first.Binding().CredentialID != receipt.MachineCredential.CredentialID || first.Binding().HostOrigin != f.Origin {
		t.Fatal("Runtime selected another membership, credential or origin")
	}
	for i := 0; i < 3; i++ {
		if err := first.Heartbeat(ctx); err != nil {
			t.Fatal("heartbeat after handshake context cleanup", err)
		}
	}
	second, err := client.ConnectRuntime(ctx, store, membership)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if first.Binding().ConnectionID == second.Binding().ConnectionID {
		t.Fatal("reconnect reused a previous channel binding")
	}
	waitRuntimeClosed(t, first)
	if err := second.Heartbeat(ctx); err != nil {
		t.Fatal("replacement did not retain independent liveness", err)
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": membership})
	// No Heartbeat call is needed to observe the Host's revocation close.
	waitRuntimeClosed(t, second)
	if _, err := client.ConnectRuntime(ctx, store, membership); err == nil {
		t.Fatal("captured revoked credential reconnected")
	}
}

func TestGoRuntimeLocalLeaveAndCoreCancellationFenceTheSameConnection(t *testing.T) {
	_, client, store, receipt, now := runtimeTLSParticipant(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	first, err := client.ConnectRuntime(ctx, store, receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	cancel()
	waitRuntimeClosed(t, first)
	second, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	state, err := store.Read()
	if err != nil {
		t.Fatal(err)
	}
	state.Connections[0].State = "left"
	state.Revision++
	if err := store.Update(state.Revision-1, state, now); err != nil {
		t.Fatal(err)
	}
	if err := second.Heartbeat(context.Background()); err == nil {
		t.Fatal("local leave retained machine activity")
	}
	waitRuntimeClosed(t, second)
	if _, err := client.ConnectRuntime(context.Background(), store, receipt.Membership.MembershipID); err == nil {
		t.Fatal("local left membership reconnected")
	}
}
