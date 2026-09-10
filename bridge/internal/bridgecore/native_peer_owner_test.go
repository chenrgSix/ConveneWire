package bridgecore

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"convenewire.dev/bridge/internal/peer"
)

func TestNativeOwnerAccessRetainsOneObserverAndEndsWithInstallation(t *testing.T) {
	_, node, _, _, _ := nativeCoreFixture(t)
	owner, err := node.PeerOwnerAccess()
	if err != nil {
		t.Fatal(err)
	}
	again, err := node.PeerOwnerAccess()
	if err != nil || again != owner {
		t.Fatal("native owner changed across accesses", err)
	}
	if pending, err := owner.Pending(); err != nil || len(pending) != 0 {
		t.Fatal("empty native journal", err)
	}
	node.Close()
	if _, err := node.PeerOwnerAccess(); err == nil {
		t.Fatal("closed installation created owner capability")
	}
	if _, err := owner.Preview(context.Background(), peer.InvitationInput{}); err == nil {
		t.Fatal("retained owner survived installation close")
	}
}

func TestNativeHumanVaultFailureDoesNotBlockRuntimeResources(t *testing.T) {
	ctx, node, cfg, credential, ids := nativeCoreFixture(t)
	path := filepath.Join(node.root, "peer-human")
	if err := os.WriteFile(path, []byte("broken human vault"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := node.PeerOwnerAccess(); err == nil {
		t.Fatal("corrupt human state accepted")
	}
	resources, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal("human state blocked Device work", err)
	}
	defer resources.processes.Close()
	if _, err := node.peerStore(); err != nil {
		t.Fatal("human state blocked Peer machine authority", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := node.PeerOwnerAccess(); err == nil {
		t.Fatal("failed human observer reopened as fresh identity")
	}
}
