package peer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

func executionTLSFixture(t *testing.T) (*peerHTTPFixture, *Client, *Store, string, wire.PeerExecutionBinding, time.Time) {
	t.Helper()
	return executionTLSFixtureSource(t, fixtureExportSource(), time.Date(2026, 9, 10, 2, 0, 0, 0, time.UTC))
}

func executionTLSFixtureSource(t *testing.T, source ExportSource, now time.Time) (*peerHTTPFixture, *Client, *Store, string, wire.PeerExecutionBinding, time.Time) {
	t.Helper()
	f, client, store, joined, now := runtimeTLSParticipantAt(t, now)
	exporter, err := NewExporter(store, func(string) (ExportSource, error) { return source, nil })
	if err != nil {
		t.Fatal(err)
	}
	state, _ := store.Read()
	if _, err := exporter.Prepare(state.Revision, fixtureExportRequest(state, source), now); err != nil {
		t.Fatal(err)
	}
	membershipID := joined.Membership.MembershipID
	if _, err := client.SyncExports(context.Background(), exporter, membershipID, source.AgentID, "op_runexportsync001"); err == nil {
		t.Fatal("fixture did not lose first sync response")
	}
	if _, err := client.SyncExports(context.Background(), exporter, membershipID, source.AgentID, "op_runexportsync001"); err != nil {
		t.Fatal(err)
	}
	f.control(t, map[string]any{"action": "accept-agent"})
	if _, err := client.SyncExports(context.Background(), exporter, membershipID, source.AgentID, "op_runexportsync002"); err != nil {
		t.Fatal(err)
	}
	var value struct{ Request json.RawMessage }
	f.controlResult(t, map[string]any{"action": "create-run"}, &value)
	if err := wire.VerifyRunRequest(value.Request); err != nil {
		t.Fatal("actual Host request did not verify in Go", err)
	}
	var request struct{ Binding wire.PeerExecutionBinding }
	if err := wire.Decode("PeerRunRequest", value.Request, &request); err != nil {
		t.Fatal(err)
	}
	return f, client, store, membershipID, request.Binding, now
}

func TestGoPeerExecutionAdmissionVerifiesRealHostAndRefreshesExactBinding(t *testing.T) {
	f, client, store, membershipID, binding, now := executionTLSFixture(t)
	receipt, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding)
	if err != nil || receipt.Binding != binding {
		t.Fatal("actual TLS Host admission", err)
	}
	operation, nonce := receipt.Proof.Payload.OperationID, receipt.Proof.Payload.Nonce
	if err := VerifyExecutionAdmission(receipt, binding, f.Host, client.signer.Identity(), operation, nonce, now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ExecutionAdmission){
		func(r *ExecutionAdmission) { r.Binding.AcceptanceRevision++ },
		func(r *ExecutionAdmission) { r.Binding.RequestDigest = strings.Repeat("b", 64) },
		func(r *ExecutionAdmission) { r.Proof.Payload.Purpose = "peer.connect" },
		func(r *ExecutionAdmission) { r.Proof.Payload.AudienceNodeID = f.Host.NodeID },
	} {
		changed := receipt
		mutate(&changed)
		if VerifyExecutionAdmission(changed, binding, f.Host, client.signer.Identity(), operation, nonce, now) == nil {
			t.Fatal("changed execution receipt authorized continuation")
		}
	}
	if VerifyExecutionAdmission(receipt, binding, f.Host, client.signer.Identity(), operation, nonce, now.Add(31*time.Second)) == nil {
		t.Fatal("stale execution proof survived a resource wait")
	}
	later := now.Add(time.Minute)
	f.control(t, map[string]any{"action": "clock", "now": later.Format(peerTimeFormat)})
	client.clock = func() time.Time { return later }
	refreshed, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding)
	if err != nil || refreshed.Binding != binding || refreshed.Proof.Payload.Nonce == nonce {
		t.Fatal("freshness changed execution identity", err)
	}
	// A response lost in transit can refresh this same binding; there is no new
	// Run, content replacement or authorization revision hidden in that retry.
	client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
		response, err := client.transport.RoundTrip(request)
		if err == nil && request.URL.Path == "/api/peer/runs/admit" {
			_ = response.Body.Close()
			return nil, io.ErrUnexpectedEOF
		}
		return response, err
	})
	if _, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding); err == nil {
		t.Fatal("lost receipt treated as accepted")
	}
	client.http.Transport = client.transport
	if _, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding); err != nil {
		t.Fatal("exact request did not recover", err)
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": membershipID})
	if _, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding); err == nil {
		t.Fatal("Host revocation admitted execution")
	}
}

func TestGoPeerAdmissionRechecksNativeAndLocalAuthorityAroundNetworkWait(t *testing.T) {
	for _, mode := range []string{"native change before bearer", "local leave before return", "changed response"} {
		t.Run(mode, func(t *testing.T) {
			_, client, store, membershipID, binding, now := executionTLSFixture(t)
			var native atomic.Bool
			native.Store(true)
			client.beforeOperation = func() error {
				if !native.Load() {
					return ErrProof
				}
				return nil
			}
			bearers := 0
			client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
				if request.URL.Path == "/api/peer/runs/admit" {
					bearers++
				}
				response, err := client.transport.RoundTrip(request)
				if err != nil {
					return response, err
				}
				if mode == "native change before bearer" && request.URL.Path == "/api/peer/identity" {
					native.Store(false)
				}
				if request.URL.Path == "/api/peer/runs/admit" && mode == "local leave before return" {
					state, err := store.Read()
					if err != nil {
						t.Fatal(err)
					}
					state.Connections[0].State = "left"
					state.Revision++
					if err := store.Update(state.Revision-1, state, now); err != nil {
						t.Fatal(err)
					}
				}
				if request.URL.Path == "/api/peer/runs/admit" && mode == "changed response" {
					var receipt ExecutionAdmission
					if err := json.NewDecoder(response.Body).Decode(&receipt); err != nil {
						t.Fatal(err)
					}
					_ = response.Body.Close()
					receipt.Binding.GrantRevision++
					raw, _ := json.Marshal(receipt)
					response.Body = io.NopCloser(strings.NewReader(string(raw)))
					response.ContentLength = int64(len(raw))
				}
				return response, nil
			})
			if _, err := client.AuthorizeExecution(context.Background(), store, membershipID, binding); err == nil {
				t.Fatal("changed authority survived Host wait")
			}
			if mode == "native change before bearer" && bearers != 0 {
				t.Fatal("machine bearer escaped after native identity loss")
			}
		})
	}
}
