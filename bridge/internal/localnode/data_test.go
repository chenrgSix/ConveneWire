package localnode

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"

	"convenewire.dev/bridge/internal/privatefs"
)

func TestIdentityLeaseReopenAndSnapshot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "node")
	data, err := OpenData(root)
	if err != nil {
		t.Fatal(err)
	}
	identity := data.Identity
	if _, err := OpenData(root); err == nil {
		t.Fatal("two owners acquired the same Node root")
	}
	if err := Backup(root, filepath.Join(parent, "live")); err == nil {
		t.Fatal("backed up a live Node")
	}
	if err := privatefs.WriteFile(filepath.Join(root, "hub", "hub.sqlite"), []byte("offline database fixture")); err != nil {
		t.Fatal(err)
	}
	if err := privatefs.WriteFile(filepath.Join(root, "bridge", "receipt.json"), []byte(`{"completed":true}`)); err != nil {
		t.Fatal(err)
	}
	if err := data.MarkInitialized(); err != nil {
		t.Fatal(err)
	}
	data.Close()
	reopened, err := OpenData(root)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(identity, reopened.Identity) {
		t.Fatal("identity changed on reopen")
	}
	reopened.Close()
	snapshot := filepath.Join(parent, "snapshot")
	if err := Backup(root, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := Restore(snapshot, root); err == nil {
		t.Fatal("overwrote an existing Node")
	}
	if err := Restore(snapshot, filepath.Join(parent, "clone")); err == nil {
		t.Fatal("cloned identity to another location")
	}
	parked := filepath.Join(parent, "parked")
	if err := os.Rename(root, parked); err != nil {
		t.Fatal(err)
	}
	if err := Restore(snapshot, root); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenData(root)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(identity, restored.Identity) {
		t.Fatal("restore changed identity")
	}
	restored.Close()
	receipt, err := os.ReadFile(filepath.Join(root, "bridge", "receipt.json"))
	if err != nil || string(receipt) != `{"completed":true}` {
		t.Fatal("lost execution receipt")
	}
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapshot, "bridge", "receipt.json"), []byte("tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Restore(snapshot, root); err == nil {
		t.Fatal("restored tampered snapshot")
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatal("failed restore left partial data")
	}
}

func TestMissingCorruptOrUnknownIdentityNeverReinitializes(t *testing.T) {
	for _, kind := range []string{"missing", "corrupt", "newer", "missing-database"} {
		t.Run(kind, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "node")
			data, err := OpenData(root)
			if err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(root, identityFile)
			if kind == "missing-database" {
				if err := data.MarkInitialized(); err != nil {
					t.Fatal(err)
				}
			}
			data.Close()
			switch kind {
			case "missing":
				err = os.Remove(target)
			case "corrupt":
				err = os.WriteFile(target, []byte("{"), 0600)
			case "newer":
				identity := data.Identity
				identity.SchemaVersion = 2
				encoded, _ := json.Marshal(identity)
				err = os.WriteFile(target, encoded, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if reopened, err := OpenData(root); err == nil {
				reopened.Close()
				t.Fatal("silently reinitialized incomplete identity/data")
			}
		})
	}
}

func TestPrivateRootAndSnapshotLinksFailClosed(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permissions and unprivileged symbolic link fixture")
	}
	parent := t.TempDir()
	root := filepath.Join(parent, "node")
	if err := os.Mkdir(root, 0755); err != nil {
		t.Fatal(err)
	}
	if data, err := OpenData(root); err == nil {
		data.Close()
		t.Fatal("accepted public Node root")
	}
	if err := os.Chmod(root, 0700); err != nil {
		t.Fatal(err)
	}
	data, err := OpenData(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := privatefs.WriteFile(filepath.Join(root, "hub", "hub.sqlite"), []byte("fixture")); err != nil {
		t.Fatal(err)
	}
	data.Close()
	if err := os.Symlink(filepath.Join(root, identityFile), filepath.Join(root, "bridge", "link")); err != nil {
		t.Fatal(err)
	}
	if err := Backup(root, filepath.Join(parent, "snapshot")); err == nil {
		t.Fatal("copied a symbolic link")
	}
}
