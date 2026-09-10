package peer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/peer"
)

// peerRunExecution composes authenticated delivery with the existing native
// factory. Its owner drains every invocation before replacing a connection.
type peerRunExecution struct {
	factory     *runtimeFactory
	client      *Client
	journal     *RunJournal
	membership  string
	delivery    RunDelivery
	emitMu      sync.Mutex
	admissionMu sync.Mutex
	admission   ExecutionAdmission
	terminal    *bridgeruntime.Event
	reply       string
}

func (e *peerRunExecution) current(ctx context.Context) error {
	if _, err := e.factory.local(e.membership, e.delivery.Settlement.Binding); err != nil {
		return err
	}
	admission, err := e.client.AuthorizeExecution(ctx, e.factory.store, e.membership, e.delivery.Settlement.Binding)
	if err != nil {
		return err
	}
	e.admissionMu.Lock()
	e.admission = admission
	e.admissionMu.Unlock()
	return nil
}

func (e *peerRunExecution) local() error {
	if err := e.journal.partition.Check(); err != nil {
		return err
	}
	_, err := e.factory.local(e.membership, e.delivery.Settlement.Binding)
	return err
}

func (e *peerRunExecution) append(value map[string]any) error {
	state, err := e.journal.Transport(e.delivery.Settlement.Binding.RunID)
	if err != nil {
		return err
	}
	value["sequence"] = len(state.Events) + 1
	raw, err := marshalPeerEvent(value)
	if err != nil {
		return ErrStore
	}
	_, err = e.journal.AppendEvent(e.delivery.Settlement.Binding.RunID, raw)
	return err
}

func marshalPeerEvent(value map[string]any) (json.RawMessage, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, ErrProof
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var copied any
	if decoder.Decode(&copied) != nil {
		return nil, ErrProof
	}
	var clean func(any) any
	clean = func(value any) any {
		switch item := value.(type) {
		case string:
			return bridgeruntime.RedactSensitiveText(item)
		case map[string]any:
			for key, child := range item {
				item[key] = clean(child)
			}
		case []any:
			for index, child := range item {
				item[index] = clean(child)
			}
		}
		return value
	}
	return json.Marshal(clean(copied))
}

func (e *peerRunExecution) flush(ctx context.Context) error {
	id := e.delivery.Settlement.Binding.RunID
	state, err := e.journal.Transport(id)
	if err != nil {
		return err
	}
	for _, event := range state.Events[state.Acknowledged():] {
		receipt, err := e.client.PublishRunEvent(ctx, e.factory.store, e.membership, e.delivery, event, e.local)
		if err != nil {
			return err
		}
		if _, err := e.journal.AcknowledgeEvent(id, receipt); err != nil {
			return err
		}
	}
	return nil
}

// Publication denied by current authority permits only content-free settlement.
// A transport failure is ambiguous: retain pending content for later recovery.
func publicationDenied(err error) bool {
	if errors.Is(err, ErrExport) {
		return true
	}
	var remote *RemoteError
	if errors.As(err, &remote) {
		switch remote.Code {
		case "UNAUTHENTICATED", "SCOPE_DENIED", "REVOKED", "EXPIRED", "STALE_AUTHORIZATION":
			return true
		}
	}
	return false
}

func (e *peerRunExecution) recover(ctx context.Context, record RunRecord) error {
	id := record.Binding.RunID
	if record.Outcome == nil {
		return ErrStore
	}
	state, err := e.journal.Transport(id)
	if err != nil {
		return err
	}
	if state.SettlementReceipt != nil {
		return nil
	}
	if state.Settlement == nil {
		if len(record.Outcome.Terminal) != 0 {
			if _, err := e.journal.AppendEvent(id, record.Outcome.Terminal); err != nil {
				return err
			}
		}
		if err := e.flush(ctx); err != nil && !publicationDenied(err) {
			return err
		}
		// The Runtime has stopped, while its Host Run waits for a human answer.
		// Clarification is business content and cannot use settlement authority.
		if record.Outcome.State == "input_required" {
			return nil
		}
		settlement, err := e.journal.PrepareSettlement(id)
		if err != nil {
			return err
		}
		state.Settlement = &settlement
	}
	receipt, err := e.client.SettleRun(ctx, e.factory.store, e.membership, e.delivery, *state.Settlement)
	if err != nil {
		return err
	}
	return e.journal.AcknowledgeSettlement(id, receipt)
}

func peerStatus(event bridgeruntime.Event) map[string]any {
	value := map[string]any{"type": "status", "status": string(*event.Status)}
	if event.Error != nil {
		value["error"] = map[string]any{"code": event.Error.Code, "message": bridgeruntime.RedactSensitiveText(event.Error.Message), "retryable": false}
	}
	if event.Clarification != nil {
		value["clarification"] = event.Clarification
	}
	if event.Session != nil && *event.Status == "working" {
		value["session"] = map[string]any{"disposition": event.Session.Disposition, "contextCursor": event.Session.ContextCursor}
		if event.Session.ResultEvidenceRevision != nil {
			value["session"].(map[string]any)["resultEvidenceRevision"] = *event.Session.ResultEvidenceRevision
		}
	}
	return value
}

