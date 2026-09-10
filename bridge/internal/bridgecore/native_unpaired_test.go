package bridgecore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/pairing"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
)

func TestUnpairedNativeCoreRetainsNodeProcessesAcrossExplicitDeviceAttachment(t *testing.T) {
	ctx, node, cfg, credential, _ := nativeCoreFixture(t)
	if err := os.Remove(filepath.Join(cfg.DataDir, "device-credential.json")); err != nil {
		t.Fatal(err)
	}
	ids, err := identity.LoadOrCreate(cfg.DataDir, cfg.Agents)
	if err != nil {
		t.Fatal(err)
	}
	resources, err := openNodeExecutionResources(ctx, node, cfg, ids)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resources.processes.PrepareProcess(bridgeruntime.GovernedProcessIdentity{
		RunID: "run_unpairedorphan001", AdmissionDigest: strings.Repeat("a", 64), StartDigest: strings.Repeat("b", 64),
	}); err != nil {
		t.Fatal(err)
	}
	if err := resources.processes.Close(); err != nil {
		t.Fatal(err)
	}
	processOwnerPath := filepath.Join(cfg.DataDir, "core-node-processes", "node-process-owner.json")
	ownerBefore, err := os.ReadFile(processOwnerPath)
	if err != nil {
		t.Fatal(err)
	}
	running, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { done <- node.RunUnpaired(running, cfg) }()
	t.Cleanup(cancel)
	waitNativePeerState(t, node, "running")
	if _, err := pairing.Load(cfg.DataDir); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("Peer-only epoch created Device credentials", err)
	}
	abandoned := 0
	if err := filepath.WalkDir(filepath.Join(cfg.DataDir, "core-node-processes"), func(_ string, entry os.DirEntry, err error) error {
		if err == nil && strings.HasSuffix(entry.Name(), ".abandoned.json") {
			abandoned++
		}
		return err
	}); err != nil || abandoned != 1 {
		t.Fatal("unpaired startup forgot possible processes", abandoned, err)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("unpaired epoch did not drain")
	}
	if node.PeerStatus().State != "stopped" {
		t.Fatal("unpaired Peer connectors retained after core stopped")
	}
	if err := pairing.Save(cfg.DataDir, credential); err != nil {
		t.Fatal(err)
	}
	paired, err := openNativeResources(ctx, node, cfg, credential, ids)
	if err != nil {
		t.Fatal("Device attachment could not reuse Node process ownership", err)
	}
	defer paired.processes.Close()
	ownerAfter, err := os.ReadFile(processOwnerPath)
	if err != nil || string(ownerBefore) != string(ownerAfter) {
		t.Fatal("Device attachment changed the Node process owner", err)
	}
	if err := node.RunUnpaired(ctx, cfg); err == nil {
		t.Fatal("paired Node reopened through the unpaired path")
	}
}

func TestUnpairedNativeCoreRejectsForeignAndRetainedDeviceStateBeforeCreatingResources(t *testing.T) {
	for _, scenario := range []string{"credential", "malformed credential", "dangling credential", authority.ConfigurationFilename, "authorities", "governed-runtime-processes", "core-runtime-processes", "foreign Node", "foreign origin", "foreign directory", "identity changed"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, node, cfg, _, _ := nativeCoreFixture(t)
			credentialPath := filepath.Join(cfg.DataDir, "device-credential.json")
			if scenario != "credential" {
				if err := os.Remove(credentialPath); err != nil {
					t.Fatal(err)
				}
			}
			switch scenario {
			case "malformed credential":
				if err := os.WriteFile(credentialPath, []byte("malformed"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "dangling credential":
				if err := os.Symlink(filepath.Join(cfg.DataDir, "absent"), credentialPath); err != nil {
					t.Fatal(err)
				}
			case authority.ConfigurationFilename, "authorities", "governed-runtime-processes", "core-runtime-processes":
				if err := os.Mkdir(filepath.Join(cfg.DataDir, scenario), 0o700); err != nil {
					t.Fatal(err)
				}
			case "foreign Node":
				cfg.LocalNodeID = "node_anotherlocal001"
			case "foreign origin":
				cfg.ServerURL = "http://127.0.0.1:48292"
			case "foreign directory":
				cfg.DataDir = t.TempDir()
			case "identity changed":
				if err := os.Remove(filepath.Join(node.root, "identity.json")); err != nil {
					t.Fatal(err)
				}
			}
			if err := node.RunUnpaired(ctx, cfg); err == nil {
				t.Fatal("unpaired execution accepted foreign or ambiguous ownership")
			}
			if _, err := os.Lstat(filepath.Join(cfg.DataDir, "core-node-processes")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("rejected unpaired owner created process state", err)
			}
		})
	}
}
