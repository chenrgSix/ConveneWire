package browserlaunch

import (
	"fmt"
	"net"
	"net/url"
	"regexp"
	"runtime"
)

// OpenSpace receives a locally verified directory reference, never a URL from
// Web input. Recheck scheme and construct the sole permitted Team parameter.
func OpenSpace(origin, teamID string) error {
	return openSpace(runtime.GOOS, origin, teamID, startCommand)
}
func openSpace(goos, origin, teamID string, start commandStarter) error {
	u, err := url.Parse(origin)
	if err != nil || u.User != nil || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || !regexp.MustCompile(`^team_[A-Za-z0-9_-]{8,128}$`).MatchString(teamID) {
		return fmt.Errorf("invalid Space reference")
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback()))) {
		return fmt.Errorf("invalid Space origin")
	}
	u.Path = "/"
	u.RawQuery = url.Values{"team": {teamID}}.Encode()
	command, args, err := browserCommand(goos, u.String())
	if err != nil {
		return err
	}
	return start(command, args...)
}
