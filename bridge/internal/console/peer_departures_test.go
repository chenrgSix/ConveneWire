package console

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"convenewire.dev/bridge/internal/peer"
)

type consoleDepartureOwner struct {
	*consolePeerOwner
	service   *Service
	prepared  atomic.Bool
	notified  atomic.Bool
	offline   atomic.Bool
	confirmed atomic.Bool
	calls     atomic.Int32
}

func (p *consoleDepartureOwner) PeerDepartures() (peer.DepartureOperations, error) { return p, nil }
func (p *consoleDepartureOwner) PeerAuthorizationChanged(string)                   { p.notified.Store(true) }
func (p *consoleDepartureOwner) view() peer.DepartureView {
	state := "pending"
	if p.confirmed.Load() {
		state = "confirmed"
	}
	return peer.DepartureView{Intent: peer.LeaveIntent{OperationID: "op_consoledeparture001", MembershipID: "peermember_consoledeparture001", PeerID: "peer_consoledeparture001"}, LocalState: "left", HostState: state}
}
func (p *consoleDepartureOwner) Prepare(context.Context, string, string) (peer.DepartureView, error) {
	p.calls.Add(1)
	p.prepared.Store(true)
	return p.view(), nil
}
func (p *consoleDepartureOwner) Synchronize(context.Context, string) (peer.DepartureView, error) {
	p.calls.Add(1)
	if !p.prepared.Load() || !p.notified.Load() || !p.service.mu.TryLock() {
		return peer.DepartureView{}, peer.ErrStore
	}
	p.service.mu.Unlock()
	if p.offline.Load() {
		return peer.DepartureView{}, peer.ErrTransport
	}
	p.confirmed.Store(true)
	return p.view(), nil
}
func (p *consoleDepartureOwner) List() ([]peer.DepartureView, error) {
	p.calls.Add(1)
	if p.prepared.Load() {
		return []peer.DepartureView{p.view()}, nil
	}
	return []peer.DepartureView{}, nil
}

func TestPeerConsoleDepartureFencesBeforeHostWaitAndPreservesOfflineRecovery(t *testing.T) {
	service, approvals, server := peerConsoleFixture(t)
	owner := &consoleDepartureOwner{consolePeerOwner: approvals, service: service}
	owner.offline.Store(true)
	service.mu.Lock()
	service.options.NativePeers = owner
	service.mu.Unlock()
	recoverPath := "/api/peers/departures/peermember_consoledeparture001/recover"
	for _, route := range []string{"/api/peers/departures", recoverPath} {
		for _, mode := range []string{"no-owner", "foreign-origin", "ambiguous", "identity", "null"} {
			body := `{}`
			if mode == "ambiguous" {
				body = `{"operationId":"first","operationId":"second"}`
			}
			if mode == "identity" {
				body = `{"participant":{"nodeId":"node_foreign001"}}`
			}
			if mode == "null" {
				body = `null`
			}
			request, _ := http.NewRequest("POST", server.URL+route, strings.NewReader(body))
			if mode != "no-owner" {
				request.Header.Set("authorization", "Bearer "+service.Token())
			}
			if mode == "foreign-origin" {
				request.Header.Set("origin", "https://foreign.example")
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			want := 400
			if mode == "no-owner" {
				want = 401
			}
			if mode == "foreign-origin" {
				want = 403
			}
			if response.StatusCode != want || owner.calls.Load() != 0 {
				t.Fatal("invalid caller reached departure", route, mode, response.StatusCode)
			}
		}
	}
	body := map[string]string{"membershipId": "peermember_consoledeparture001", "operationId": "op_consoledeparture001"}
	response := consoleRequest(t, server.URL, service.Token(), "POST", "/api/peers/departures", body)
	var result struct {
		Departure peer.DepartureView `json:"departure"`
		Code      string             `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 202 || result.Code != "PEER_DEPARTURE_PENDING" || result.Departure.LocalState != "left" ||
		result.Departure.HostState != "pending" || !owner.prepared.Load() || !owner.notified.Load() {
		t.Fatal("offline departure lost local fence", result)
	}
	response = consoleRequest(t, server.URL, service.Token(), "GET", "/api/peers/departures", nil)
	var inventory struct {
		Departures []peer.DepartureView `json:"departures"`
	}
	json.NewDecoder(response.Body).Decode(&inventory)
	response.Body.Close()
	if response.StatusCode != 200 || len(inventory.Departures) != 1 || inventory.Departures[0].HostState != "pending" {
		t.Fatal("pending departure not reviewable")
	}
	owner.offline.Store(false)
	response = consoleRequest(t, server.URL, service.Token(), "POST", recoverPath, map[string]any{})
	result = struct {
		Departure peer.DepartureView `json:"departure"`
		Code      string             `json:"code"`
	}{}
	json.NewDecoder(response.Body).Decode(&result)
	response.Body.Close()
	if response.StatusCode != 200 || result.Departure.HostState != "confirmed" || result.Departure.LocalState != "left" {
		t.Fatal("original departure recovery failed", result)
	}
}
