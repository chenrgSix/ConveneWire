package peer

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"path/filepath"
	"sync"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// diagnosticError carries only locally selected classifications. Unwrap keeps
// existing denial, transport and cancellation behavior unchanged.
type diagnosticError struct {
	source string
	reason string
	status int
	at     time.Time
	err    error
}

func (e *diagnosticError) Error() string { return e.err.Error() }
func (e *diagnosticError) Unwrap() error { return e.err }
func diagnosticCause(source, reason string, err error) error {
	return &diagnosticError{source: source, reason: reason, at: time.Now(), err: err}
}
func httpDiagnostic(path, reason string, status int, err error) error {
	source := "peer_http"
	switch path {
	case "/api/peer/identity":
		source = "host_identity_http"
	case "/api/peer/runs/admit":
		source = "run_admission_http"
	}
	return &diagnosticError{source: source, reason: reason, status: status, at: time.Now(), err: err}
}
func transportReason(err error) string {
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		return "timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "context_canceled"
	}
	return "transport_error"
}

type diagnosticFailure struct {
	RemoteCode string             `json:"remoteCode,omitempty"`
	At         string             `json:"at,omitempty"`
	Source     string             `json:"source"`
	Reason     string             `json:"reason"`
	HTTPStatus int                `json:"httpStatus,omitempty"`
	Detail     *diagnosticFailure `json:"detail,omitempty"`
}

func classifyDiagnostic(err error) *diagnosticFailure {
	if err == nil {
		return nil
	}
	var classified *diagnosticError
	if errors.As(err, &classified) {
		value := &diagnosticFailure{At: classified.at.UTC().Format(time.RFC3339Nano), Source: classified.source, Reason: classified.reason, HTTPStatus: classified.status, RemoteCode: safeRemoteCode(classified.err)}
		// Only the locally constructed authorization wrapper has a nested source.
		if classified.source == "authorization" {
			value.Detail = classifyDiagnostic(classified.err)
		}
		return value
	}
	reason := "unclassified"
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		reason = "deadline_exceeded"
	case errors.Is(err, context.Canceled):
		reason = "context_canceled"
	case errors.Is(err, ErrTransport):
		reason = "transport_error"
	case errors.Is(err, ErrProof):
		reason = "proof_rejected"
	case errors.Is(err, ErrStore):
		reason = "storage_unavailable"
	case errors.Is(err, ErrExport):
		reason = "export_unavailable"
	case errors.Is(err, ErrApproval):
		reason = "approval_unavailable"
	default:
		var remote *RemoteError
		if errors.As(err, &remote) {
			reason = "host_denied"
		}
	}
	return &diagnosticFailure{Source: "execution", Reason: reason, RemoteCode: safeRemoteCode(err)}
}

func safeRemoteCode(err error) string {
	var remote *RemoteError
	if errors.As(err, &remote) && closed("PeerError", wire.PeerError{Code: wire.Code(remote.Code)}) {
		return remote.Code
	}
	return ""
}

type diagnosticObservation struct {
	At    string `json:"at"`
	Event string `json:"event"`
}
type runDiagnosticRecord struct {
	SchemaVersion    int                     `json:"schemaVersion"`
	ObservedAt       string                  `json:"observedAt"`
	Cancellation     *diagnosticFailure      `json:"cancellation,omitempty"`
	ExecutionError   *diagnosticFailure      `json:"executionError,omitempty"`
	ProcessesStopped bool                    `json:"processesStopped"`
	Finished         bool                    `json:"finished"`
	Observations     []diagnosticObservation `json:"observations"`
	Dropped          int                     `json:"dropped"`
	WriteFailures    int                     `json:"writeFailures"`
}
type runDiagnostics struct {
	mu     sync.Mutex
	record runDiagnosticRecord
	save   func([]byte) error
}
type runDiagnosticsKey struct{}

func newRunDiagnostics(j *RunJournal, runID string) *runDiagnostics {
	return &runDiagnostics{record: runDiagnosticRecord{SchemaVersion: 1, Observations: []diagnosticObservation{}}, save: func(raw []byte) error {
		j.mu.Lock()
		defer j.mu.Unlock()
		if err := j.check(false); err != nil {
			return err
		}
		if _, err := j.load(runID); err != nil {
			return err
		}
		return writePrivateState(filepath.Join(j.directory, runID), "diagnostics.json", raw)
	}}
}
func (d *runDiagnostics) persist() {
	d.record.ObservedAt = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.Marshal(d.record)
	if err != nil || d.save != nil && d.save(raw) != nil {
		d.record.WriteFailures++
	}
}
func observeApproval(ctx context.Context, event string) {
	d, _ := ctx.Value(runDiagnosticsKey{}).(*runDiagnostics)
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.record.Observations) == 32 {
		d.record.Dropped++
	} else {
		d.record.Observations = append(d.record.Observations, diagnosticObservation{At: time.Now().UTC().Format(time.RFC3339Nano), Event: event})
	}
	d.persist()
}
func (d *runDiagnostics) finish(cause, runErr error, stopped bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.record.Finished {
		return
	}
	d.record.Cancellation = classifyDiagnostic(cause)
	d.record.ExecutionError = classifyDiagnostic(runErr)
	d.record.ProcessesStopped, d.record.Finished = stopped, true
	d.persist()
}

func connectorStopReason(code string) string {
	switch code {
	case "NODE_IDENTITY_UNAVAILABLE":
		return "identity_unavailable"
	case "PEER_STORAGE_UNAVAILABLE":
		return "storage_unavailable"
	default:
		return "stopped"
	}
}
