package peer

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

const maximumRunEvents = 4096
const runReceiptReserve = 8192

// RunTransportRecord is private replay evidence. An acknowledgment records a
// past Host commit; neither it nor a retained event authorizes new publication.
type RunTransportRecord struct {
	Events            []json.RawMessage     `json:"events"`
	Acknowledgment    *RunEventReceipt      `json:"acknowledgment,omitempty"`
	Settlement        *wire.PeerSettlement  `json:"settlement,omitempty"`
	SettlementReceipt *RunSettlementReceipt `json:"settlementReceipt,omitempty"`
}

type runTransportState struct {
	SchemaVersion int    `json:"schemaVersion"`
	Namespace     string `json:"namespace"`
	RequestDigest string `json:"requestDigest"`
	RunTransportRecord
}

func (r RunTransportRecord) Acknowledged() int64 {
	if r.Acknowledgment == nil {
		return 0
	}
	return r.Acknowledgment.Sequence
}

func cloneRunTransport(value runTransportState) runTransportState {
	raw, _ := json.Marshal(value)
	var copy runTransportState
	_ = json.Unmarshal(raw, &copy)
	return copy
}

func (j *RunJournal) Transport(runID string) (RunTransportRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	_, state, err := j.transport(runID)
	return state.RunTransportRecord, err
}

func (j *RunJournal) transport(runID string) (RunRecord, runTransportState, error) {
	var empty runTransportState
	if err := j.check(false); err != nil {
		return RunRecord{}, empty, err
	}
	record, err := j.load(runID)
	if err != nil || record.Settlement == nil {
		return RunRecord{}, empty, ErrStore
	}
	raw, err := readOptionalRun(filepath.Join(j.directory, runID, "transport.json"), wire.MaximumJSONBytes)
	if os.IsNotExist(err) {
		if _, seen := j.transportObserved[runID]; seen {
			return RunRecord{}, empty, ErrStore
		}
		return record, runTransportState{1, j.partition.namespace, record.Binding.RequestDigest, RunTransportRecord{Events: []json.RawMessage{}}}, nil
	}
	var state runTransportState
	if err != nil || decodeLocalRun(raw, &state) != nil || j.validateTransport(record, state) != nil {
		return RunRecord{}, empty, ErrStore
	}
	if previous, seen := j.transportObserved[runID]; seen && !transportExtends(previous, state) {
		return RunRecord{}, empty, ErrStore
	}
	j.observeTransport(runID, state)
	return record, state, nil
}

func transportExtends(previous, next runTransportState) bool {
	if len(next.Events) < len(previous.Events) || next.Acknowledged() < previous.Acknowledged() ||
		previous.Settlement != nil && !equalJSON(previous.Settlement, next.Settlement) ||
		previous.SettlementReceipt != nil && !equalJSON(previous.SettlementReceipt, next.SettlementReceipt) {
		return false
	}
	for index, event := range previous.Events {
		if !equalJSON(event, next.Events[index]) {
			return false
		}
	}
	return true
}

func (j *RunJournal) observeTransport(runID string, state runTransportState) {
	if j.transportObserved == nil {
		j.transportObserved = map[string]runTransportState{}
	}
	j.transportObserved[runID] = cloneRunTransport(state)
}

func eventSequence(raw json.RawMessage) (int64, error) {
	var event struct {
		Sequence int64 `json:"sequence"`
	}
	if wire.Decode("PeerRunEvent", raw, &event) != nil {
		return 0, ErrStore
	}
	return event.Sequence, nil
}

// Retained proofs are validated at their signed issue time for historical
// integrity. Their expiry is never refreshed or reused as execution admission.
func (j *RunJournal) historicalRunProof(proof wire.PeerProof, purpose wire.Purpose, subject any) error {
	at, err := time.Parse(time.RFC3339Nano, proof.Payload.IssuedAt)
	digest, digestErr := semanticDigest(subject)
	if err != nil || digestErr != nil {
		return ErrProof
	}
	p := j.partition.receipt
	return VerifyProof(proof, p.Host, ProofContext{Purpose: purpose, AudienceNodeID: p.Participant.NodeID,
		OperationID: proof.Payload.OperationID, Nonce: proof.Payload.Nonce, SubjectDigest: digest}, at)
}

func (j *RunJournal) validateTransport(record RunRecord, state runTransportState) error {
	if state.SchemaVersion != 1 || state.Namespace != j.partition.namespace || state.RequestDigest != record.Binding.RequestDigest ||
		state.Events == nil || len(state.Events) > maximumRunEvents {
		return ErrStore
	}
	for index, event := range state.Events {
		if sequence, err := eventSequence(event); err != nil || sequence != int64(index+1) {
			return ErrStore
		}
	}
	if receipt := state.Acknowledgment; receipt != nil {
		if !closed("PeerRunEventReceipt", receipt) || receipt.Sequence < 1 || receipt.Sequence > int64(len(state.Events)) {
			return ErrStore
		}
		digest, _ := semanticDigest(record.Binding)
		eventDigest, _ := wire.Digest(state.Events[receipt.Sequence-1])
		if receipt.BindingDigest != digest || receipt.CapabilityID != record.Settlement.CapabilityID || receipt.EventDigest != eventDigest ||
			j.historicalRunProof(receipt.Proof, "run.event", map[string]any{"schemaVersion": receipt.SchemaVersion,
				"bindingDigest": receipt.BindingDigest, "capabilityId": receipt.CapabilityID, "sequence": receipt.Sequence, "eventDigest": receipt.EventDigest}) != nil {
			return ErrStore
		}
	}
	if settlement := state.Settlement; settlement != nil {
		delivery, _ := record.Delivery()
		receiptDigest, err := delivery.ReceiptDigest()
		bindingDigest, _ := semanticDigest(record.Binding)
		if err != nil || !closed("PeerSettlement", settlement) || settlement.Sequence != 1 || record.Outcome == nil ||
			string(settlement.State) != record.Outcome.State || settlement.BindingDigest != bindingDigest ||
			settlement.CapabilityID != record.Settlement.CapabilityID || settlement.ReceiptDigest != receiptDigest {
			return ErrStore
		}
	}
	if receipt := state.SettlementReceipt; receipt != nil {
		if state.Settlement == nil || !closed("PeerRunSettlementReceipt", receipt) || receipt.Settlement != *state.Settlement ||
			j.historicalRunProof(receipt.Proof, "run.settlement", map[string]any{"schemaVersion": receipt.SchemaVersion, "settlement": receipt.Settlement}) != nil {
			return ErrStore
		}
	}
	return nil
}

