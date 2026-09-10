package console

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"convenewire.dev/bridge/internal/peer"
	wire "convenewire.dev/contracts/generated/go/peer"
)

type consoleJoinOwner struct {
	*consolePeerOwner
	access  peer.OwnerOperations
	changes atomic.Int32
}

func (p *consoleJoinOwner) PeerOwnerAccess() (peer.OwnerOperations, error) { return p.access, nil }
func (p *consoleJoinOwner) PeerAuthorizationChanged(string)                { p.changes.Add(1) }

type consoleOwnerOperations struct {
	service *Service
	calls   atomic.Int32
	failure atomic.Bool
}

func (p *consoleOwnerOperations) check() error {
	p.calls.Add(1)
	if !p.service.mu.TryLock() {
		return peer.ErrStore
	}
	p.service.mu.Unlock()
	if p.failure.Load() {
		return peer.ErrTLSConfiguration
	}
	return nil
}
func (p *consoleOwnerOperations) Preview(_ context.Context, input peer.InvitationInput) (peer.JoinReview, error) {
	return peer.JoinReview{OperationID: input.OperationID, LocalUserID: "user_nativeowner001"}, p.check()
}
func (p *consoleOwnerOperations) Confirm(_ context.Context, input peer.JoinConfirmation) (peer.JoinOutcome, error) {
	return peer.JoinOutcome{OperationID: input.OperationID, State: "active", Membership: wire.PeerMembership{PeerID: "peer_consoleowner001"}}, p.check()
}
func (p *consoleOwnerOperations) Recover(_ context.Context, id string) (peer.JoinOutcome, error) {
	return peer.JoinOutcome{OperationID: id, State: "active", Membership: wire.PeerMembership{PeerID: "peer_consoleowner001"}}, p.check()
}
func (p *consoleOwnerOperations) Pending() ([]peer.PendingJoinView, error) {
	return []peer.PendingJoinView{}, p.check()
}
func (p *consoleOwnerOperations) HumanEntry(context.Context, string, wire.PeerScope, string) (peer.HumanEntry, error) {
	var entry peer.HumanEntry
	entry.HostOrigin, entry.ExchangeExpiresAt = "https://127.0.0.1:40123", "2026-09-10T02:01:00.000Z"
	entry.Credential.CredentialID, entry.Credential.Token = "credential_browser001", "one-use-entry"
	entry.Credential.Scope.Kind, entry.Credential.Scope.TeamID = "team", "team_ownerconsole001"
	entry.Proof.Signature = "private-proof-must-not-be-returned"
	return entry, p.check()
}

