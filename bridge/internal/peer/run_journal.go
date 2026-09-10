package peer

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
	"unicode/utf8"

	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

const maximumRunRequestBytes = 512 * 1024
const maximumRunReplyBytes = 256 * 1024

var peerRunID = regexp.MustCompile(`^run_[A-Za-z0-9_-]{8,128}$`)

// RunRecord is local evidence, not an execution or content-publication grant.
// Starting without an outcome means execution may have happened. It never
// permits replay, including after process fencing, revocation or expiry.
type RunRecord struct {
	Request    json.RawMessage
	Binding    wire.PeerExecutionBinding
	ReceivedAt string
	StartedAt  string
	Outcome    *RunOutcome
	Settlement *RunSettlementCapability
}

type RunOutcome struct {
	State string `json:"state"`
	Reply string `json:"reply,omitempty"`
	// Terminal is the exact deferred status event, retained after process
	// cleanup and before publication so a crash cannot lose clarification.
	Terminal json.RawMessage `json:"terminal,omitempty"`
}

type receivedRun struct {
	SchemaVersion int                      `json:"schemaVersion"`
	Namespace     string                   `json:"namespace"`
	ReceivedAt    string                   `json:"receivedAt"`
	Request       json.RawMessage          `json:"request"`
	Settlement    *RunSettlementCapability `json:"settlement,omitempty"`
}

type startedRun struct {
	SchemaVersion int    `json:"schemaVersion"`
	Namespace     string `json:"namespace"`
	RequestDigest string `json:"requestDigest"`
	StartedAt     string `json:"startedAt"`
}

type finishedRun struct {
	SchemaVersion int        `json:"schemaVersion"`
	Namespace     string     `json:"namespace"`
	RequestDigest string     `json:"requestDigest"`
	RecordedAt    string     `json:"recordedAt"`
	Outcome       RunOutcome `json:"outcome"`
}

// RunJournal uses separately durable immutable receive/start/outcome records.
// No replacement of a request, deletion, grant revision or connection epoch
// creates another deduplication namespace for an existing qualified Peer Run.
type RunJournal struct {
	mu                *sync.Mutex
	partition         *RuntimePartition
	directory         string
	opened            bool
	observed          map[string]RunRecord
	transportObserved map[string]runTransportState
}

func (p *RuntimePartition) Runs() *RunJournal {
	p.journalMu.Lock()
	defer p.journalMu.Unlock()
	if p.journal == nil {
		directory := filepath.Join(p.directory, "runs")
		lock, _ := storeLocks.LoadOrStore(directory, &sync.Mutex{})
		p.journal = &RunJournal{mu: lock.(*sync.Mutex), partition: p, directory: directory, observed: map[string]RunRecord{}}
	}
	return p.journal
}

func (j *RunJournal) check(create bool) error {
	if err := j.partition.Check(); err != nil {
		return err
	}
	path := filepath.Join(j.directory, "owner.json")
	if _, err := os.Lstat(j.directory); os.IsNotExist(err) && !j.opened && create {
		raw, _ := json.Marshal(j.partition.receipt)
		if err := writePrivateState(j.directory, "owner.json", raw); err != nil {
			return err
		}
	} else if err != nil {
		if j.opened {
			return ErrStore
		}
		return err
	}
	if privatefs.EnsureDirectory(j.directory) != nil {
		return ErrStore
	}
	raw, err := privatefs.ReadFile(path, 8192)
	digest, digestErr := wire.Digest(raw)
	if err != nil || digestErr != nil || digest != j.partition.namespace {
		return ErrStore
	}
	j.opened = true
	return nil
}

