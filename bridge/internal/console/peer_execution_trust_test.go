package console

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestPeerConsoleExecutionTrustIsLocalDurableAndAvailableWithoutRuntime(t *testing.T) {
	s, owner, server, state := peerExportConsoleFixture(t)
	response := consoleRequest(t, server.URL, s.Token(), http.MethodGet, "/api/peers/spaces", nil)
	var spaces struct {
		Connections []struct{ ExecutionTrust wire.PeerExecutionTrust }
	}
	err := json.NewDecoder(response.Body).Decode(&spaces)
	response.Body.Close()
	if err != nil || len(spaces.Connections) != 1 || !spaces.Connections[0].ExecutionTrust.Enabled || spaces.Connections[0].ExecutionTrust.Revision != 0 {
		t.Fatal("implicit default not visible", spaces, err)
	}
	membership := state.Connections[0].Receipt.Membership.MembershipID
	payload := map[string]any{"membershipId": membership, "expectedRevision": 0, "enabled": false}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/peers/execution-trust", strings.NewReader(`{}`))
	request.Header.Set("authorization", "Bearer "+s.Token())
	request.Header.Set("origin", "https://remote-host.example")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatal("foreign Origin reached Owner preference")
	}
	for _, invalid := range []map[string]any{
		{"membershipId": membership, "expectedRevision": 0},
		{"membershipId": membership, "enabled": false},
		{"membershipId": membership, "expectedRevision": 0, "enabled": false, "deviceId": "foreign"},
	} {
		response = consoleRequest(t, server.URL, s.Token(), http.MethodPost, "/api/peers/execution-trust", invalid)
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatal("invalid preference accepted", invalid, response.StatusCode)
		}
	}
	// Local revocation must work even while Runtime configuration is absent.
	s.mu.Lock()
	s.configuration = nil
	s.bridgeRestartPending = true
	s.mu.Unlock()
	response = consoleRequest(t, server.URL, s.Token(), http.MethodPost, "/api/peers/execution-trust", payload)
	var trust wire.PeerExecutionTrust
	err = json.NewDecoder(response.Body).Decode(&trust)
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || trust.Enabled || trust.Revision != 1 || owner.changes.Load() != 1 {
		t.Fatal("disable", trust, err, response.StatusCode)
	}
	stored, err := owner.store.Read()
	if err != nil || stored.Connections[0].ExecutionTrust == nil || *stored.Connections[0].ExecutionTrust != trust {
		t.Fatal("preference not durable", err)
	}
	payload["enabled"] = true
	response = consoleRequest(t, server.URL, s.Token(), http.MethodPost, "/api/peers/execution-trust", payload)
	response.Body.Close()
	if response.StatusCode != 409 || owner.changes.Load() != 1 {
		t.Fatal("stale change altered running connections")
	}
	response = consoleRequest(t, server.URL, s.Token(), http.MethodGet, "/api/peers/spaces", nil)
	err = json.NewDecoder(response.Body).Decode(&spaces)
	response.Body.Close()
	if err != nil || spaces.Connections[0].ExecutionTrust != trust {
		t.Fatal("refresh lost opt-out", err)
	}
}
