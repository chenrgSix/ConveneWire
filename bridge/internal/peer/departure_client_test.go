package peer

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestGoParticipantDepartureOverTLSRecoversLostResponseWithoutBusinessCredentials(t *testing.T) {
	f, client, store, joined, now := runtimeTLSParticipant(t)
	intent := LeaveIntent{SchemaVersion: 1, OperationID: "op_tlsdeparture001", Host: f.Host, HostOrigin: f.Origin,
		Participant: client.signer.Identity(), PeerID: joined.Membership.PeerID, MembershipID: joined.Membership.MembershipID}
	connection, err := client.ConnectRuntime(context.Background(), store, intent.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if _, err := client.Leave(context.Background(), intent); !errors.Is(err, ErrTransport) {
		t.Fatal("lost response incorrectly acknowledged", err)
	}
	if counts := f.control(t, map[string]any{"action": "stats"}); counts["departures"] != 1 {
		t.Fatal("Host departure did not persist", counts)
	}
	if err := connection.Heartbeat(context.Background()); err == nil {
		t.Fatal("departed Runtime remained authenticated")
	}
	// Rebuild the client after both membership and bearer have expired.
	later := now.Add(40 * 24 * time.Hour)
	f.control(t, map[string]any{"action": "clock", "now": later.Format(peerTimeFormat)})
	client.Close()
	restored, err := NewClient(f.Origin, f.Host, client.signer, f.roots)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	restored.clock = func() time.Time { return later }
	receipt, err := restored.Leave(context.Background(), intent)
	if err != nil || receipt.State != "revoked" || receipt.RecordedAt != now.Format(peerTimeFormat) {
		t.Fatal("exact revoked-only recovery", err)
	}
	for _, change := range []func(*LeaveReceipt){
		func(r *LeaveReceipt) { r.Intent.PeerID = "peer_different001" },
		func(r *LeaveReceipt) { r.RecordedAt = later.Add(time.Minute).Format(peerTimeFormat) },
		func(r *LeaveReceipt) { r.State = "active" },
		func(r *LeaveReceipt) { r.Proof.Signature = strings.Repeat("A", 86) },
	} {
		changed := receipt
		change(&changed)
		if VerifyLeaveReceipt(changed, intent, receipt.Proof.Payload.Nonce, later) == nil {
			t.Fatal("substituted departure receipt accepted")
		}
	}
	if VerifyLeaveReceipt(receipt, intent, receipt.Proof.Payload.Nonce, later.Add(time.Minute)) == nil {
		t.Fatal("stale departure proof accepted")
	}
	changed := intent
	changed.OperationID = "op_differentleave001"
	if _, err := restored.Leave(context.Background(), changed); err == nil {
		t.Fatal("changed recovery operation accepted")
	}
	if _, err := restored.ConnectRuntime(context.Background(), store, intent.MembershipID); err == nil {
		t.Fatal("receipt recovery restored Runtime rights")
	}
}
