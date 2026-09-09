//go:build desktop

package main

import (
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopOpenRequiresCurrentPrivateRemoteReference(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "bridge")
	if err := privatefs.EnsureDirectory(dir); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "authority-spaces.json")
	space := wire.Space{AuthorityNodeID: "node_remote001", TeamID: "team_remote001", BrowserOrigin: "https://remote.example", Kind: "remote", Label: "Remote"}
	save := func(s wire.Space) {
		t.Helper()
		_ = os.Remove(file)
		raw, _ := json.Marshal(wire.AuthoritySpaceDirectory{SchemaVersion: 1, Spaces: []wire.Space{s}})
		if err := privatefs.WriteFile(file, raw); err != nil {
			t.Fatal(err)
		}
	}
	save(space)
	got, err := remoteDesktopSpaces(root, "node_local001", "http://127.0.0.1:48123")
	if err != nil || len(got) != 1 {
		t.Fatal(err)
	}
	if spaceNavigationEvent(got[0]) != "convenewire.space.open.node_remote001.team_remote001" {
		t.Fatal("event exposes URL or private state")
	}
	for _, origin := range []string{"http://127.0.0.1:48123", "http://remote.example", "https://remote.example?token=secret"} {
		space.BrowserOrigin = origin
		save(space)
		if _, err := remoteDesktopSpaces(root, "node_local001", "http://127.0.0.1:48123"); err == nil {
			t.Fatal("accepted unsafe reference")
		}
	}
	_ = os.Remove(file)
	if _, err := remoteDesktopSpaces(root, "node_local001", "http://127.0.0.1:48123"); err == nil {
		t.Fatal("opened removed reference")
	}
}
