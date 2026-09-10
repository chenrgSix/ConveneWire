package peer

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// Exercises the production Host routes and registry through actual TLS and its
// signed Peer WebSocket, before the native execution coordinator is composed.
func TestGoPeerRunDeliveryEventsAndRevokedSettlementUseActualHost(t *testing.T) {
	f, client, store, membershipID, binding, now := executionTLSFixture(t)
	connection, err := client.ConnectRuntime(context.Background(), store, membershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	local, err := client.runtimeMembership(store, membershipID)
	if err != nil {
		t.Fatal(err)
	}
	signed := func(purpose wire.Purpose, subject any) wire.PeerProof {
		t.Helper()
		nonce, _ := NewNonce()
		proof, err := client.signer.Sign(ProofContext{Purpose: purpose, AudienceNodeID: client.host.NodeID,
			OperationID: "op_" + nonce, Nonce: nonce, SubjectDigest: mustDigest(t, subject)}, now)
		if err != nil {
			t.Fatal(err)
		}
		return proof
	}
	verify := func(proof wire.PeerProof, request wire.PeerProof, purpose wire.Purpose, subject any) {
		t.Helper()
		if err := VerifyProof(proof, client.host, ProofContext{Purpose: purpose, AudienceNodeID: client.signer.Identity().NodeID,
			OperationID: request.Payload.OperationID, Nonce: request.Payload.Nonce, SubjectDigest: mustDigest(t, subject)}, now); err != nil {
			t.Fatal("Host receipt", err)
		}
	}
	intent := map[string]any{"schemaVersion": 1, "binding": connection.Binding(), "knownRuns": []any{}}
	pollProof := signed("run.poll", intent)
	input := map[string]any{"schemaVersion": 1, "intent": intent, "proof": pollProof}
	var receipt struct {
		SchemaVersion int64           `json:"schemaVersion"`
		IntentDigest  string          `json:"intentDigest"`
		Delivery      json.RawMessage `json:"delivery"`
		Proof         wire.PeerProof  `json:"proof"`
	}
	poll := func() error {
		return client.postMachine(context.Background(), "/api/peer/runs/poll", "PeerRunPollRequest", input, "PeerRunPollReceipt", &receipt, local.Receipt.MachineCredential.Token)
	}
	if err := poll(); err != nil {
		t.Fatal("TLS poll", err)
	}
	verify(receipt.Proof, pollProof, "run.poll", map[string]any{"schemaVersion": receipt.SchemaVersion, "intentDigest": receipt.IntentDigest, "delivery": receipt.Delivery})
	digest, err := wire.RunDeliveryReceiptDigest(receipt.Delivery)
	if err != nil {
		t.Fatal("Go rejected Host delivery", err)
	}
	var delivery struct {
		Request    json.RawMessage               `json:"request"`
		Settlement wire.PeerSettlementCapability `json:"settlement"`
	}
	if err := wire.Decode("PeerRunDelivery", receipt.Delivery, &delivery); err != nil {
		t.Fatal(err)
	}
	var request struct {
		Binding wire.PeerExecutionBinding `json:"binding"`
	}
	if err := wire.Decode("PeerRunRequest", delivery.Request, &request); err != nil || request.Binding != binding {
		t.Fatal("execution changed", err)
	}
	first := append(json.RawMessage(nil), receipt.Delivery...)
	// Commit succeeds but a response body is lost. Retry must return the same
	// capability, receipt identity and deadline, not a new execution allowance.
	client.http.Transport = peerRoundTrip(func(r *http.Request) (*http.Response, error) {
		response, err := client.transport.RoundTrip(r)
		if err == nil && r.URL.Path == "/api/peer/runs/poll" {
			_ = response.Body.Close()
			return nil, io.ErrUnexpectedEOF
		}
		return response, err
	})
	if poll() == nil {
		t.Fatal("lost delivery accepted")
	}
	client.http.Transport = client.transport
	if err := poll(); err != nil || !equalJSON(first, receipt.Delivery) {
		t.Fatal("delivery retry changed", err)
	}
	events := []map[string]any{
		{"type": "status", "sequence": 1, "status": "delivered"},
		{"type": "status", "sequence": 2, "status": "working"},
		{"type": "reply", "sequence": 3, "content": "TLS Peer 完成 " + strings.Repeat("字", 6000), "assessment": map[string]any{"confidence": 0.875, "goalSatisfied": true}},
	}
	var eventReceipt struct {
		SchemaVersion int64          `json:"schemaVersion"`
		BindingDigest string         `json:"bindingDigest"`
		CapabilityID  string         `json:"capabilityId"`
		Sequence      int64          `json:"sequence"`
		EventDigest   string         `json:"eventDigest"`
		Proof         wire.PeerProof `json:"proof"`
	}
	for _, event := range events {
		body := map[string]any{"schemaVersion": 1, "binding": binding, "capabilityId": delivery.Settlement.CapabilityID, "event": event}
		proof := signed("run.event", body)
		body["proof"] = proof
		for range 2 {
			if err := client.postMachine(context.Background(), "/api/peer/runs/events", "PeerRunEventRequest", body, "PeerRunEventReceipt", &eventReceipt, local.Receipt.MachineCredential.Token); err != nil {
				t.Fatal("TLS event", err)
			}
			verify(eventReceipt.Proof, proof, "run.event", map[string]any{"schemaVersion": eventReceipt.SchemaVersion, "bindingDigest": eventReceipt.BindingDigest, "capabilityId": eventReceipt.CapabilityID, "sequence": eventReceipt.Sequence, "eventDigest": eventReceipt.EventDigest})
			if eventReceipt.EventDigest != mustDigest(t, event) {
				t.Fatal("wrong event acknowledged")
			}
		}
	}
	f.control(t, map[string]any{"action": "revoke", "membershipId": membershipID})
	settlement := wire.PeerSettlement{SchemaVersion: 1, CapabilityID: delivery.Settlement.CapabilityID, OperationID: "op_tlssettlement001", BindingDigest: mustDigest(t, binding), Sequence: 1, State: "completed", ReceiptDigest: digest}
	body := map[string]any{"schemaVersion": 1, "settlement": settlement}
	proof := signed("run.settlement", body)
	body["proof"] = proof
	var settled struct {
		SchemaVersion int64               `json:"schemaVersion"`
		Settlement    wire.PeerSettlement `json:"settlement"`
		Proof         wire.PeerProof      `json:"proof"`
	}
	if client.postMachine(context.Background(), "/api/peer/runs/settle", "PeerRunSettlementRequest", body, "PeerRunSettlementReceipt", &settled, local.Receipt.MachineCredential.Token) == nil {
		t.Fatal("revoked business credential became settlement authority")
	}
	for range 2 {
		if err := client.postMachine(context.Background(), "/api/peer/runs/settle", "PeerRunSettlementRequest", body, "PeerRunSettlementReceipt", &settled, delivery.Settlement.Token); err != nil {
			t.Fatal("TLS content-free settlement", err)
		}
		verify(settled.Proof, proof, "run.settlement", map[string]any{"schemaVersion": settled.SchemaVersion, "settlement": settled.Settlement})
		if settled.Settlement != settlement {
			t.Fatal("wrong settlement acknowledged")
		}
	}
	var state struct {
		State                        string
		Events, Replies, Settlements int
	}
	f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &state)
	if state.State != "completed" || state.Events != 4 || state.Replies != 1 || state.Settlements != 1 {
		t.Fatalf("unexpected durable Host result: %+v", state)
	}
}
