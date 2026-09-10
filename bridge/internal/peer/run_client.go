package peer

import (
	"context"
	"encoding/json"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type RunSettlementCapability struct {
	SchemaVersion int64                     `json:"schemaVersion"`
	Audience      string                    `json:"audience"`
	CapabilityID  string                    `json:"capabilityId"`
	Binding       wire.PeerExecutionBinding `json:"binding"`
	Token         string                    `json:"token"`
	IssuedAt      string                    `json:"issuedAt"`
	ExpiresAt     string                    `json:"expiresAt"`
}

// RunDelivery contains private execution context and a settlement secret. It
// belongs only in the owning Peer partition, never Console status or logs.
type RunDelivery struct {
	SchemaVersion int64                   `json:"schemaVersion"`
	Request       json.RawMessage         `json:"request"`
	Settlement    RunSettlementCapability `json:"settlement"`
}

type RunEventReceipt struct {
	SchemaVersion int64          `json:"schemaVersion"`
	BindingDigest string         `json:"bindingDigest"`
	CapabilityID  string         `json:"capabilityId"`
	Sequence      int64          `json:"sequence"`
	EventDigest   string         `json:"eventDigest"`
	Proof         wire.PeerProof `json:"proof"`
}

type RunSettlementReceipt struct {
	SchemaVersion int64               `json:"schemaVersion"`
	Settlement    wire.PeerSettlement `json:"settlement"`
	Proof         wire.PeerProof      `json:"proof"`
}

func (d RunDelivery) ReceiptDigest() (string, error) {
	raw, err := json.Marshal(d)
	if err != nil {
		return "", ErrProof
	}
	return wire.RunDeliveryReceiptDigest(raw)
}

func (c *Client) runPins(local LocalConnection, binding wire.PeerExecutionBinding) bool {
	m := local.Receipt.Membership
	return closed("PeerExecutionBinding", binding) && binding.AuthorityNodeID == c.host.NodeID && binding.ParticipantNodeID == c.signer.Identity().NodeID &&
		binding.PeerID == m.PeerID && binding.TeamID == m.Scope.TeamID && (m.Scope.Kind != "room" || m.Scope.RoomID != nil && *m.Scope.RoomID == binding.RoomID)
}

func (c *Client) runProof(purpose wire.Purpose, subject any) (wire.PeerProof, error) {
	nonce, err := NewNonce()
	if err != nil {
		return wire.PeerProof{}, err
	}
	digest, err := semanticDigest(subject)
	if err != nil {
		return wire.PeerProof{}, err
	}
	return c.signer.Sign(ProofContext{Purpose: purpose, AudienceNodeID: c.host.NodeID, OperationID: "op_" + nonce, Nonce: nonce, SubjectDigest: digest}, c.clock())
}

func (c *Client) verifyRunReceipt(proof, request wire.PeerProof, purpose wire.Purpose, subject any) error {
	digest, err := semanticDigest(subject)
	if err != nil {
		return err
	}
	return VerifyProof(proof, c.host, ProofContext{Purpose: purpose, AudienceNodeID: c.signer.Identity().NodeID,
		OperationID: request.Payload.OperationID, Nonce: request.Payload.Nonce, SubjectDigest: digest}, c.clock())
}

// PollRuns belongs to one live proven connection. The caller must persist the
// returned request/capability and check actual local Export/Acceptance before
// admission or execution. A poll receipt is never permission to start.
func (c *Client) PollRuns(ctx context.Context, connection *RuntimeConnection, known []wire.PeerRunKnown) (*RunDelivery, error) {
	if connection == nil || connection.client != c || connection.ctx.Err() != nil {
		return nil, ErrProof
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(connection.ctx, cancel)
	defer stop()
	defer cancel()
	local, err := c.runtimeMembership(connection.store, connection.membershipID)
	if err != nil {
		return nil, err
	}
	if known == nil {
		known = []wire.PeerRunKnown{}
	} else {
		known = append(make([]wire.PeerRunKnown, 0, len(known)), known...)
	}
	intent := map[string]any{"schemaVersion": 1, "binding": connection.binding, "knownRuns": known}
	if !closed("PeerRunPollIntent", intent) {
		return nil, ErrProof
	}
	proof, err := c.runProof("run.poll", intent)
	if err != nil {
		return nil, err
	}
	if err = c.identity(ctx, proof.Payload.OperationID); err != nil {
		return nil, err
	}
	current, err := c.runtimeMembership(connection.store, connection.membershipID)
	if err != nil || peerAuthorizationDigest(current) != peerAuthorizationDigest(local) {
		return nil, ErrProof
	}
	var receipt struct {
		SchemaVersion int64           `json:"schemaVersion"`
		IntentDigest  string          `json:"intentDigest"`
		Delivery      json.RawMessage `json:"delivery"`
		Proof         wire.PeerProof  `json:"proof"`
	}
	if err = c.postMachine(ctx, "/api/peer/runs/poll", "PeerRunPollRequest", map[string]any{"schemaVersion": 1, "intent": intent, "proof": proof},
		"PeerRunPollReceipt", &receipt, local.Receipt.MachineCredential.Token); err != nil {
		return nil, err
	}
	digest, _ := semanticDigest(intent)
	if receipt.IntentDigest != digest || c.verifyRunReceipt(receipt.Proof, proof, "run.poll", map[string]any{"schemaVersion": receipt.SchemaVersion, "intentDigest": receipt.IntentDigest, "delivery": receipt.Delivery}) != nil {
		return nil, ErrProof
	}
	current, err = c.runtimeMembership(connection.store, connection.membershipID)
	if err != nil || connection.ctx.Err() != nil || peerAuthorizationDigest(current) != peerAuthorizationDigest(local) {
		return nil, ErrProof
	}
	if string(receipt.Delivery) == "null" {
		return nil, nil
	}
	if _, err := wire.RunDeliveryReceiptDigest(receipt.Delivery); err != nil {
		return nil, ErrProof
	}
	var delivery RunDelivery
	if wire.Decode("PeerRunDelivery", receipt.Delivery, &delivery) != nil || !c.runPins(local, delivery.Settlement.Binding) || !after(delivery.Settlement.ExpiresAt, c.clock()) {
		return nil, ErrProof
	}
	issued, err := time.Parse(time.RFC3339Nano, delivery.Settlement.IssuedAt)
	if err != nil || issued.After(c.clock().Add(wire.ProofClockSkewSeconds*time.Second)) {
		return nil, ErrProof
	}
	return &delivery, nil
}

// PublishRunEvent transmits an already durable local event. The coordinator
// supplies current to recheck the actual local configuration and bilateral
// Export after the Host-identity wait. It does not retry or manufacture events.
func (c *Client) PublishRunEvent(ctx context.Context, store *Store, membershipID string, delivery RunDelivery, event json.RawMessage, current func() error) (RunEventReceipt, error) {
	var empty RunEventReceipt
	event = append(json.RawMessage(nil), event...)
	if current == nil || current() != nil {
		return empty, ErrExport
	}
	if _, err := delivery.ReceiptDigest(); err != nil {
		return empty, ErrProof
	}
	var decoded struct {
		Sequence int64 `json:"sequence"`
	}
	if wire.Decode("PeerRunEvent", event, &decoded) != nil {
		return empty, ErrProof
	}
	local, err := c.runtimeMembership(store, membershipID)
	if err != nil || !c.runPins(local, delivery.Settlement.Binding) {
		return empty, ErrProof
	}
	subject := map[string]any{"schemaVersion": 1, "binding": delivery.Settlement.Binding, "capabilityId": delivery.Settlement.CapabilityID, "event": event}
	proof, err := c.runProof("run.event", subject)
	if err != nil {
		return empty, err
	}
	if err = c.identity(ctx, proof.Payload.OperationID); err != nil {
		return empty, err
	}
	latest, err := c.runtimeMembership(store, membershipID)
	if err != nil || peerAuthorizationDigest(latest) != peerAuthorizationDigest(local) || current() != nil {
		return empty, ErrExport
	}
	subject["proof"] = proof
	var receipt RunEventReceipt
	if err = c.postMachine(ctx, "/api/peer/runs/events", "PeerRunEventRequest", subject, "PeerRunEventReceipt", &receipt, local.Receipt.MachineCredential.Token); err != nil {
		return empty, err
	}
	bindingDigest, _ := semanticDigest(delivery.Settlement.Binding)
	eventDigest, _ := wire.Digest(event)
	if receipt.BindingDigest != bindingDigest || receipt.CapabilityID != delivery.Settlement.CapabilityID || receipt.Sequence != decoded.Sequence || receipt.EventDigest != eventDigest ||
		c.verifyRunReceipt(receipt.Proof, proof, "run.event", map[string]any{"schemaVersion": receipt.SchemaVersion, "bindingDigest": receipt.BindingDigest,
			"capabilityId": receipt.CapabilityID, "sequence": receipt.Sequence, "eventDigest": receipt.EventDigest}) != nil {
		return empty, ErrProof
	}
	if _, err = c.runtimeMembership(store, membershipID); err != nil {
		return empty, err
	}
	return receipt, nil
}

// Settlement authenticates the immutable local membership history, including
// left/expired memberships. It never borrows their business credential or
// bypasses the current installation/Host TLS pin.
func (c *Client) settlementHistory(store *Store, membershipID string, binding wire.PeerExecutionBinding) (LocalConnection, error) {
	if err := c.checkLocal(); err != nil {
		return LocalConnection{}, err
	}
	if store == nil {
		return LocalConnection{}, ErrStore
	}
	state, err := store.Read()
	if err != nil {
		return LocalConnection{}, err
	}
	local, found := findConnection(state, membershipID)
	if !found || state.Participant != c.signer.Identity() || state.LocalUserID != c.signer.LocalUserID() ||
		!equalJSON(local.Receipt.Invitation.Host, c.host) || local.Receipt.Invitation.HostOrigin != c.origin || !c.runPins(local, binding) {
		return LocalConnection{}, ErrProof
	}
	return local, nil
}

func (c *Client) SettleRun(ctx context.Context, store *Store, membershipID string, delivery RunDelivery, settlement wire.PeerSettlement) (RunSettlementReceipt, error) {
	var empty RunSettlementReceipt
	receiptDigest, err := delivery.ReceiptDigest()
	if err != nil {
		return empty, ErrProof
	}
	bindingDigest, _ := semanticDigest(delivery.Settlement.Binding)
	if !closed("PeerSettlement", settlement) || settlement.Sequence != 1 || settlement.CapabilityID != delivery.Settlement.CapabilityID ||
		settlement.BindingDigest != bindingDigest || settlement.ReceiptDigest != receiptDigest || !after(delivery.Settlement.ExpiresAt, c.clock()) {
		return empty, ErrProof
	}
	local, err := c.settlementHistory(store, membershipID, delivery.Settlement.Binding)
	if err != nil {
		return empty, err
	}
	subject := map[string]any{"schemaVersion": 1, "settlement": settlement}
	proof, err := c.runProof("run.settlement", subject)
	if err != nil {
		return empty, err
	}
	if err = c.identity(ctx, proof.Payload.OperationID); err != nil {
		return empty, err
	}
	latest, err := c.settlementHistory(store, membershipID, delivery.Settlement.Binding)
	if err != nil || !equalJSON(local.Receipt, latest.Receipt) {
		return empty, ErrProof
	}
	subject["proof"] = proof
	var receipt RunSettlementReceipt
	if err = c.postMachine(ctx, "/api/peer/runs/settle", "PeerRunSettlementRequest", subject, "PeerRunSettlementReceipt", &receipt, delivery.Settlement.Token); err != nil {
		return empty, err
	}
	if receipt.Settlement != settlement || c.verifyRunReceipt(receipt.Proof, proof, "run.settlement", map[string]any{"schemaVersion": receipt.SchemaVersion, "settlement": receipt.Settlement}) != nil {
		return empty, ErrProof
	}
	latest, err = c.settlementHistory(store, membershipID, delivery.Settlement.Binding)
	if err != nil || !equalJSON(local.Receipt, latest.Receipt) {
		return empty, ErrProof
	}
	return receipt, nil
}
