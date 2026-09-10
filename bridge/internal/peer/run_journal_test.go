package peer

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

type journalFixture struct {
	journal *RunJournal
	store   *Store
	root    string
	now     time.Time
	raw     []byte
	binding wire.PeerExecutionBinding
	host    *Signer
}

func runJournalFixture(t *testing.T) journalFixture {
	t.Helper()
	store, root, state, now := partitionState(t)
	partitions, err := NewRuntimePartitions(root, store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	partition, err := partitions.Open(state.Connections[0].Receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../packages/contracts/test/fixtures/peer-run.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Request struct {
			Binding wire.PeerExecutionBinding
			Payload json.RawMessage
		}
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("fixture")
	}
	b := fixture.Request.Binding
	b.AuthorityNodeID, b.ParticipantNodeID, b.PeerID, b.TeamID = partition.receipt.Host.NodeID, partition.receipt.Participant.NodeID, partition.receipt.PeerID, partition.receipt.TeamID
	b.RequestDigest, err = wire.RunRequestDigest(b, fixture.Request.Payload)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(map[string]any{"schemaVersion": 1, "binding": b, "payload": fixture.Request.Payload})
	if err != nil || wire.VerifyRunRequest(raw) != nil {
		t.Fatal("request", err)
	}
	host := &Signer{identity: partition.receipt.Host, key: ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))}
	return journalFixture{partition.Runs(), store, root, now, raw, b, host}
}

func (f journalFixture) admission(t *testing.T, now time.Time) ExecutionAdmission {
	t.Helper()
	nonce, _ := NewNonce()
	proof, err := f.host.Sign(ProofContext{Purpose: "run.admission", AudienceNodeID: f.binding.ParticipantNodeID,
		OperationID: "op_" + nonce, Nonce: nonce, SubjectDigest: mustDigest(t, f.binding)}, now)
	if err != nil {
		t.Fatal(err)
	}
	return ExecutionAdmission{SchemaVersion: 1, Binding: f.binding, Proof: proof}
}

func (f journalFixture) receive(t *testing.T) RunRecord {
	t.Helper()
	record, err := f.journal.Receive(f.raw, f.admission(t, f.now), f.now)
	if err != nil {
		t.Fatal("receive", err)
	}
	return record
}

func TestPeerRunJournalFreezesSemanticRequestAndRejectsChangedPins(t *testing.T) {
	f := runJournalFixture(t)
	first := f.receive(t)
	// Object order, whitespace and exact counter spelling cannot make a new Run.
	var pretty bytes.Buffer
	if json.Indent(&pretty, f.raw, "", "  ") != nil {
		t.Fatal("indent")
	}
	reordered := bytes.Replace(pretty.Bytes(), []byte(`"grantRevision": 1`), []byte(`"grantRevision": 1.0`), 1)
	retry, err := f.journal.Receive(reordered, ExecutionAdmission{}, f.now.Add(24*time.Hour))
	if err != nil || retry.ReceivedAt != first.ReceivedAt {
		t.Fatal("historical exact retry", err)
	}
	for _, change := range []string{"payload", "grant", "acceptance", "participant", "peer"} {
		t.Run(change, func(t *testing.T) {
			var request struct {
				SchemaVersion int                       `json:"schemaVersion"`
				Binding       wire.PeerExecutionBinding `json:"binding"`
				Payload       map[string]any            `json:"payload"`
			}
			if json.Unmarshal(f.raw, &request) != nil {
				t.Fatal("decode")
			}
			switch change {
			case "payload":
				request.Payload["instruction"] = "changed"
			case "grant":
				request.Binding.GrantRevision++
			case "acceptance":
				request.Binding.AcceptanceRevision++
			case "participant":
				request.Binding.ParticipantNodeID = "node_anotherparticipant"
			case "peer":
				request.Binding.PeerID = "peer_anotherlineage"
			}
			payload, _ := json.Marshal(request.Payload)
			request.Binding.RequestDigest, _ = wire.RunRequestDigest(request.Binding, payload)
			raw, _ := json.Marshal(request)
			if _, err := f.journal.Receive(raw, f.admission(t, f.now), f.now); !errors.Is(err, ErrConflict) {
				t.Fatal("changed execution accepted", err)
			}
		})
	}
	for _, invalid := range [][]byte{
		bytes.Replace(f.raw, []byte(`"schemaVersion":1`), []byte(`"schemaVersion":1,"deviceId":"device_foreign001"`), 1),
		bytes.Replace(f.raw, []byte(`"grantRevision":1`), []byte(`"grantRevision":1.00000000000000001`), 1),
		bytes.Replace(f.raw, []byte(`"grantRevision":1`), []byte(`"grantRevision":1,"grantRevision":1`), 1),
	} {
		if _, err := f.journal.Receive(invalid, f.admission(t, f.now), f.now); err == nil {
			t.Fatal("ambiguous/inherited request accepted")
		}
	}
	first.Request[0] = '['
	if retained, err := f.journal.Load(f.binding.RunID); err != nil || wire.VerifyRunRequest(retained.Request) != nil {
		t.Fatal("caller mutated durable request", err)
	}
	if _, err := f.journal.Load("../received"); err == nil {
		t.Fatal("path traversal")
	}
}

