//go:build desktop

package main

import (
	"bytes"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPackagedEntryPreservesRemoteProfileWithoutSelectingIt(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(root, "bin", "desktop")
	hub := filepath.Join(filepath.Dir(executable), "hub")
	if runtime.GOOS == "darwin" {
		hub = filepath.Join(filepath.Dir(executable), "../Resources/hub")
	}
	if err := os.MkdirAll(hub, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(hub, "hub-manifest.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	profile := filepath.Join(root, "bridge.json")
	original := []byte(`{"serverUrl":"https://retained.example","dataDir":"retained-private-data"}`)
	for _, retained := range []bool{false, true} {
		if retained {
			if err := os.WriteFile(profile, original, 0600); err != nil {
				t.Fatal(err)
			}
		}
		if got := desktopHubBundle(executable, "", false, ""); got != hub {
			t.Fatalf("retained=%v selected %q", retained, got)
		}
	}
	saved, err := os.ReadFile(profile)
	if err != nil || !bytes.Equal(saved, original) {
		t.Fatal("startup modified retained remote profile", err)
	}
	for _, pairing := range []string{"", "convenewire://pair-device"} {
		if got := desktopHubBundle(executable, "", true, pairing); got != "" {
			t.Fatal("explicit Bridge launch selected local Hub")
		}
	}
	if got := desktopHubBundle(executable, "", false, "convenewire://pair-device"); got != "" {
		t.Fatal("Device pairing selected local Hub")
	}
	if got := desktopHubBundle(executable, "/explicit/hub", false, ""); got != "/explicit/hub" {
		t.Fatal("lost explicit fixture bundle")
	}
	if err := os.Remove(filepath.Join(hub, "hub-manifest.json")); err != nil {
		t.Fatal(err)
	}
	if got := desktopHubBundle(executable, "", false, ""); got != "" {
		t.Fatal("unbundled Bridge selected a missing Hub")
	}
}

func TestNativeSettingsStayOnNativeAssetsWithoutHubOrReturnCredentials(t *testing.T) {
	for _, theme := range []string{"light", "dark", "https://foreign.example?secret=oops"} {
		parsed, err := url.Parse(nativeSettingsURL("owner token & value", theme))
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Host != "" || parsed.Path != "/" || parsed.Fragment != "" {
			t.Fatal("settings escaped native assets")
		}
		query := parsed.Query()
		if len(query) != 3 || query.Get("token") != "owner token & value" || query.Get("workspace") != "1" {
			t.Fatal("unexpected native settings query")
		}
		expected := "dark"
		if theme == "light" {
			expected = "light"
		}
		if query.Get("theme") != expected {
			t.Fatal("unvalidated appearance")
		}
	}
	if !strings.Contains(strings.Join(loginArguments("/legacy/config", "", ""), " "), "--bridge-only") {
		t.Fatal("explicit legacy login startup lost its mode")
	}
}
