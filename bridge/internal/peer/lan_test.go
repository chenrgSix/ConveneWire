package peer

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestManagedLANReviewJoinRestartRuntimeAndRevocation(t *testing.T) {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, address := range addresses {
		if ip, ok := address.(*net.IPNet); ok && ip.IP.To4() != nil && ip.IP.IsPrivate() {
			found = true
		}
	}
	if !found {
		t.Skip("actual local-interface interop requires a private IPv4 interface")
	}
	t.Setenv("CONVENE_WIRE_MANAGED_LAN_FIXTURE", "1")
	now := time.Now().UTC().Truncate(time.Millisecond)
	f := peerTLSFixture(t, now)
	if f.LAN == nil {
		t.Fatal("missing signed transport")
	}
	owner, root := nativeOwnerFixture(t, func() error { return nil })
	owner.clock = func() time.Time { return now }
	input := InvitationInput{Host: f.Host, HostOrigin: f.Origin, InvitationID: f.Invitation.InvitationID, Secret: f.Secret, OperationID: "op_managedlanjoin001", LAN: f.LAN}
	review, err := owner.Preview(context.Background(), input)
	if err != nil || review.LANDigest == "" {
		t.Fatal("actual signed LAN preview", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "peer-lan")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("preview persisted trust", err)
	}
	confirmation := JoinConfirmation{InvitationInput: input, DisplayName: "LAN Guest", ReviewedInvitationDigest: review.InvitationDigest, ReviewedLANDigest: review.LANDigest}
	changed := confirmation
	changed.ReviewedLANDigest = strings.Repeat("0", 64)
	if _, err := owner.Confirm(context.Background(), changed); !errors.Is(err, ErrProof) {
		t.Fatal("transport review mismatch", err)
	}
	if _, err := owner.Confirm(context.Background(), confirmation); err == nil {
		t.Fatal("fixture must drop committed claim response")
	}
	if f.control(t, map[string]any{"action": "stats"})["memberships"] != 1 {
		t.Fatal("claim did not commit once")
	}
	trustPath := filepath.Join(root, "peer-lan", f.Host.NodeID, "config.json")
	raw, err := privatefs.ReadFile(trustPath, 16384)
	if err != nil || strings.Contains(string(raw), input.Secret) {
		t.Fatal("protected trust file", err)
	}
	owner.Close()
	restored, err := NewOwnerAccess(root, owner.store, owner.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)
	restored.clock = owner.clock
	outcome, err := restored.Recover(context.Background(), input.OperationID)
	if err != nil || outcome.State != "active" {
		t.Fatal("recover committed LAN join", err)
	}
	client, err := NewNativeClient(root, f.Origin, f.Host, owner.signer, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(client.Close)
	client.clock = owner.clock
	connection, err := client.ConnectRuntime(context.Background(), owner.store, outcome.Membership.MembershipID)
	if err != nil {
		t.Fatal("actual native TLS WebSocket", err)
	}
	if err := connection.Heartbeat(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.control(t, map[string]any{"action": "lan-off"})
	waitRuntimeClosed(t, connection)
	connection.Close()
	if _, err := client.ConnectRuntime(context.Background(), owner.store, outcome.Membership.MembershipID); err == nil {
		t.Fatal("disabled LAN still reachable")
	}
	f.control(t, map[string]any{"action": "lan-on"})
	f.control(t, map[string]any{"action": "restart-host"})
	connection, err = client.ConnectRuntime(context.Background(), owner.store, outcome.Membership.MembershipID)
	if err != nil {
		t.Fatal("same identity, CA and port after restart", err)
	}
	defer connection.Close()
	if _, err := restored.HumanEntry(context.Background(), outcome.Membership.MembershipID, wire.PeerScope(outcome.Membership.Scope), "op_lanbrowser001"); !errors.Is(err, ErrTLSConfiguration) {
		t.Fatal("LAN must not emit an untrusted external browser entry", err)
	}
	for _, change := range []string{"address", "public", "loopback", "signature", "ca", "host", "origin", "expiry"} {
		t.Run(change, func(t *testing.T) {
			var proof LANProof
			if err := json.Unmarshal(raw, &proof); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "address":
				proof.Transport.Endpoints[0].Port++
			case "public":
				proof.Transport.Endpoints[0].Address = "8.8.8.8"
			case "loopback":
				proof.Transport.Endpoints[0].Address = "127.0.0.1"
			case "signature":
				proof.Signature = strings.Repeat("A", 86)
			case "ca":
				proof.Transport.CACertificatePEM = "prefix" + proof.Transport.CACertificatePEM
			case "host":
				proof.Transport.Host.NodeID = "node_untrusted001"
			case "origin":
				proof.Transport.HostOrigin = "https://other.invalid"
			case "expiry":
				proof.Transport.ExpiresAt = now.Add(-time.Second).Format(peerTimeFormat)
			}
			if _, err := lanRoots(proof, f.Origin, f.Host, true, now); err == nil {
				t.Fatal("untrusted transport accepted")
			}
		})
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": outcome.Membership.MembershipID})
	if err := connection.Heartbeat(context.Background()); err == nil {
		t.Fatal("revoked membership retained LAN Runtime")
	}
	if err := os.Remove(trustPath); err != nil {
		t.Fatal(err)
	}
	if _, err := NewNativeClient(root, f.Origin, f.Host, owner.signer, func() error { return nil }); !errors.Is(err, ErrTLSConfiguration) {
		t.Fatal("missing confirmed trust fell back", err)
	}
}
