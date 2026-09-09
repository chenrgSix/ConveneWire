package authority

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
)

// SpaceDirectory contains navigation references only. Each core startup clears
// old observations; unavailable Hosts reappear after a new authenticated proof.
// It is never read by execution admission or used to issue credentials.
type SpaceDirectory struct {
	mu      sync.Mutex
	root    string
	entries map[string]wire.Space
}

func NewSpaceDirectory(root string) (*SpaceDirectory, error) {
	d := &SpaceDirectory{root: root, entries: map[string]wire.Space{}}
	return d, d.save()
}
func (d *SpaceDirectory) Observe(v Verified, label string, hosted bool) error {
	if v.NodeID() == "" || v.payload.AuthorityNodeID != v.NodeID() {
		return ErrIdentity
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if v.BrowserOrigin() == "" {
		delete(d.entries, v.NodeID())
		return d.save()
	}
	if ValidateOrigin(v.BrowserOrigin()) != nil {
		return ErrIdentity
	}
	kind := wire.Kind("remote")
	if hosted {
		kind = wire.Kind("hosted")
	}
	d.entries[v.NodeID()] = wire.Space{AuthorityNodeID: v.NodeID(), TeamID: v.binding.TeamID, BrowserOrigin: v.BrowserOrigin(), Label: label, Kind: kind}
	return d.save()
}
func (d *SpaceDirectory) save() error {
	directory := wire.AuthoritySpaceDirectory{SchemaVersion: 1, Spaces: []wire.Space{}}
	for _, entry := range d.entries {
		directory.Spaces = append(directory.Spaces, entry)
	}
	sort.Slice(directory.Spaces, func(i, j int) bool { return directory.Spaces[i].AuthorityNodeID < directory.Spaces[j].AuthorityNodeID })
	raw, err := json.Marshal(directory)
	if err != nil {
		return err
	}
	if err := wire.Decode("AuthoritySpaceDirectory", raw, &directory); err != nil {
		return err
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	temporary := filepath.Join(d.root, ".authority-spaces-"+hex.EncodeToString(nonce))
	if err := privatefs.WriteFile(temporary, raw); err != nil {
		return err
	}
	defer os.Remove(temporary)
	target := filepath.Join(d.root, "authority-spaces.json")
	if err := os.Rename(temporary, target); err != nil {
		return err
	}
	return durablefs.SyncParent(target)
}