func (j *RunJournal) saveTransport(record RunRecord, state runTransportState) error {
	if j.validateTransport(record, state) != nil {
		return ErrStore
	}
	raw, err := json.Marshal(state)
	if err != nil || len(raw) > wire.MaximumJSONBytes {
		return ErrStore
	}
	if err := writePrivateState(filepath.Join(j.directory, record.Binding.RunID), "transport.json", raw); err != nil {
		return err
	}
	j.observeTransport(record.Binding.RunID, state)
	return nil
}

// AppendEvent durably freezes a sequence before any HTTP request. Exact retries
// return the retained event; collisions and gaps fail without altering it.
func (j *RunJournal) AppendEvent(runID string, event json.RawMessage) (RunTransportRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	record, state, err := j.transport(runID)
	if err != nil {
		return RunTransportRecord{}, err
	}
	sequence, err := eventSequence(event)
	if err != nil || sequence < 1 || sequence > int64(len(state.Events)+1) {
		return RunTransportRecord{}, ErrConflict
	}
	if sequence <= int64(len(state.Events)) {
		if !equalJSON(state.Events[sequence-1], event) {
			return RunTransportRecord{}, ErrConflict
		}
		return state.RunTransportRecord, nil
	}
	if state.Settlement != nil {
		return RunTransportRecord{}, ErrConflict
	}
	state.Events = append(state.Events, append(json.RawMessage(nil), event...))
	raw, err := json.Marshal(state)
	if err != nil || len(raw) > wire.MaximumJSONBytes-runReceiptReserve {
		return RunTransportRecord{}, ErrStore
	}
	if err := j.saveTransport(record, state); err != nil {
		return RunTransportRecord{}, err
	}
	return state.RunTransportRecord, nil
}

func (j *RunJournal) AcknowledgeEvent(runID string, receipt RunEventReceipt) (RunTransportRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	record, state, err := j.transport(runID)
	if err != nil {
		return RunTransportRecord{}, err
	}
	previous := state.Acknowledgment
	state.Acknowledgment = &receipt
	if j.validateTransport(record, state) != nil || receipt.Sequence > int64(1)+acknowledged(previous) {
		return RunTransportRecord{}, ErrProof
	}
	if receipt.Sequence <= acknowledged(previous) {
		state.Acknowledgment = previous
		return state.RunTransportRecord, nil
	}
	if err := j.saveTransport(record, state); err != nil {
		return RunTransportRecord{}, err
	}
	return state.RunTransportRecord, nil
}

func acknowledged(receipt *RunEventReceipt) int64 {
	if receipt == nil {
		return 0
	}
	return receipt.Sequence
}

// PrepareSettlement derives one immutable, content-free operation from retained
// local outcome evidence. It may be prepared after revocation or expiry, but the
// client and Host still enforce the delivery's original transmission deadline.
func (j *RunJournal) PrepareSettlement(runID string) (wire.PeerSettlement, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	record, state, err := j.transport(runID)
	if err != nil || record.Outcome == nil {
		return wire.PeerSettlement{}, ErrStore
	}
	if state.Settlement != nil {
		return *state.Settlement, nil
	}
	nonce, err := NewNonce()
	if err != nil {
		return wire.PeerSettlement{}, err
	}
	delivery, _ := record.Delivery()
	receiptDigest, _ := delivery.ReceiptDigest()
	bindingDigest, _ := semanticDigest(record.Binding)
	settlement := wire.PeerSettlement{SchemaVersion: 1, CapabilityID: record.Settlement.CapabilityID, BindingDigest: bindingDigest,
		ReceiptDigest: receiptDigest, OperationID: "op_" + nonce, Sequence: 1, State: wire.PeerSettlementState(record.Outcome.State)}
	state.Settlement = &settlement
	if err := j.saveTransport(record, state); err != nil {
		return wire.PeerSettlement{}, err
	}
	return settlement, nil
}

func (j *RunJournal) AcknowledgeSettlement(runID string, receipt RunSettlementReceipt) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	record, state, err := j.transport(runID)
	if err != nil {
		return err
	}
	previous := state.SettlementReceipt
	state.SettlementReceipt = &receipt
	if j.validateTransport(record, state) != nil {
		return ErrProof
	}
	if previous != nil {
		return nil
	}
	return j.saveTransport(record, state)
}
