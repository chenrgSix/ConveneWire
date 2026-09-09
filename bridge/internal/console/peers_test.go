package console

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/peer"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type consolePeerOwner struct{ approvals *peer.Approvals }

func (p *consolePeerOwner) PeerStatus() peer.ConnectorSnapshot {
	return peer.ConnectorSnapshot{State: "running", Connections: []peer.ConnectorStatus{}}
}
func (p *consolePeerOwner) PeerApprovals() ([]peer.ApprovalView, error) {
	return p.approvals.Pending(), nil
}
func (p *consolePeerOwner) DecidePeerApproval(value peer.ApprovalDecision) error {
	return p.approvals.Decide(value)
}

func peerConsoleFixture(t *testing.T) (*Service, *consolePeerOwner, *httptest.Server) {
	t.Helper()
	owner := &consolePeerOwner{approvals: &peer.Approvals{}}
	root := t.TempDir()
	service, err := New(Options{ConfigPath: filepath.Join(root, "bridge.json"), DataDir: filepath.Join(root, "data"), NativePeers: owner}, inertDependencies())
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(service.Handler())
	t.Cleanup(func() { server.Close(); service.Close(); owner.approvals.Close() })
	return service, owner, server
}

func consolePeerBinding() wire.PeerExecutionBinding {
	return wire.PeerExecutionBinding{SchemaVersion: 1, AuthorityNodeID: "node_approvalhost001", ParticipantNodeID: "node_approvallocal001",
		PeerID: "peer_approvalpeer001", TeamID: "team_approvalteam001", RoomID: "room_approvalroom001", RunID: "run_approvalrun001",
		ProjectionAgentID: "agent_projection001", LocalAgentID: "agent_localagent001", ExportID: "export_approval001", GrantRevision: 3,
		GrantDigest: strings.Repeat("a", 64), AcceptanceID: "acceptance_approval001", AcceptanceRevision: 2,
		AcceptanceDigest: strings.Repeat("b", 64), RequestDigest: strings.Repeat("c", 64)}
}

func TestPeerConsoleAcceptsOnlyOwnerAndLocalOriginWithoutLegacyFallback(t *testing.T) {
	service, _, server := peerConsoleFixture(t)
	for _, route := range []string{"/api/peers/status", "/api/peers/approvals", "/api/peers/approvals/approval_request001"} {
		method := http.MethodGet
		if strings.Contains(route, "approval_request") {
			method = http.MethodPost
		}
		for _, token := range []string{"", "peer-machine-token", "device-token", "host-owner-token"} {
			r := consoleRequest(t, server.URL, token, method, route, nil)
			r.Body.Close()
			if r.StatusCode != http.StatusUnauthorized {
				t.Fatal("nonlocal credential reached Peer operation", route, r.StatusCode)
			}
		}
	}
	for _, change := range []string{"origin", "host", "fetch", "forwarded"} {
		request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/peers/status", nil)
		request.Header.Set("authorization", "Bearer "+service.Token())
		switch change {
		case "origin":
			request.Header.Set("origin", "https://remote-host.example")
		case "host":
			request.Host = "remote-host.example:8080"
		case "fetch":
			request.Header.Set("sec-fetch-site", "cross-site")
		case "forwarded":
			request.Header.Set("forwarded", "host=remote-host.example")
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusForbidden {
			t.Fatal("foreign Peer Console origin accepted", change, response.StatusCode)
		}
	}
	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/peers/status", nil)
	request.Header.Set("authorization", "Bearer "+service.Token())
	request.Header.Set("origin", server.URL)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("cache-control") != "no-store" {
		t.Fatal("local native status unavailable", response.StatusCode)
	}
	service.mu.Lock()
	service.options.NativePeers = nil
	service.mu.Unlock()
	response = consoleRequest(t, server.URL, service.Token(), http.MethodGet, "/api/peers/status", nil)
	response.Body.Close()
	if response.StatusCode != http.StatusConflict {
		t.Fatal("legacy Device profile supplied a Peer owner")
	}
}

func TestPeerConsoleDecisionConsumesOnlyExactLiveLocalApproval(t *testing.T) {
	for _, allow := range []bool{true, false} {
		t.Run(map[bool]string{true: "allow", false: "deny"}[allow], func(t *testing.T) {
			service, owner, server := peerConsoleFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			binding := consolePeerBinding()
			session, err := owner.approvals.Open(ctx, binding, func(context.Context) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			defer session.Close()
			input := contracts.RuntimeApprovalRequestedPayload{RequestID: "approval_console001", RunID: binding.RunID,
				AgentID: binding.ProjectionAgentID, Revision: binding.GrantRevision, OperationKind: "command", Details: "Command: pwd", ExpiresAt: time.Now().Add(time.Minute)}
			type result struct {
				allow bool
				err   error
			}
			done := make(chan result, 1)
			go func() { value, err := session.Approve(ctx, input); done <- result{value, err} }()
			deadline := time.Now().Add(3 * time.Second)
			for len(owner.approvals.Pending()) == 0 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			response := consoleRequest(t, server.URL, service.Token(), http.MethodGet, "/api/peers/approvals", nil)
			var body struct {
				Approvals []peer.ApprovalView `json:"approvals"`
			}
			err = json.NewDecoder(response.Body).Decode(&body)
			response.Body.Close()
			if err != nil || response.StatusCode != 200 || len(body.Approvals) != 1 {
				t.Fatal("exact local decision unavailable", err)
			}
			view := body.Approvals[0]
			if view.Binding != binding || view.Details != input.Details {
				t.Fatal("review omitted scope or runtime callback")
			}
			payload := map[string]any{"processId": view.ProcessID, "bindingDigest": view.BindingDigest, "consentRevision": view.ConsentRevision, "allow": allow}
			route := "/api/peers/approvals/" + view.RequestID
			for _, field := range []string{"processId", "bindingDigest", "consentRevision", "allow", "deviceId"} {
				wrong := map[string]any{}
				for key, value := range payload {
					wrong[key] = value
				}
				want := 409
				switch field {
				case "consentRevision":
					wrong[field] = view.ConsentRevision + 1
				case "allow":
					delete(wrong, field)
					want = 400
				case "deviceId":
					wrong[field] = "device_foreign001"
					want = 400
				default:
					wrong[field] = "changed"
				}
				response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, route, wrong)
				response.Body.Close()
				if response.StatusCode != want {
					t.Fatal("substituted local approval accepted", field, response.StatusCode)
				}
			}
			response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, route, payload)
			response.Body.Close()
			if response.StatusCode != 200 {
				t.Fatal("exact owner decision failed", response.StatusCode)
			}
			select {
			case got := <-done:
				if got.err != nil || got.allow != allow {
					t.Fatal("local callback result", got)
				}
			case <-time.After(time.Second):
				t.Fatal("Owner decision did not release local callback")
			}
			response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, route, payload)
			response.Body.Close()
			if response.StatusCode != 409 {
				t.Fatal("consumed approval replayed")
			}
		})
	}
}

func TestPeerConsoleRejectsAmbiguousOrOversizedDecisionJSON(t *testing.T) {
	service, _, server := peerConsoleFixture(t)
	for _, body := range []string{`{"allow":true,"allow":false}`, `{"allow":true} {}`, `{"allow":null}`, strings.Repeat(" ", 16*1024) + `{}`} {
		request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/peers/approvals/approval_console001", strings.NewReader(body))
		request.Header.Set("authorization", "Bearer "+service.Token())
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 400 {
			t.Fatal("ambiguous owner decision accepted", response.StatusCode)
		}
	}
}
