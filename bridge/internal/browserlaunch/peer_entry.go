package browserlaunch

import (
	"fmt"
	"regexp"
	"runtime"
)

// OpenPeerEntry receives the origin already verified by the native Peer owner.
// Browser proof is short-lived, fragment-only and never a Device credential.
func OpenPeerEntry(origin, credentialID, token string) error {
	return openPeerEntry(runtime.GOOS, origin, credentialID, token, startCommand)
}

func openPeerEntry(goos, origin, credentialID, token string, start commandStarter) error {
	parsed, err := exactOrigin(origin)
	if err != nil || parsed.Scheme != "https" || parsed.String() != origin || parsed.Path != "" || parsed.ForceQuery ||
		!regexp.MustCompile(`^peerhuman_[A-Za-z0-9_-]{8,128}$`).MatchString(credentialID) ||
		!regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(token) {
		return fmt.Errorf("Peer browser entry is invalid")
	}
	parsed.Path = "/"
	parsed.Fragment = "peerEntry=" + credentialID + "." + token
	name, args, err := browserCommand(goos, parsed.String())
	if err != nil {
		return err
	}
	if err := start(name, args...); err != nil {
		return fmt.Errorf("could not open the Peer browser entry")
	}
	return nil
}