// Only the closed Peer carriers can leave this adapter. The actual restricted
// adapters already redact accumulated streaming text before producing events.
func (e *peerRunExecution) emit(ctx context.Context, event bridgeruntime.Event) error {
	e.emitMu.Lock()
	defer e.emitMu.Unlock()
	if e.terminal != nil || event.DevelopmentProposal != nil {
		return ErrExport
	}
	if event.Status != nil && *event.Status != "working" {
		if *event.Status != "completed" && *event.Status != "failed" && *event.Status != "canceled" && *event.Status != "input_required" {
			return ErrProof
		}
		raw, err := json.Marshal(event)
		var retained bridgeruntime.Event
		if err != nil || json.Unmarshal(raw, &retained) != nil {
			return ErrStore
		}
		e.terminal = &retained
		return nil // The final status waits for actual process cleanup and Finish.
	}
	values := []map[string]any{}
	if event.Status != nil {
		values = append(values, peerStatus(event))
	}
	if event.Reply != "" {
		value := map[string]any{"type": "reply", "content": bridgeruntime.RedactSensitiveText(event.Reply)}
		if event.Assessment != nil {
			value["assessment"] = event.Assessment
		}
		values = append(values, value)
		e.reply = value["content"].(string)
	}
	if event.Output != nil && event.Output.Content != "" {
		values = append(values, map[string]any{"type": "output", "content": bridgeruntime.RedactSensitiveText(event.Output.Content), "reset": event.Output.Reset})
	}
	if a := event.Activity; a != nil {
		value := map[string]any{"type": "activity", "activityId": a.ID, "kind": a.Kind, "phase": a.Phase, "reset": a.Reset}
		if a.Label != "" {
			value["label"] = bridgeruntime.RedactSensitiveText(a.Label)
		}
		if a.Content != "" {
			value["content"] = bridgeruntime.RedactSensitiveText(a.Content)
		}
		values = append(values, value)
	}
	for _, value := range values {
		if err := e.append(value); err != nil {
			return err
		}
	}
	return e.flush(ctx)
}

func (e *peerRunExecution) execute(ctx context.Context) error {
	record, err := e.journal.ReceiveDelivery(e.delivery, e.factory.clock())
	if err != nil {
		return err
	}
	if record.Outcome != nil {
		return e.recover(ctx, record)
	}
	if record.StartedAt != "" {
		// The native owner has fenced old processes before core startup, and
		// drains this connection's invocations before a retry can reach here.
		record, err = e.journal.Finish(record.Binding.RunID, RunOutcome{State: "outcome_unknown"}, e.factory.clock())
		if err != nil {
			return err
		}
		return e.recover(ctx, record)
	}
	var request struct {
		Payload contracts.RunRequestedPayload `json:"payload"`
	}
	if wire.VerifyRunRequest(record.Request) != nil || json.Unmarshal(record.Request, &request) != nil {
		return ErrProof
	}
	state, err := e.journal.Transport(record.Binding.RunID)
	if err != nil {
		return err
	}
	if len(state.Events) == 0 {
		if err := e.append(map[string]any{"type": "status", "status": "delivered"}); err != nil {
			return err
		}
	}
	if err := e.flush(ctx); err != nil {
		if !publicationDenied(err) {
			return err
		}
		record, err = e.journal.Finish(record.Binding.RunID, RunOutcome{State: "delivery_denied"}, e.factory.clock())
		if err != nil {
			return err
		}
		return e.recover(ctx, record)
	}
	live, stop := context.WithCancelCause(ctx)
	watchDone := make(chan struct{})
	watchStarted := false
	before := func(current context.Context) error {
		e.admissionMu.Lock()
		admission := e.admission
		e.admissionMu.Unlock()
		if _, err := e.journal.Begin(record.Binding.RunID, admission, e.factory.clock()); err != nil {
			return err
		}
		watchStarted = true
		go func() {
			defer close(watchDone)
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-live.Done():
					return
				case <-ticker.C:
					if err := e.current(live); err != nil {
						stop(err)
						return
					}
				}
			}
		}()
		return current.Err()
	}
	result, runErr := e.factory.executeManaged(live, e.membership, record.Binding, bridgeruntime.Request{Run: request.Payload}, e.current, e.emit, before)
	cause := context.Cause(live)
	stop(context.Canceled)
	if watchStarted {
		<-watchDone
	}
	record, err = e.journal.Load(record.Binding.RunID)
	if err != nil {
		return err
	}
	if record.StartedAt == "" && errors.Is(runErr, ErrTransport) {
		return runErr
	}
	outcome := RunOutcome{State: "failed"}
	if record.StartedAt == "" {
		outcome.State = "delivery_denied"
	}
	if !result.ProcessesStopped {
		outcome.State = "outcome_unknown"
	}
	if result.ProcessesStopped && (errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) || publicationDenied(cause) || errors.Is(runErr, context.Canceled) || errors.Is(runErr, context.DeadlineExceeded)) {
		outcome.State = "canceled"
	}
	if result.ProcessesStopped && runErr == nil && e.terminal != nil {
		outcome.State = string(*e.terminal.Status)
		if outcome.State == "completed" {
			outcome.Reply = e.reply
		}
	}
	if outcome.State == "completed" || outcome.State == "failed" || outcome.State == "canceled" || outcome.State == "input_required" {
		value := map[string]any{"type": "status", "status": outcome.State}
		if e.terminal != nil && string(*e.terminal.Status) == outcome.State {
			value = peerStatus(*e.terminal)
		}
		if outcome.State == "input_required" && (e.terminal == nil || e.terminal.Clarification == nil || strings.TrimSpace(e.terminal.Clarification.Question) == "") {
			outcome.State = "failed"
			value = map[string]any{"type": "status", "status": "failed"}
		}
		state, err := e.journal.Transport(record.Binding.RunID)
		if err != nil {
			return err
		}
		value["sequence"] = len(state.Events) + 1
		outcome.Terminal, err = marshalPeerEvent(value)
		if err != nil {
			return err
		}
	}
	record, err = e.journal.Finish(record.Binding.RunID, outcome, e.factory.clock())
	if err != nil {
		return err
	}
	return e.recover(ctx, record)
}
