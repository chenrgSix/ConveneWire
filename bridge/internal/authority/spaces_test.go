package authority

import (
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestSpaceDirectoryContainsOnlyVerifiedReferencesAndResetsOldObservations(t *testing.T) {
	root := t.TempDir()
	d, err := NewSpaceDirectory(root)
	if err != nil {
		t.Fatal(err)
	}
	if d.Observe(Verified{}, "Forged", false) == nil {
		t.Fatal("accepted unauthenticated reference")
	}
	a, _, _ := fixture(t, "space_primary001")
	a.payload.BrowserOrigin = "http://127.0.0.1:48123"
	b, _, _ := fixture(t, "space_remote001")
	b.payload.BrowserOrigin = "https://remote.test"
	var workers sync.WaitGroup
	for _, v := range []Verified{a, b} {
		workers.Add(1)
		go func(v Verified) {
			defer workers.Done()
			if err := d.Observe(v, "Host", v.NodeID() == a.NodeID()); err != nil {
				t.Error(err)
			}
		}(v)
	}
	workers.Wait()
	file := filepath.Join(root, "authority-spaces.json")
	raw, err := privatefs.ReadFile(file, 16384)
	if err != nil {
		t.Fatal(err)
	}
	var got wire.AuthoritySpaceDirectory
	if err := wire.Decode("AuthoritySpaceDirectory", raw, &got); err != nil || len(got.Spaces) != 2 {
		t.Fatal(err, string(raw))
	}
	for _, secret := range []string{"credential", "deviceId", "ownerMemberId", "signature", "nonce", "publicKey"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("leaked private binding", secret)
		}
	}
	if _, err := NewSpaceDirectory(root); err != nil {
		t.Fatal(err)
	}
	raw, _ = privatefs.ReadFile(file, 16384)
	if err := json.Unmarshal(raw, &got); err != nil || len(got.Spaces) != 0 {
		t.Fatal("retained previous core observations", err)
	}
}
