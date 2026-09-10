package peer

import (
	"bytes"
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

func TestPeerRunClientPollsPublishesAndSettlesRevokedHistoryWithoutReplay(t *testing.T) {
	f, client, store, membership, binding, now := executionTLSFixture(t)
	connection, err := client.ConnectRuntime(context.Background(), store, membership)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	delivery, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || delivery == nil || delivery.Settlement.Binding != binding {
		t.Fatal("poll actual Host", err)
	}
	duplicate, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || !equalJSON(duplicate, delivery) {
		t.Fatal("poll changed durable delivery", err)
	}
	next, err := client.PollRuns(context.Background(), connection, []wire.PeerRunKnown{{RunID: binding.RunID, RequestDigest: binding.RequestDigest}})
	if err != nil || next != nil {
		t.Fatal("known request was reoffered", err)
	}
	current := func() error { return nil }
	for _, raw := range []string{`{"type":"status","sequence":1,"status":"delivered"}`, `{"type":"status","sequence":2,"status":"working"}`} {
		if _, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, json.RawMessage(raw), current); err != nil {
			t.Fatal(err)
		}
	}
	event, _ := json.Marshal(map[string]any{"type": "reply", "sequence": 3, "content": strings.Repeat("完整回复", 1800), "assessment": map[string]any{"confidence": 0.875}})
	client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
		response, err := client.transport.RoundTrip(request)
		if err == nil && request.URL.Path == "/api/peer/runs/events" {
			_ = response.Body.Close()
			return nil, io.ErrUnexpectedEOF
		}
		return response, err
	})
	if _, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, event, current); err == nil {
		t.Fatal("lost event response accepted")
	}
	client.http.Transport = client.transport
	receipt, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, event, current)
	if err != nil || receipt.Sequence != 3 {
		t.Fatal("event retry", err)
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": membership})
	state, err := store.Read()
	if err != nil {
		t.Fatal(err)
	}
	state.Revision++
	state.Connections[0].State = "left"
	if err := store.Update(state.Revision-1, state, now); err != nil {
		t.Fatal(err)
	}
	if _, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, event, current); err == nil {
		t.Fatal("left membership published content")
	}
	digest, err := delivery.ReceiptDigest()
	if err != nil {
		t.Fatal(err)
	}
	settlement := wire.PeerSettlement{SchemaVersion: 1, CapabilityID: delivery.Settlement.CapabilityID, OperationID: "op_clientsettlement001",
		BindingDigest: mustDigest(t, binding), ReceiptDigest: digest, Sequence: 1, State: "completed"}
	for range 2 {
		receipt, err := client.SettleRun(context.Background(), store, membership, *delivery, settlement)
		if err != nil || receipt.Settlement != settlement {
			t.Fatal("retained settlement", err)
		}
	}
	var result struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
	if result.State != "completed" || result.Events != 4 || result.Replies != 1 || result.Settlements != 1 {
		t.Fatalf("Host replayed work: %+v", result)
	}
	later := now.Add(7 * 24 * time.Hour)
	client.clock = func() time.Time { return later }
	if _, err := client.SettleRun(context.Background(), store, membership, *delivery, settlement); err == nil {
		t.Fatal("settlement renewed after expiry")
	}
}

func TestPeerRunClientRejectsChangedProofResponseAndLocalAuthorityAfterWait(t *testing.T) {
	for _, mode := range []string{"changed delivery", "local permission", "identity"} {
		t.Run(mode, func(t *testing.T) {
			_, client, store, membership, _, _ := executionTLSFixture(t)
			connection, err := client.ConnectRuntime(context.Background(), store, membership)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			delivery, err := client.PollRuns(context.Background(), connection, nil)
			if err != nil || delivery == nil {
				t.Fatal(err)
			}
			var changed atomic.Bool
			var events atomic.Int32
			client.beforeOperation = func() error {
				if mode == "identity" && changed.Load() {
					return ErrStore
				}
				return nil
			}
			client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
				if request.URL.Path == "/api/peer/runs/events" {
					events.Add(1)
				}
				response, err := client.transport.RoundTrip(request)
				if err != nil {
					return response, err
				}
				if request.URL.Path == "/api/peer/identity" {
					changed.Store(true)
				}
				if mode == "changed delivery" && request.URL.Path == "/api/peer/runs/poll" {
					raw, err := io.ReadAll(response.Body)
					_ = response.Body.Close()
					if err != nil {
						return nil, err
					}
					var value map[string]any
					if json.Unmarshal(raw, &value) != nil {
						t.Fatal("decode")
					}
					value["delivery"].(map[string]any)["settlement"].(map[string]any)["expiresAt"] = "2026-09-17T02:00:00.001Z"
					raw, _ = json.Marshal(value)
					response.Body = io.NopCloser(bytes.NewReader(raw))
					response.ContentLength = int64(len(raw))
				}
				return response, nil
			})
			if mode == "changed delivery" {
				if _, err := client.PollRuns(context.Background(), connection, nil); err == nil {
					t.Fatal("changed Host delivery accepted")
				}
				return
			}
			current := func() error {
				if mode == "local permission" && changed.Load() {
					return ErrExport
				}
				return nil
			}
			if _, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, json.RawMessage(`{"type":"status","sequence":1,"status":"delivered"}`), current); err == nil {
				t.Fatal("authority changed during identity wait")
			}
			if events.Load() != 0 {
				t.Fatal("content or machine bearer sent after local authority changed")
			}
		})
	}
}
