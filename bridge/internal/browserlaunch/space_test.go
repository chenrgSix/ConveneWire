package browserlaunch

import "testing"

func TestSpaceOpenerConstructsOnlyOriginAndTeamWithoutCredentials(t *testing.T) {
	for _, goos := range []string{"darwin", "windows", "linux"} {
		if err := openSpace(goos, "https://remote.example", "team_fixture001", func(_ string, args ...string) error {
			if args[len(args)-1] != "https://remote.example/?team=team_fixture001" {
				t.Fatal(args)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	for _, origin := range []string{"javascript:alert(1)", "file:///private/data", "http://remote.example", "https://user:secret@remote.example", "https://remote.example?token=secret", "https://remote.example/path", "https://remote.example#secret"} {
		if openSpace("darwin", origin, "team_fixture001", func(string, ...string) error { t.Fatal("opened invalid reference"); return nil }) == nil {
			t.Fatal(origin)
		}
	}
}