func decodeLocalRun(raw []byte, target any) error {
	_, err := wire.CanonicalJSON(raw)
	if err != nil {
		return ErrStore
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(target) != nil {
		return ErrStore
	}
	return nil
}

func readOptionalRun(path string, maximum int64) ([]byte, error) {
	if _, err := os.Lstat(path); err != nil {
		return nil, err
	}
	// Once present, losing/replacing the file is corruption, not an absent
	// lifecycle stage. privatefs checks the actual opened inode and ownership.
	raw, err := privatefs.ReadFile(path, maximum)
	if err != nil {
		return nil, ErrStore
	}
	return raw, nil
}

func runTime(value string) (time.Time, bool) {
	at, err := time.Parse(time.RFC3339Nano, value)
	return at, err == nil && value == at.UTC().Format("2006-01-02T15:04:05.000Z")
}

func (j *RunJournal) request(raw []byte) (wire.PeerExecutionBinding, error) {
	var request struct {
		Binding wire.PeerExecutionBinding `json:"binding"`
	}
	if len(raw) > maximumRunRequestBytes || wire.VerifyRunRequest(raw) != nil || wire.Decode("PeerRunRequest", raw, &request) != nil {
		return wire.PeerExecutionBinding{}, ErrStore
	}
	b, p := request.Binding, j.partition.receipt
	if b.AuthorityNodeID != p.Host.NodeID || b.ParticipantNodeID != p.Participant.NodeID || b.PeerID != p.PeerID || b.TeamID != p.TeamID {
		return wire.PeerExecutionBinding{}, ErrConflict
	}
	return b, nil
}

// A fresh admission is checked only when receiving a new request or claiming
// its start. Historical reads and exact retries do not restore execution rights.
func (j *RunJournal) current(record RunRecord, admission ExecutionAdmission, now time.Time) error {
	p := j.partition.receipt
	proof := admission.Proof.Payload
	if VerifyExecutionAdmission(admission, record.Binding, p.Host, p.Participant, proof.OperationID, proof.Nonce, now) != nil {
		return ErrExport
	}
	state, err := j.partition.owner.store.Read()
	local, found := findConnection(state, p.MembershipID)
	if err != nil || !found || local.State != "active" || !after(local.Receipt.Membership.ExpiresAt, now) ||
		!after(local.Receipt.MachineCredential.ExpiresAt, now) ||
		local.Receipt.Membership.Scope.Kind == "room" && (local.Receipt.Membership.Scope.RoomID == nil || *local.Receipt.Membership.Scope.RoomID != record.Binding.RoomID) {
		return ErrExport
	}
	var request struct {
		Payload struct {
			Deadline string `json:"deadline"`
		} `json:"payload"`
	}
	if json.Unmarshal(record.Request, &request) != nil || !after(request.Payload.Deadline, now) {
		return ErrExport
	}
	return nil
}

func (j *RunJournal) Receive(raw []byte, admission ExecutionAdmission, now time.Time) (RunRecord, error) {
	return j.receive(raw, nil, &admission, now)
}

// ReceiveDelivery retains a delivery already authenticated by Client.PollRuns.
// Receipt retention survives an intervening withdrawal, so denied work can be
// settled. It grants no start rights: Begin still requires fresh admission.
func (j *RunJournal) ReceiveDelivery(delivery RunDelivery, now time.Time) (RunRecord, error) {
	if _, err := delivery.ReceiptDigest(); err != nil {
		return RunRecord{}, ErrProof
	}
	return j.receive(delivery.Request, &delivery.Settlement, nil, now)
}

func (r RunRecord) Delivery() (RunDelivery, error) {
	if r.Settlement == nil {
		return RunDelivery{}, ErrStore
	}
	return RunDelivery{SchemaVersion: 1, Request: append(json.RawMessage(nil), r.Request...), Settlement: *r.Settlement}, nil
}

func (j *RunJournal) receive(raw []byte, settlement *RunSettlementCapability, admission *ExecutionAdmission, now time.Time) (RunRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	binding, err := j.request(raw)
	if err != nil {
		return RunRecord{}, err
	}
	if err := j.check(true); err != nil {
		return RunRecord{}, err
	}
	if prior, err := j.load(binding.RunID); err == nil {
		if !equalJSON(prior.Binding, binding) || !equalJSON(prior.Request, json.RawMessage(raw)) || settlement != nil && !equalJSON(prior.Settlement, settlement) {
			return RunRecord{}, ErrConflict
		}
		return prior, nil
	} else if !os.IsNotExist(err) {
		return RunRecord{}, err
	}
	record := RunRecord{Request: append(json.RawMessage(nil), raw...), Binding: binding, ReceivedAt: now.UTC().Format("2006-01-02T15:04:05.000Z"), Settlement: settlement}
	if settlement != nil {
		issued, err := time.Parse(time.RFC3339Nano, settlement.IssuedAt)
		if err != nil || issued.After(now.Add(wire.ProofClockSkewSeconds*time.Second)) || !after(settlement.ExpiresAt, now) {
			return RunRecord{}, ErrProof
		}
	}
	if admission != nil {
		if err := j.current(record, *admission, now); err != nil {
			return RunRecord{}, err
		}
	}
	value := receivedRun{1, j.partition.namespace, record.ReceivedAt, record.Request, settlement}
	bytes, err := json.Marshal(value)
	if err != nil {
		return RunRecord{}, err
	}
	if err := writePrivateState(filepath.Join(j.directory, binding.RunID), "received.json", bytes); err != nil {
		return RunRecord{}, err
	}
	return j.load(binding.RunID)
}

func (j *RunJournal) Load(runID string) (RunRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err := j.check(false); err != nil {
		return RunRecord{}, err
	}
	return j.load(runID)
}

// List supplies reconciliation evidence, including revoked and expired Runs.
// It does not turn a retained starting record back into queued work.
func (j *RunJournal) List() ([]RunRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err := j.check(false); err != nil {
		if os.IsNotExist(err) {
			return []RunRecord{}, nil
		}
		return nil, err
	}
	entries, err := os.ReadDir(j.directory)
	if err != nil {
		return nil, err
	}
	result := []RunRecord{}
	seen := map[string]bool{}
	for _, entry := range entries {
		if !peerRunID.MatchString(entry.Name()) {
			continue
		}
		record, err := j.load(entry.Name())
		if err != nil {
			return nil, err
		}
		seen[entry.Name()] = true
		result = append(result, record)
	}
	for id := range j.observed {
		if !seen[id] {
			return nil, ErrStore
		}
	}
	return result, nil
}

func (j *RunJournal) load(runID string) (RunRecord, error) {
	if !peerRunID.MatchString(runID) {
		return RunRecord{}, ErrStore
	}
	directory := filepath.Join(j.directory, runID)
	if _, err := os.Lstat(directory); err != nil {
		if _, seen := j.observed[runID]; seen {
			return RunRecord{}, ErrStore
		}
		return RunRecord{}, err
	}
	if privatefs.EnsureDirectory(directory) != nil {
		return RunRecord{}, ErrStore
	}
	raw, err := privatefs.ReadFile(filepath.Join(directory, "received.json"), wire.MaximumJSONBytes)
	var received receivedRun
	if err != nil || decodeLocalRun(raw, &received) != nil || received.SchemaVersion != 1 || received.Namespace != j.partition.namespace {
		return RunRecord{}, ErrStore
	}
	b, err := j.request(received.Request)
	receivedAt, valid := runTime(received.ReceivedAt)
	if err != nil || !valid || b.RunID != runID {
		return RunRecord{}, ErrStore
	}
	record := RunRecord{Request: received.Request, Binding: b, ReceivedAt: received.ReceivedAt, Settlement: received.Settlement}
	if record.Settlement != nil {
		delivery, _ := record.Delivery()
		issued, err := time.Parse(time.RFC3339Nano, delivery.Settlement.IssuedAt)
		if _, digestErr := delivery.ReceiptDigest(); digestErr != nil || err != nil || issued.After(receivedAt.Add(wire.ProofClockSkewSeconds*time.Second)) || !after(delivery.Settlement.ExpiresAt, receivedAt) {
			return RunRecord{}, ErrStore
		}
	}
	raw, err = readOptionalRun(filepath.Join(directory, "started.json"), 8192)
	if err == nil {
		var started startedRun
		if decodeLocalRun(raw, &started) != nil {
			return RunRecord{}, ErrStore
		}
		at, valid := runTime(started.StartedAt)
		if started.SchemaVersion != 1 || started.Namespace != received.Namespace || started.RequestDigest != b.RequestDigest || !valid || at.Before(receivedAt) {
			return RunRecord{}, ErrStore
		}
		record.StartedAt = started.StartedAt
	} else if !os.IsNotExist(err) {
		return RunRecord{}, ErrStore
	}
	raw, err = readOptionalRun(filepath.Join(directory, "outcome.json"), wire.MaximumJSONBytes)
	if err == nil {
		var finished finishedRun
		if decodeLocalRun(raw, &finished) != nil {
			return RunRecord{}, ErrStore
		}
		at, valid := runTime(finished.RecordedAt)
		if finished.SchemaVersion != 1 || finished.Namespace != received.Namespace || finished.RequestDigest != b.RequestDigest ||
			!valid || at.Before(receivedAt) || record.StartedAt != "" && finished.RecordedAt < record.StartedAt || !validRunOutcome(finished.Outcome, record.StartedAt != "") {
			return RunRecord{}, ErrStore
		}
		record.Outcome = &finished.Outcome
	} else if !os.IsNotExist(err) {
		return RunRecord{}, ErrStore
	}
	if prior, seen := j.observed[runID]; seen && (!equalJSON(prior.Request, record.Request) || prior.ReceivedAt != record.ReceivedAt ||
		!equalJSON(prior.Settlement, record.Settlement) || prior.StartedAt != "" && prior.StartedAt != record.StartedAt || prior.Outcome != nil && !equalJSON(prior.Outcome, record.Outcome)) {
		return RunRecord{}, ErrStore
	}
	// Returned callers may mutate their copy; the observer must remain independent.
	copy := record
	copy.Request = append(json.RawMessage(nil), record.Request...)
	if record.Settlement != nil {
		settlement := *record.Settlement
		copy.Settlement = &settlement
	}
	if record.Outcome != nil {
		outcome := *record.Outcome
		outcome.Terminal = append(json.RawMessage(nil), outcome.Terminal...)
		copy.Outcome = &outcome
	}
	j.observed[runID] = copy
	return record, nil
}

// Begin is a one-time durable claim immediately before the adapter is invoked,
// after queue waits and fresh bilateral admission. Even an identical second
// caller gets a conflict; a crashed claimant is reconciled as possibly started.
func (j *RunJournal) Begin(runID string, admission ExecutionAdmission, now time.Time) (RunRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err := j.check(false); err != nil {
		return RunRecord{}, err
	}
	record, err := j.load(runID)
	if err != nil {
		return RunRecord{}, err
	}
	if record.StartedAt != "" || record.Outcome != nil {
		return RunRecord{}, ErrConflict
	}
	if err := j.current(record, admission, now); err != nil {
		return RunRecord{}, err
	}
	at := now.UTC().Format("2006-01-02T15:04:05.000Z")
	if at < record.ReceivedAt {
		return RunRecord{}, ErrStore
	}
	raw, _ := json.Marshal(startedRun{1, j.partition.namespace, record.Binding.RequestDigest, at})
	if err := writePrivateState(filepath.Join(j.directory, runID), "started.json", raw); err != nil {
		return RunRecord{}, err
	}
	return j.load(runID)
}

func validRunOutcome(outcome RunOutcome, started bool) bool {
	if !utf8.ValidString(outcome.Reply) || len(outcome.Reply) > maximumRunReplyBytes || outcome.State != "completed" && outcome.Reply != "" {
		return false
	}
	if len(outcome.Terminal) != 0 {
		var event struct {
			Status        string          `json:"status"`
			Clarification json.RawMessage `json:"clarification"`
		}
		if wire.Decode("PeerRunStatusEvent", outcome.Terminal, &event) != nil || event.Status != outcome.State ||
			outcome.State == "input_required" && len(event.Clarification) == 0 {
			return false
		}
	}
	switch outcome.State {
	case "completed", "failed", "outcome_unknown":
		return started
	case "canceled", "expired":
		return true
	case "delivery_denied":
		return !started
	case "input_required":
		return started && len(outcome.Terminal) != 0
	default:
		return false
	}
}

// Finish retains local truth even after business revocation. Its caller must
// establish process termination before asserting known completion/cancellation.
// This method never transmits Reply; remote content needs current authorization.
func (j *RunJournal) Finish(runID string, outcome RunOutcome, now time.Time) (RunRecord, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if err := j.check(false); err != nil {
		return RunRecord{}, err
	}
	record, err := j.load(runID)
	if err != nil {
		return RunRecord{}, err
	}
	if record.Outcome != nil {
		if equalJSON(*record.Outcome, outcome) {
			return record, nil
		}
		return RunRecord{}, ErrConflict
	}
	at := now.UTC().Format("2006-01-02T15:04:05.000Z")
	if !validRunOutcome(outcome, record.StartedAt != "") || at < record.ReceivedAt || record.StartedAt != "" && at < record.StartedAt {
		return RunRecord{}, ErrStore
	}
	raw, _ := json.Marshal(finishedRun{1, j.partition.namespace, record.Binding.RequestDigest, at, outcome})
	if err := writePrivateState(filepath.Join(j.directory, runID), "outcome.json", raw); err != nil {
		return RunRecord{}, err
	}
	return j.load(runID)
}
