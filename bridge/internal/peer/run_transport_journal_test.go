package peer

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func transportJournalFixture(t *testing.T) (journalFixture, RunDelivery) {
	t.Helper()
	f := runJournalFixture(t)
	token, _ := NewNonce()
	delivery := RunDelivery{SchemaVersion: 1, Request: f.raw, Settlement: RunSettlementCapability{SchemaVersion: 1, Audience: "peer.settlement",
		CapabilityID: "peersettle_journaltransport001", Binding: f.binding, Token: token, IssuedAt: f.now.Format(peerTimeFormat), ExpiresAt: f.now.Add(7 * 24 * time.Hour).Format(peerTimeFormat)}}
	if _, err := f.journal.ReceiveDelivery(delivery, f.now); err != nil {
		t.Fatal(err)
	}
	return f, delivery
}

func (f journalFixture) reopenJournal(t *testing.T) *RunJournal {
	t.Helper()
	partitions, err := NewRuntimePartitions(f.root, f.store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	partition, err := partitions.Open(f.journal.partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	return partition.Runs()
}

func (f journalFixture) eventReceipt(t *testing.T, delivery RunDelivery, event json.RawMessage) RunEventReceipt {
	t.Helper()
	sequence, _ := eventSequence(event)
	receipt := RunEventReceipt{SchemaVersion: 1, BindingDigest: mustDigest(t, f.binding), CapabilityID: delivery.Settlement.CapabilityID,
		Sequence: sequence, EventDigest: mustDigest(t, event)}
	nonce, _ := NewNonce()
	proof, err := f.host.Sign(ProofContext{Purpose: "run.event", AudienceNodeID: f.binding.ParticipantNodeID, OperationID: "op_" + nonce, Nonce: nonce,
		SubjectDigest: mustDigest(t, map[string]any{"schemaVersion": 1, "bindingDigest": receipt.BindingDigest, "capabilityId": receipt.CapabilityID, "sequence": sequence, "eventDigest": receipt.EventDigest})}, f.now)
	if err != nil {
		t.Fatal(err)
	}
	receipt.Proof = proof
	return receipt
}

func TestPeerRunTransportJournalRetainsOrderedEventsAndHistoricalReceipts(t *testing.T) {
	f, delivery := transportJournalFixture(t)
	id := f.binding.RunID
	if _, err := f.journal.PrepareSettlement(id); err == nil {
		t.Fatal("invented outcome")
	}
	if _, err := f.journal.Begin(id, f.admission(t, f.now), f.now); err != nil {
		t.Fatal(err)
	}
	events := []json.RawMessage{json.RawMessage(`{"type":"status","sequence":1,"status":"delivered"}`), json.RawMessage(`{"type":"status","sequence":2,"status":"working"}`)}
	for _, event := range events {
		for range 2 {
			if _, err := f.journal.AppendEvent(id, event); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := f.journal.AppendEvent(id, json.RawMessage(`{"type":"status","sequence":2,"status":"failed"}`)); !errors.Is(err, ErrConflict) {
		t.Fatal("sequence collision", err)
	}
	if _, err := f.journal.AcknowledgeEvent(id, f.eventReceipt(t, delivery, events[1])); err == nil {
		t.Fatal("acknowledged gap")
	}
	for _, event := range events {
		receipt := f.eventReceipt(t, delivery, event)
		for range 2 {
			if _, err := f.journal.AcknowledgeEvent(id, receipt); err != nil {
				t.Fatal(err)
			}
		}
	}
	state, _ := f.journal.Transport(id)
	state.Events[0][0] = '['
	state.Acknowledgment.EventDigest = strings.Repeat("a", 64)
	state, err := f.journal.Transport(id)
	if err != nil || state.Acknowledged() != 2 || len(state.Events) != 2 {
		t.Fatal("caller changed retained evidence", err)
	}
	forged := f.eventReceipt(t, delivery, events[1])
	forged.Proof.Payload.AudienceNodeID = "node_foreignreceipt001"
	if _, err := f.journal.AcknowledgeEvent(id, forged); err == nil {
		t.Fatal("forged acknowledgment")
	}
	local, _ := f.store.Read()
	local.Connections[0].State = "left"
	local.Revision++
	if err := f.store.Update(local.Revision-1, local, f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.journal.Finish(id, RunOutcome{State: "completed", Reply: "retained local reply"}, f.now); err != nil {
		t.Fatal(err)
	}
	settlement, err := f.journal.PrepareSettlement(id)
	if err != nil {
		t.Fatal(err)
	}
	reopened := f.reopenJournal(t)
	if duplicate, err := reopened.PrepareSettlement(id); err != nil || duplicate != settlement {
		t.Fatal("settlement identity changed", err)
	}
	if _, err := reopened.Begin(id, f.admission(t, f.now), f.now); err == nil {
		t.Fatal("retained transport restarted adapter")
	}
	if _, err := reopened.ReceiveDelivery(delivery, f.now.Add(16*24*time.Hour)); err != nil {
		t.Fatal("historical receipt lost", err)
	}
	changed := delivery
	changed.Settlement.Token, _ = NewNonce()
	if _, err := reopened.ReceiveDelivery(changed, f.now); !errors.Is(err, ErrConflict) {
		t.Fatal("capability replaced", err)
	}
	nonce, _ := NewNonce()
	proof, err := f.host.Sign(ProofContext{Purpose: "run.settlement", AudienceNodeID: f.binding.ParticipantNodeID, OperationID: "op_" + nonce, Nonce: nonce,
		SubjectDigest: mustDigest(t, map[string]any{"schemaVersion": 1, "settlement": settlement})}, f.now)
	if err != nil {
		t.Fatal(err)
	}
	ack := RunSettlementReceipt{SchemaVersion: 1, Settlement: settlement, Proof: proof}
	if err := reopened.AcknowledgeSettlement(id, ack); err != nil {
		t.Fatal(err)
	}
	ack.Settlement.State = "failed"
	if err := reopened.AcknowledgeSettlement(id, ack); err == nil {
		t.Fatal("changed settlement accepted")
	}
	state, err = f.reopenJournal(t).Transport(id)
	if err != nil || state.SettlementReceipt == nil || state.SettlementReceipt.Settlement != settlement {
		t.Fatal("reopened historical proof", err)
	}
}

func TestPeerRunTransportJournalRejectsCorruptionAndReservesSettlementCapacity(t *testing.T) {
	for _, mode := range []string{"delete", "rollback", "linked", "unknown", "unsigned ack", "wrong namespace"} {
		t.Run(mode, func(t *testing.T) {
			f, delivery := transportJournalFixture(t)
			id := f.binding.RunID
			event := json.RawMessage(`{"type":"status","sequence":1,"status":"delivered"}`)
			if _, err := f.journal.AppendEvent(id, event); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(f.journal.directory, id, "transport.json")
			raw, _ := os.ReadFile(path)
			if _, err := f.journal.AcknowledgeEvent(id, f.eventReceipt(t, delivery, event)); err != nil {
				t.Fatal(err)
			}
			switch mode {
			case "delete":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			case "linked":
				other := filepath.Join(t.TempDir(), "copied.json")
				if err := os.WriteFile(other, raw, 0600); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(other, path); err != nil {
					t.Fatal(err)
				}
			default:
				var value map[string]any
				_ = json.Unmarshal(raw, &value)
				if mode == "unknown" {
					value["deviceId"] = "device_foreign001"
				}
				if mode == "wrong namespace" {
					value["namespace"] = strings.Repeat("b", 64)
				}
				if mode == "unsigned ack" {
					receipt := f.eventReceipt(t, delivery, event)
					receipt.EventDigest = strings.Repeat("a", 64)
					value["acknowledgment"] = receipt
				}
				raw, _ = json.Marshal(value)
				if err := os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := f.journal.Transport(id); err == nil {
				t.Fatal("corrupt transport accepted")
			}
			if mode == "linked" || mode == "unknown" || mode == "unsigned ack" || mode == "wrong namespace" {
				if _, err := f.reopenJournal(t).Transport(id); err == nil {
					t.Fatal("cold reopen ignored corruption")
				}
			}
		})
	}
	f, _ := transportJournalFixture(t)
	id := f.binding.RunID
	if _, err := f.journal.Begin(id, f.admission(t, f.now), f.now); err != nil {
		t.Fatal(err)
	}
	count := 0
	for sequence := 1; sequence < 100; sequence++ {
		event, _ := json.Marshal(map[string]any{"type": "output", "sequence": sequence, "content": strings.Repeat("a", 20_000)})
		if _, err := f.journal.AppendEvent(id, event); err != nil {
			break
		}
		count++
	}
	if count == 0 || count >= 99 {
		t.Fatal("unbounded outbox", count)
	}
	if _, err := f.journal.Finish(id, RunOutcome{State: "failed"}, f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.journal.PrepareSettlement(id); err != nil {
		t.Fatal("outbox consumed settlement reserve", err)
	}
	state, err := f.reopenJournal(t).Transport(id)
	if err != nil || len(state.Events) != count || state.Settlement == nil {
		t.Fatal("capacity error damaged evidence", err)
	}
}

func TestPeerRunTransportJournalReopensAfterLostActualHostAcknowledgments(t *testing.T) {
	f, client, store, membership, binding, now := executionTLSFixture(t)
	connection, err := client.ConnectRuntime(context.Background(), store, membership)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	delivery, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || delivery == nil {
		t.Fatal(err)
	}
	open := func() *RunJournal {
		partitions, err := NewRuntimePartitions(filepath.Dir(store.directory), store, func() error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		partition, err := partitions.Open(membership)
		if err != nil {
			t.Fatal(err)
		}
		return partition.Runs()
	}
	journal := open()
	if _, err := journal.ReceiveDelivery(*delivery, now); err != nil {
		t.Fatal(err)
	}
	admission, err := client.AuthorizeExecution(context.Background(), store, membership, binding)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := journal.Begin(binding.RunID, admission, now); err != nil {
		t.Fatal(err)
	}
	for _, event := range []json.RawMessage{json.RawMessage(`{"type":"status","sequence":1,"status":"delivered"}`), json.RawMessage(`{"type":"status","sequence":2,"status":"working"}`), json.RawMessage(`{"type":"reply","sequence":3,"content":"durable result","assessment":{"confidence":0.875}}`)} {
		if _, err := journal.AppendEvent(binding.RunID, event); err != nil {
			t.Fatal(err)
		}
	}
	lose := func(path string) {
		client.http.Transport = peerRoundTrip(func(request *http.Request) (*http.Response, error) {
			response, err := client.transport.RoundTrip(request)
			if err == nil && request.URL.Path == path {
				_ = response.Body.Close()
				return nil, io.ErrUnexpectedEOF
			}
			return response, err
		})
	}
	state, _ := journal.Transport(binding.RunID)
	lose("/api/peer/runs/events")
	if _, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, state.Events[0], func() error { return nil }); err == nil {
		t.Fatal("lost ack accepted")
	}
	client.http.Transport = client.transport
	journal = open()
	state, err = journal.Transport(binding.RunID)
	if err != nil || state.Acknowledged() != 0 {
		t.Fatal("invented Host ack", err)
	}
	for _, event := range state.Events {
		receipt, err := client.PublishRunEvent(context.Background(), store, membership, *delivery, event, func() error { return nil })
		if err != nil {
			t.Fatal(err)
		}
		if _, err := journal.AcknowledgeEvent(binding.RunID, receipt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := journal.Begin(binding.RunID, admission, now); err == nil {
		t.Fatal("replayed possible start")
	}
	if _, err := journal.Finish(binding.RunID, RunOutcome{State: "completed", Reply: "durable result"}, now); err != nil {
		t.Fatal(err)
	}
	settlement, err := journal.PrepareSettlement(binding.RunID)
	if err != nil {
		t.Fatal(err)
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": membership})
	lose("/api/peer/runs/settle")
	if _, err := client.SettleRun(context.Background(), store, membership, *delivery, settlement); err == nil {
		t.Fatal("lost settlement ack accepted")
	}
	client.http.Transport = client.transport
	journal = open()
	recovered, err := journal.PrepareSettlement(binding.RunID)
	if err != nil || recovered != settlement {
		t.Fatal("settlement operation changed", err)
	}
	receipt, err := client.SettleRun(context.Background(), store, membership, *delivery, recovered)
	if err != nil {
		t.Fatal(err)
	}
	if err := journal.AcknowledgeSettlement(binding.RunID, receipt); err != nil {
		t.Fatal(err)
	}
	var result struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
	if result.State != "completed" || result.Events != 4 || result.Replies != 1 || result.Settlements != 1 {
		t.Fatalf("duplicate execution effects: %+v", result)
	}
}
