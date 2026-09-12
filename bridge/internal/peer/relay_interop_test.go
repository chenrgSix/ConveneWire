package peer

import "testing"

// The fixture swaps only public DNS and its CA. All requests traverse the Go
// Relay daemon, the outbound Node WSS connector and native PeerIngress. These
// reuse the existing authority, durable result and restricted-process checks.
func TestGoRelayRunUsesActualHostAndRestrictedNativeChild(t *testing.T) {
	t.Setenv("CONVENE_WIRE_PEER_RELAY_FIXTURE", "1")
	assertPeerRunUsesActualHostAndRestrictedNativeChild(t)
}

func TestGoRelayDiscussionRetainsNativeSessionsAndFrozenFinalization(t *testing.T) {
	t.Setenv("CONVENE_WIRE_PEER_RELAY_FIXTURE", "1")
	assertPeerDiscussionUsesNativeSessionsAndFrozenFinalization(t)
}

func TestGoRelayRunRetriesAndRevokedSettlementRetainAuthority(t *testing.T) {
	t.Setenv("CONVENE_WIRE_PEER_RELAY_FIXTURE", "1")
	assertPeerRunDeliveryEventsAndRevokedSettlementUseActualHost(t)
}
