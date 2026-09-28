//go:build desktop

package main

import (
	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/console"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
	"path/filepath"
)

// Only bare, configured reference names cross the native event bridge. No URL,
// credential, command or arbitrary payload is accepted from page JavaScript.
var localSpaceNavigationScript = console.NativeSpaceNavigationScript

func remoteDesktopSpaces(root, localID, localOrigin string) ([]wire.Space, error) {
	raw, err := privatefs.ReadFile(filepath.Join(root, "bridge", "authority-spaces.json"), 16384)
	if err != nil {
		return nil, err
	}
	var directory wire.AuthoritySpaceDirectory
	if err := wire.Decode("AuthoritySpaceDirectory", raw, &directory); err != nil {
		return nil, err
	}
	var result []wire.Space
	seen := map[string]bool{}
	for _, s := range directory.Spaces {
		if seen[s.AuthorityNodeID] || authority.ValidateOrigin(s.BrowserOrigin) != nil {
			return nil, authority.ErrIdentity
		}
		seen[s.AuthorityNodeID] = true
		if s.Kind == "remote" {
			if s.AuthorityNodeID == localID || s.BrowserOrigin == localOrigin {
				return nil, authority.ErrIdentity
			}
			result = append(result, s)
		}
	}
	return result, nil
}
func spaceNavigationEvent(s wire.Space) string {
	return "convenewire.space.open." + s.AuthorityNodeID + "." + s.TeamID
}
