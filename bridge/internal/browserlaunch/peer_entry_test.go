package browserlaunch

import (
	"errors"
	"strings"
	"testing"
)

func TestPeerEntryOpensExactHTTPSOriginWithFragmentProof(t *testing.T) {
	id, token := "peerhuman_browser001", strings.Repeat("A", 43)
	for _, platform := range []string{"darwin", "windows", "linux"} {
		called := false
		err := openPeerEntry(platform, "https://host.example:4433", id, token, func(name string, args ...string) error {
			called = true
			if strings.Contains(name, "sh") || args[len(args)-1] != "https://host.example:4433/#peerEntry="+id+"."+token {
				t.Fatal("unexpected browser command")
			}
			return nil
		})
		if err != nil || !called {
			t.Fatal("entry did not open", err)
		}
	}
	for _, origin := range []string{"http://127.0.0.1", "https://user@host.test", "https://host.test/", "https://host.test/path", "https://host.test?redirect=other", "https://host.test?", "https://host.test#redirect", "file:///private/secret", "javascript:alert(1)"} {
		if err := openPeerEntry("darwin", origin, id, token, func(string, ...string) error { t.Fatal("invalid target opened"); return nil }); err == nil {
			t.Fatal("accepted invalid origin")
		}
	}
	for _, values := range [][2]string{{"credential_other001", token}, {id, "bad"}, {id + "&x=1", token}, {id, token + "\n"}} {
		if err := openPeerEntry("darwin", "https://host.test", values[0], values[1], func(string, ...string) error { t.Fatal("invalid proof opened"); return nil }); err == nil {
			t.Fatal("accepted invalid proof")
		}
	}
	err := openPeerEntry("darwin", "https://host.test", id, token, func(string, ...string) error { return errors.New(token) })
	if err == nil || strings.Contains(err.Error(), token) {
		t.Fatal("browser error disclosed proof")
	}
}
