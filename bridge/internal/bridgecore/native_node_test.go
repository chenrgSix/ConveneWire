package bridgecore

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/ownership"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/peer"
	"convenewire.dev/bridge/internal/privatefs"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

func nativeCoreFixture(t *testing.T) (context.Context, *NativeNode, config.Config, pairing.Credential, map[string]string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := privatefs.EnsureDirectory(root); err != nil {
		t.Fatal(err)
	}
	identity := localwire.LocalNodeIdentity{SchemaVersion: 1, NodeID: "node_nativecore001", OwnerUserID: "user_nativecore001", Secret: strings.Repeat("A", 43), Port: 48291}
	raw, _ := json.Marshal(identity)
	if err := privatefs.WriteFile(filepath.Join(root, "identity.json"), raw); err != nil {
		t.Fatal(err)
	}
	owner, err := ownership.Acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = owner.Release() })
	node, err := NewNativeNode(root, identity)
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{SchemaVersion: config.CurrentSchemaVersion, LocalNodeID: identity.NodeID, ServerURL: "http://127.0.0.1:48291",
		DataDir: filepath.Join(root, "bridge"), Agents: []config.AgentConfig{{Name: "Local Agent", Workspace: t.TempDir()}}}
	credential := pairing.Credential{ServerURL: cfg.ServerURL, TeamID: "team_nativecore001", DeviceID: "device_nativecore001", OwnerMemberID: "member_nativecore001", Token: "local-device-secret"}
	if err := pairing.Save(cfg.DataDir, credential); err != nil {
		t.Fatal(err)
	}
	bridgeOwner, err := ownership.Acquire(cfg.DataDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = bridgeOwner.Release() })
	return WithNativeNode(ownership.WithOwner(context.Background(), bridgeOwner), node), node, cfg, credential, map[string]string{"Local Agent": "agent_nativecore001"}
}

func TestNativeCoreRecoversLegacyAndNodeProcessesUnderTheExistingShellLease(t *testing.T) {
	ctx, node, cfg, credential, ids := nativeCoreFixture(t)
	owner := admission.Owner{ServerURL: credential.ServerURL, TeamID: credential.TeamID, DeviceID: credential.DeviceID, OwnerMemberID: credential.OwnerMemberID}
	processIdentity := func(suffix string) bridgeruntime.GovernedProcessIdentity {
		return bridgeruntime.GovernedProcessIdentity{RunID: "run_" + suffix, AdmissionDigest: strings.Repeat("a", 64), StartDigest: strings.Repeat("b", 64)}
	}
	for index, root := range []string{cfg.DataDir, filepath.Join(cfg.DataDir, "core-runtime-processes")} {
		if err := privatefs.EnsureDirectory(root); err != nil {
			t.Fatal(err)
		}
		old, err := admission.OpenGovernedProcessStore(ctx, root, owner)
		if err != nil {
			t.Fatal(err)
		}
		id := processIdentity([]string{"primarylegacy001", "sharedlegacy001"}[index])
		if _, err := old.PrepareProcess(id); err != nil {
			t.Fatal(err)
		}
		if err := old.Close(); err != nil {
			t.Fatal(err)
		}
	}
	resources, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = resources.processes.Close() })
	var abandoned int
	if err := filepath.WalkDir(cfg.DataDir, func(path string, entry os.DirEntry, err error) error {
		if err == nil && strings.HasSuffix(entry.Name(), ".abandoned.json") {
			abandoned++
		}
		return err
	}); err != nil || abandoned != 2 {
		t.Fatal("legacy possible starts were not fenced before the new owner opened", abandoned, err)
	}
	id := processIdentity("newnative001")
	if _, err := resources.processes.PrepareProcess(id); err != nil {
		t.Fatal(err)
	}
	if err := resources.processes.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.processes.Close()
	if _, err := reopened.processes.PrepareProcess(id); !errors.Is(err, admission.ErrAdmissionConflict) {
		t.Fatal("Node restart forgot an existing execution", err)
	}
	if second, err := ownership.Acquire(cfg.DataDir); err == nil {
		_ = second.Release()
		t.Fatal("resource recovery released the Console owner")
	}
	if resources.primary.Resources[ids["Local Agent"]].AgentID != ids["Local Agent"] || resources.primary.Shared != resources.shared {
		t.Fatal("native composition replaced the stable local Agent or scheduler")
	}
}

