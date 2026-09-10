package console

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestPeerSpacesInventorySurvivesRuntimeConfigurationLossWithoutSecrets(t *testing.T) {
	service, _, server, state := peerExportConsoleFixture(t)
	service.mu.Lock()
	service.configuration = nil
	service.bridgeRestartPending = true
	service.mu.Unlock()
	for _, scenario := range []string{"owner", "machine", "foreign-origin", "query"} {
		path := server.URL + "/api/peers/spaces"
		if scenario == "query" {
			path += "?token=forbidden"
		}
		request, _ := http.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("authorization", "Bearer "+service.Token())
		want := http.StatusOK
		if scenario == "machine" {
			request.Header.Set("authorization", "Bearer machine-credential")
			want = http.StatusUnauthorized
		}
		if scenario == "foreign-origin" {
			request.Header.Set("origin", "https://foreign.example")
			want = http.StatusForbidden
		}
		if scenario == "query" {
			want = http.StatusForbidden
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != want {
			t.Fatal(scenario, response.StatusCode, err)
		}
		if scenario != "owner" {
			continue
		}
		var view struct {
			Connections []map[string]json.RawMessage `json:"connections"`
		}
		if json.Unmarshal(raw, &view) != nil || len(view.Connections) != 1 || len(view.Connections[0]) != 3 {
			t.Fatal("Space inventory did not retain only membership metadata", string(raw))
		}
		if !strings.Contains(string(raw), state.Connections[0].Receipt.Membership.MembershipID) ||
			strings.Contains(string(raw), state.Connections[0].Receipt.MachineCredential.Token) ||
			strings.Contains(string(raw), "proof") || strings.Contains(string(raw), "exports") || response.Header.Get("cache-control") != "no-store" {
			t.Fatal("Space inventory leaked credentials or confused membership with Runtime availability")
		}
	}
}