func TestPeerConsoleOwnerRoutesRequireLocalOwnerAndExactJSON(t *testing.T) {
	service, approvals, server := peerConsoleFixture(t)
	access := &consoleOwnerOperations{service: service}
	owner := &consoleJoinOwner{consolePeerOwner: approvals, access: access}
	service.mu.Lock()
	service.options.NativePeers = owner
	opened := 0
	service.dependencies.OpenPeerEntry = func(origin, id, token string) error {
		if origin != "https://127.0.0.1:40123" || id != "credential_browser001" || token != "one-use-entry" {
			t.Error("browser handoff changed verified identity")
		}
		opened++
		return nil
	}
	service.mu.Unlock()
	routes := []struct{ path, method, body string }{
		{"/api/peers/invitations/preview", "POST", `{"operationId":"op_consolejoin001"}`},
		{"/api/peers/invitations/confirm", "POST", `{"operationId":"op_consolejoin001","displayName":"Owner","reviewedInvitationDigest":"reviewed"}`},
		{"/api/peers/joins", "GET", ""},
		{"/api/peers/joins/op_consolejoin001/recover", "POST", `{}`},
		{"/api/peers/human-entry", "POST", `{"membershipId":"membership_ownerconsole001","scope":{"kind":"team","teamId":"team_ownerconsole001"},"operationId":"op_consoleentry001"}`},
		{"/api/peers/human-entry/open", "POST", `{"membershipId":"membership_ownerconsole001","scope":{"kind":"team","teamId":"team_ownerconsole001"},"operationId":"op_consoleentry001"}`},
	}
	for _, route := range routes {
		for _, mode := range []string{"missing", "machine", "foreign-origin", "query", "valid"} {
			path := route.path
			if mode == "query" {
				path += "?secret=forbidden"
			}
			request, _ := http.NewRequest(route.method, server.URL+path, strings.NewReader(route.body))
			if mode != "missing" {
				token := service.Token()
				if mode == "machine" {
					token = "peer-machine-token"
				}
				request.Header.Set("authorization", "Bearer "+token)
			}
			if mode == "foreign-origin" {
				request.Header.Set("origin", "https://foreign-peer.example")
			}
			before := access.calls.Load()
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			want := 200
			if mode == "missing" || mode == "machine" {
				want = 401
			} else if mode != "valid" {
				want = 403
			}
			if response.StatusCode != want {
				t.Fatalf("%s %s: %d %s", route.path, mode, response.StatusCode, raw)
			}
			if mode != "valid" && access.calls.Load() != before {
				t.Fatal("unauthorized request reached owner capability")
			}
			if mode == "valid" {
				if response.Header.Get("cache-control") != "no-store" {
					t.Fatal("secret-bearing owner response cached")
				}
				if route.path == "/api/peers/human-entry/open" {
					var decoded map[string]any
					if json.Unmarshal(raw, &decoded) != nil || len(decoded) != 2 || decoded["status"] != "opened" || strings.Contains(string(raw), "one-use-entry") || opened != 1 {
						t.Fatal("browser handoff disclosed a credential or opened more than once")
					}
				}
				if route.path == "/api/peers/human-entry" {
					var decoded map[string]any
					if json.Unmarshal(raw, &decoded) != nil || len(decoded) != 5 || decoded["token"] != "one-use-entry" || strings.Contains(string(raw), "private-proof") {
						t.Fatal("human response did not restrict disclosure")
					}
				}
			}
		}
		if route.method == "GET" {
			continue
		}
		for _, raw := range []string{`null`, `[]`, `{"participant":{"nodeId":"node_foreign001"}}`, `{"localUserId":"user_foreign001"}`, `{"operationId":"first","operationId":"second"}`, `{ } { }`} {
			request, _ := http.NewRequest(route.method, server.URL+route.path, strings.NewReader(raw))
			request.Header.Set("authorization", "Bearer "+service.Token())
			before := access.calls.Load()
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 400 || before != access.calls.Load() {
				t.Fatal("ambiguous owner input accepted", route.path, raw, response.StatusCode)
			}
		}
	}
	if owner.changes.Load() != 2 {
		t.Fatal("successful joins did not notify connector", owner.changes.Load())
	}
	if opened != 1 {
		t.Fatal("unauthorized caller opened browser")
	}
	service.mu.Lock()
	service.dependencies.OpenPeerEntry = func(string, string, string) error { return errors.New("secret-browser-proof") }
	service.mu.Unlock()
	failedOpen := consoleRequest(t, server.URL, service.Token(), "POST", "/api/peers/human-entry/open", map[string]any{})
	raw, _ := io.ReadAll(failedOpen.Body)
	failedOpen.Body.Close()
	if failedOpen.StatusCode != 409 || strings.Contains(string(raw), "secret-browser-proof") {
		t.Fatal("unsafe browser error", string(raw))
	}
	access.failure.Store(true)
	response := consoleRequest(t, server.URL, service.Token(), "POST", "/api/peers/invitations/confirm", map[string]any{})
	var body map[string]string
	json.NewDecoder(response.Body).Decode(&body)
	response.Body.Close()
	if response.StatusCode != 409 || body["code"] != "PEER_TLS_CONFIGURATION_UNAVAILABLE" || owner.changes.Load() != 2 {
		t.Fatal("unconfirmed join changed authority", body)
	}
}

type retiringPeerEntry struct{ *consoleOwnerOperations }

func (p *retiringPeerEntry) HumanEntry(ctx context.Context, membershipID string, scope wire.PeerScope, operationID string) (peer.HumanEntry, error) {
	entry, err := p.consoleOwnerOperations.HumanEntry(ctx, membershipID, scope, operationID)
	p.service.mu.Lock()
	p.service.closed = true
	p.service.mu.Unlock()
	return entry, err
}

func TestPeerBrowserOpenRejectsConsoleRetirementDuringHumanRequest(t *testing.T) {
	service, approvals, server := peerConsoleFixture(t)
	access := &retiringPeerEntry{&consoleOwnerOperations{service: service}}
	service.mu.Lock()
	service.options.NativePeers = &consoleJoinOwner{consolePeerOwner: approvals, access: access}
	service.dependencies.OpenPeerEntry = func(string, string, string) error { t.Error("retired Console opened browser"); return nil }
	service.mu.Unlock()
	defer func() { service.mu.Lock(); service.closed = false; service.mu.Unlock() }()
	response := consoleRequest(t, server.URL, service.Token(), "POST", "/api/peers/human-entry/open", map[string]any{})
	response.Body.Close()
	if response.StatusCode != 409 {
		t.Fatal("retired Console accepted browser handoff", response.StatusCode)
	}
}