func TestNativeSingleConnectorSharesPhysicalWorkspaceWithOtherConnectors(t *testing.T) {
	ctx, node, cfg, credential, ids := nativeCoreFixture(t)
	resources, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal(err)
	}
	defer resources.processes.Close()
	release, err := resources.primary.Acquire(ctx, ids["Local Agent"])
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	canonical := resources.primary.Resources[ids["Local Agent"]].Workspace
	blocked, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	if unlock, err := resources.shared.Acquire(blocked, delivery.LocalResource{AgentID: "agent_peer_projection001", Workspace: canonical}); !errors.Is(err, context.DeadlineExceeded) {
		if unlock != nil {
			unlock()
		}
		t.Fatal("Peer projection could overlap the primary physical workspace", err)
	}
	release()
	unlock, err := resources.shared.Acquire(ctx, delivery.LocalResource{AgentID: "agent_peer_projection001", Workspace: canonical})
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}

func TestNativeCoreRejectsProfileIdentityChangesAndUnreadableRetainedAuthority(t *testing.T) {
	for _, mutation := range []string{"node", "root", "origin", "credential", "identity file", "authority receipt", "agent alias"} {
		t.Run(mutation, func(t *testing.T) {
			ctx, node, cfg, credential, ids := nativeCoreFixture(t)
			switch mutation {
			case "node":
				cfg.LocalNodeID = "node_othercore001"
			case "root":
				cfg.DataDir = t.TempDir()
			case "origin":
				cfg.ServerURL = "http://127.0.0.1:48292"
			case "credential":
				credential.ServerURL = "http://127.0.0.1:48292"
			case "identity file":
				if err := os.Remove(filepath.Join(node.root, "identity.json")); err != nil {
					t.Fatal(err)
				}
			case "authority receipt":
				if err := privatefs.CreateDirectory(filepath.Join(cfg.DataDir, "authorities")); err != nil {
					t.Fatal(err)
				}
			case "agent alias":
				ids = map[string]string{}
			}
			if resources, err := openNativeResources(ctx, node, cfg, credential, ids); err == nil {
				_ = resources.processes.Close()
				t.Fatal("native authority change accepted")
			}
			if _, err := os.Stat(filepath.Join(node.root, "bridge", "core-node-processes")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("invalid native composition selected a new process namespace", err)
			}
		})
	}
}

func TestNativeCoreDoesNotInitializeMissingIdentityOrExposeItsSecret(t *testing.T) {
	_, node, _, _, _ := nativeCoreFixture(t)
	encoded, err := json.Marshal(node)
	if err != nil || string(encoded) != "{}" {
		t.Fatal("native identity escaped into JSON", err)
	}
	changed := node.identity
	changed.Secret = strings.Repeat("B", 42) + "A"
	if _, err := NewNativeNode(node.root, changed); err == nil {
		t.Fatal("caller supplied a replacement signing identity")
	}
	if err := os.Remove(filepath.Join(node.root, "identity.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := NewNativeNode(node.root, node.identity); err == nil {
		t.Fatal("missing native identity was recreated")
	}
	if err := node.check(); err == nil {
		t.Fatal("running core ignored a missing native identity")
	}
}

func TestNativePeerStorageFailureDoesNotBlockDeviceResources(t *testing.T) {
	ctx, node, cfg, credential, ids := nativeCoreFixture(t)
	peerRoot := filepath.Join(node.root, "peer-state")
	if err := privatefs.CreateDirectory(peerRoot); err != nil {
		t.Fatal(err)
	}
	if err := privatefs.WriteFile(filepath.Join(peerRoot, "state.json"), []byte("corrupt")); err != nil {
		t.Fatal(err)
	}
	if _, err := node.peerStore(); !errors.Is(err, peer.ErrStore) {
		t.Fatal("corrupt Peer history accepted", err)
	}
	resources, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal("Peer storage failure blocked Device core", err)
	}
	if err := resources.processes.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(peerRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := node.peerStore(); !errors.Is(err, peer.ErrStore) {
		t.Fatal("failed Peer store reopened as a fresh identity", err)
	}
	if err := node.check(); err != nil {
		t.Fatal("Peer failure contaminated native identity", err)
	}
}

func TestNativePeerStoreRetainsOneHistoryObserverAcrossCoreEpochs(t *testing.T) {
	_, node, _, _, _ := nativeCoreFixture(t)
	first, err := node.peerStore()
	if err != nil {
		t.Fatal(err)
	}
	second, err := node.peerStore()
	if err != nil || first != second {
		t.Fatal("core restart discarded Peer history observer", err)
	}
	if err := os.Remove(filepath.Join(node.root, "identity.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := node.peerStore(); err == nil {
		t.Fatal("Peer operation ignored changed native identity")
	}
}
