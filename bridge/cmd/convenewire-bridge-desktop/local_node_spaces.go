//go:build desktop

package main

import (
	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/authority"
	"path/filepath"
)

// Only bare, configured reference names cross the native event bridge. No URL,
// credential, command or arbitrary payload is accepted from page JavaScript.
const localSpaceNavigationScript = `document.addEventListener('click',function(event){
 const link=event.target.closest&&event.target.closest('a[data-authority-node][data-authority-team]');
 if(!link||!window._wails||typeof window._wails.invoke!=='function')return;
 const node=link.dataset.authorityNode,team=link.dataset.authorityTeam;
 if(!/^node_[A-Za-z0-9_-]{8,128}$/.test(node)||!/^team_[A-Za-z0-9_-]{8,128}$/.test(team))return;
 event.preventDefault();window._wails.invoke('wails:event:emit:convenewire.space.open.'+node+'.'+team);
});`

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