func TestPeerRunJournalClaimsOnceWithFreshnessAndRetainsTruthAfterLeave(t *testing.T) {
	f := runJournalFixture(t)
	admission := f.admission(t, f.now)
	f.receive(t)
	later := f.now.Add(time.Minute)
	if _, err := f.journal.Begin(f.binding.RunID, admission, later); err == nil {
		t.Fatal("stale admission started")
	}
	admission = f.admission(t, later)
	var winners atomic.Int32
	var wg sync.WaitGroup
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := f.journal.Begin(f.binding.RunID, admission, later); err == nil {
				winners.Add(1)
			} else if !errors.Is(err, ErrConflict) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if winners.Load() != 1 {
		t.Fatal("start claims", winners.Load())
	}
	// Simulate a new process after the durable start, with no local outcome.
	partitions, err := NewRuntimePartitions(f.root, f.store, func() error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	partition, err := partitions.Open(f.journal.partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	reopened := partition.Runs()
	records, err := reopened.List()
	if err != nil || len(records) != 1 || records[0].StartedAt == "" || records[0].Outcome != nil {
		t.Fatal("lost possible-start evidence", err)
	}
	if _, err := reopened.Begin(f.binding.RunID, admission, later); !errors.Is(err, ErrConflict) {
		t.Fatal("restarted an ambiguous execution", err)
	}
	state, err := f.store.Read()
	if err != nil {
		t.Fatal(err)
	}
	state.Connections[0].State = "left"
	state.Revision++
	if err := f.store.Update(state.Revision-1, state, later); err != nil {
		t.Fatal(err)
	}
	// Known completion is retained independently of business authority. This
	// does not publish its private local content or assert a remote receipt.
	outcome := RunOutcome{State: "completed", Reply: "已在本机完成 😀"}
	record, err := reopened.Finish(f.binding.RunID, outcome, later.Add(24*time.Hour))
	if err != nil || record.Outcome == nil || record.Outcome.Reply != outcome.Reply {
		t.Fatal("revocation erased truth", err)
	}
	record.Outcome.Reply = "caller mutation"
	if _, err := reopened.Finish(f.binding.RunID, outcome, later.Add(48*time.Hour)); err != nil {
		t.Fatal("exact outcome retry", err)
	}
	if _, err := reopened.Finish(f.binding.RunID, RunOutcome{State: "failed"}, later); !errors.Is(err, ErrConflict) {
		t.Fatal("terminal rewritten", err)
	}
	if _, err := reopened.Begin(f.binding.RunID, f.admission(t, later), later); !errors.Is(err, ErrConflict) {
		t.Fatal("completed Run restarted", err)
	}
}

func TestPeerRunJournalRejectsCorruptionMissingEvidenceAndForeignPartitions(t *testing.T) {
	for _, damage := range []string{"owner", "request", "start", "outcome", "directory", "symlink", "fractional", "unknown"} {
		t.Run(damage, func(t *testing.T) {
			f := runJournalFixture(t)
			f.receive(t)
			if _, err := f.journal.Begin(f.binding.RunID, f.admission(t, f.now), f.now); err != nil {
				t.Fatal(err)
			}
			if _, err := f.journal.Finish(f.binding.RunID, RunOutcome{State: "completed", Reply: "local truth"}, f.now); err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(f.journal.directory, f.binding.RunID)
			var err error
			switch damage {
			case "owner":
				err = os.Remove(filepath.Join(f.journal.directory, "owner.json"))
			case "request":
				err = os.Remove(filepath.Join(directory, "received.json"))
			case "start":
				err = os.Remove(filepath.Join(directory, "started.json"))
			case "outcome":
				err = os.Remove(filepath.Join(directory, "outcome.json"))
			case "directory":
				err = os.RemoveAll(directory)
			case "symlink":
				err = os.Rename(directory, directory+"-moved")
				if err == nil {
					err = os.Symlink(directory+"-moved", directory)
				}
			case "fractional", "unknown":
				path := filepath.Join(directory, "received.json")
				raw, readErr := os.ReadFile(path)
				if readErr != nil {
					t.Fatal(readErr)
				}
				if damage == "fractional" {
					raw = bytes.Replace(raw, []byte(`"grantRevision":1`), []byte(`"grantRevision":1.00000000000000001`), 1)
				} else {
					raw = bytes.Replace(raw, []byte(`"schemaVersion":1`), []byte(`"schemaVersion":1,"ignored":true`), 1)
				}
				err = os.WriteFile(path, raw, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.journal.Receive(f.raw, f.admission(t, f.now), f.now); err == nil {
				t.Fatal("damaged journal was adopted")
			}
			if _, err := f.journal.List(); err == nil {
				t.Fatal("damage hidden by reconciliation")
			}
		})
	}
	f := runJournalFixture(t)
	f.receive(t)
	state, _ := f.store.Read()
	second, err := f.journal.partition.owner.Open(state.Connections[1].Receipt.Membership.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := second.Runs().Receive(f.raw, f.admission(t, f.now), f.now); !errors.Is(err, ErrConflict) {
		t.Fatal("foreign Peer adopted request", err)
	}
}

func TestPeerRunJournalRequiresAdmissionAndBoundsLocalOutcome(t *testing.T) {
	f := runJournalFixture(t)
	if list, err := f.journal.List(); err != nil || len(list) != 0 {
		t.Fatal("empty journal", err)
	}
	if _, err := f.journal.Receive(f.raw, ExecutionAdmission{}, f.now); err == nil {
		t.Fatal("unsigned request accepted")
	}
	f.receive(t)
	if _, err := f.journal.Finish(f.binding.RunID, RunOutcome{State: "completed"}, f.now); err == nil {
		t.Fatal("unstarted completion")
	}
	if _, err := f.journal.Begin(f.binding.RunID, f.admission(t, f.now), f.now); err != nil {
		t.Fatal(err)
	}
	for _, outcome := range []RunOutcome{
		{State: "delivery_denied"}, {State: "working"}, {State: "outcome_unknown", Reply: "must not be settlement content"},
		{State: "completed", Reply: strings.Repeat("x", maximumRunReplyBytes+1)}, {State: "completed", Reply: string([]byte{0xff})},
	} {
		if _, err := f.journal.Finish(f.binding.RunID, outcome, f.now); err == nil {
			t.Fatal("invalid outcome", outcome.State)
		}
	}
	if _, err := f.journal.Finish(f.binding.RunID, RunOutcome{State: "outcome_unknown"}, f.now); err != nil {
		t.Fatal(err)
	}
	if _, err := f.journal.Begin(f.binding.RunID, f.admission(t, f.now), f.now); !errors.Is(err, ErrConflict) {
		t.Fatal("unknown retried", err)
	}
}
