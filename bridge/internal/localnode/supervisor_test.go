package localnode

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	contracts "convenewire.dev/contracts/generated/go/localnode"
)

func TestMain(m *testing.M) {
	if len(os.Args) == 3 && strings.HasSuffix(os.Args[1], "local-node.js") {
		var launch contracts.LocalNodeLaunch
		if json.NewDecoder(os.Stdin).Decode(&launch) != nil {
			os.Exit(2)
		}
		mode, _ := os.ReadFile(filepath.Join(os.Args[2], "fixture-mode"))
		if string(mode) == "exit" {
			os.Exit(3)
		}
		if string(mode) != "wait" {
			if os.WriteFile(filepath.Join(os.Args[2], "hub", "hub.sqlite"), []byte("test child fixture"), 0600) != nil {
				os.Exit(4)
			}
			proof := launch.ControlToken
			if string(mode) == "wrong-proof" {
				proof = strings.Repeat("x", 43)
			}
			_ = json.NewEncoder(os.Stdout).Encode(contracts.LocalNodeReady{SchemaVersion: 1, NodeID: launch.Identity.NodeID,
				Origin: (&Data{Identity: contracts.LocalNodeIdentity(launch.Identity)}).Origin(), LaunchProof: proof})
		}
		_, _ = io.Copy(io.Discard, os.Stdin)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func testChildBundle(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "hub")
	required := []string{nodeExecutable(), "apps/server/dist/local-node.js", "apps/server/dist/server.js", "apps/web/dist/index.html",
		"node_modules/better-sqlite3/package.json", "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"}
	platform := runtime.GOOS
	if platform == "windows" {
		platform = "win32"
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	manifest := BundleManifest{SchemaVersion: 1, Platform: platform, Arch: arch, NodeVersion: "v22.23.1", ReleaseVersion: "v0.0.0-test",
		SourceCommit: strings.Repeat("a", 40), SourceState: "modified"}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range required {
		target := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		content := []byte("fixture")
		if name == nodeExecutable() {
			content, err = os.ReadFile(executable)
			if err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(target, content, 0700); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(content)
		size := int64(len(content))
		manifest.Files = append(manifest.Files, bundleFile{Path: name, Size: &size, SHA256: hex.EncodeToString(sum[:])})
	}
	content, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(root, "hub-manifest.json"), content, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestSupervisorReadinessFailureCancellationAndChildExit(t *testing.T) {
	bundle := testChildBundle(t)
	for _, mode := range []string{"ready", "wrong-proof", "exit", "wait"} {
		t.Run(mode, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "node")
			data, err := OpenData(root)
			if err != nil {
				t.Fatal(err)
			}
			data.Close()
			if err := os.WriteFile(filepath.Join(root, "fixture-mode"), []byte(mode), 0600); err != nil {
				t.Fatal(err)
			}
			timeout := 15 * time.Second
			if mode == "wait" {
				timeout = 100 * time.Millisecond
			}
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			supervisor, err := Start(ctx, bundle, root)
			if mode != "ready" {
				if err == nil {
					supervisor.Close()
					t.Fatal("accepted missing or invalid child readiness")
				}
				data, err := OpenData(root)
				if err != nil {
					t.Fatal("startup failure retained its owner lease", err)
				}
				data.Close()
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := OpenData(root); err == nil {
				t.Fatal("live Supervisor lost its lease")
			}
			if err := supervisor.cmd.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			select {
			case <-supervisor.Done():
			case <-time.After(3 * time.Second):
				t.Fatal("child exit was not observed")
			}
			if _, err := OpenData(root); err == nil {
				t.Fatal("child exit released the root before Runtime shutdown")
			}
			if err := supervisor.Close(); err != nil {
				t.Fatal(err)
			}
			if err := supervisor.Close(); err != nil {
				t.Fatal(err)
			}
			data, err = OpenData(root)
			if err != nil {
				t.Fatal(err)
			}
			data.Close()
		})
	}
}

func TestSupervisorRejectsBundleTamperingBeforeCreatingData(t *testing.T) {
	bundle := testChildBundle(t)
	if err := os.WriteFile(filepath.Join(bundle, "apps/web/dist/index.html"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "uncreated")
	if supervisor, err := Start(context.Background(), bundle, root); err == nil {
		supervisor.Close()
		t.Fatal("ran a modified bundle")
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("modified bundle created private data")
	}
}
