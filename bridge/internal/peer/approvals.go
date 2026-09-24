package peer

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"sync"
	"time"
	"unicode/utf8"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	wire "convenewire.dev/contracts/generated/go/peer"
)

var ErrApproval = errors.New("Peer local approval is expired, invalidated or bound to another execution")
var localApprovalID = regexp.MustCompile(`^approval_[A-Za-z0-9_-]{8,128}$`)

// ApprovalView is local Console state. It must never be sent to a Host, Room or
// Device approval endpoint. ProcessID identifies this live callback owner, not
// an OS PID or a durable permission.
type ApprovalView struct {
	RequestID       string                    `json:"requestId"`
	ProcessID       string                    `json:"processId"`
	Binding         wire.PeerExecutionBinding `json:"binding"`
	BindingDigest   string                    `json:"bindingDigest"`
	ConsentRevision int64                     `json:"consentRevision"`
	OperationKind   contracts.OperationKind   `json:"operationKind"`
	Details         string                    `json:"details"`
	ExpiresAt       time.Time                 `json:"expiresAt"`
}

type ApprovalDecision struct {
	RequestID       string `json:"requestId"`
	ProcessID       string `json:"processId"`
	BindingDigest   string `json:"bindingDigest"`
	ConsentRevision int64  `json:"consentRevision"`
	Allow           bool   `json:"allow"`
}

type approvalProcess struct {
	ctx     context.Context
	cancel  context.CancelFunc
	id      string
	binding wire.PeerExecutionBinding
	digest  string
	current func(context.Context) error
	seen    map[string]bool
}

type pendingApproval struct {
	view    ApprovalView
	process *approvalProcess
	ctx     context.Context
	answer  chan bool
}

// Approvals belongs to one native core lifetime. It persists no decision and
// inherits no Device consent. The reviewed Export revision is its local consent
// revision; changing the Export invalidates the exact execution binding.
type Approvals struct {
	mu        sync.Mutex
	closed    bool
	processes map[string]*approvalProcess
	pending   map[string]*pendingApproval
}

// Open is called once for an actual Runtime child. live must end when the child
// exits, its connector disconnects, or its Run ends. current must recheck exact
// local Export/configuration and fresh Host admission after every approval wait.
func (a *Approvals) Open(live context.Context, binding wire.PeerExecutionBinding, current func(context.Context) error) (bridgeruntime.LocalApprovalSession, error) {
	if live == nil || live.Err() != nil || !closed("PeerExecutionBinding", binding) || current == nil {
		return bridgeruntime.LocalApprovalSession{}, ErrApproval
	}
	if err := current(live); err != nil {
		return bridgeruntime.LocalApprovalSession{}, err
	}
	digest, err := semanticDigest(binding)
	if err != nil {
		return bridgeruntime.LocalApprovalSession{}, err
	}
	nonce, err := NewNonce()
	if err != nil {
		return bridgeruntime.LocalApprovalSession{}, err
	}
	ctx, cancel := context.WithCancel(live)
	p := &approvalProcess{ctx: ctx, cancel: cancel, id: "process_" + nonce, binding: binding, digest: digest, current: current, seen: map[string]bool{}}
	a.mu.Lock()
	if a.closed || ctx.Err() != nil || len(a.processes) >= 64 {
		a.mu.Unlock()
		cancel()
		return bridgeruntime.LocalApprovalSession{}, ErrApproval
	}
	if a.processes == nil {
		a.processes, a.pending = map[string]*approvalProcess{}, map[string]*pendingApproval{}
	}
	a.processes[p.id] = p
	a.mu.Unlock()
	close := func() { a.closeProcess(p) }
	stop := context.AfterFunc(ctx, close)
	return bridgeruntime.LocalApprovalSession{Revision: binding.GrantRevision,
		Approve: func(ctx context.Context, request contracts.RuntimeApprovalRequestedPayload) (bool, error) {
			return a.await(ctx, p, request)
		}, Close: func() { stop(); close() }}, nil
}

func (a *Approvals) closeProcess(p *approvalProcess) {
	p.cancel()
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.processes, p.id)
	for id, request := range a.pending {
		if request.process == p {
			delete(a.pending, id)
		}
	}
}

func (a *Approvals) await(ctx context.Context, p *approvalProcess, input contracts.RuntimeApprovalRequestedPayload) (allowed bool, approvalErr error) {
	now := time.Now()
	if ctx == nil || ctx.Err() != nil || p.ctx.Err() != nil || !localApprovalID.MatchString(input.RequestID) ||
		input.RunID != p.binding.RunID || input.AgentID != p.binding.ProjectionAgentID || input.Revision != p.binding.GrantRevision ||
		(input.OperationKind != "command" && input.OperationKind != "file_change") || input.Details == "" ||
		!utf8.ValidString(input.Details) || utf8.RuneCountInString(input.Details) > 12000 ||
		bridgeruntime.RedactSensitiveText(input.Details) != input.Details || !input.ExpiresAt.After(now) || input.ExpiresAt.After(now.Add(5*time.Minute)) {
		return false, ErrApproval
	}
	ctx, cancel := context.WithDeadline(ctx, input.ExpiresAt)
	stop := context.AfterFunc(p.ctx, cancel)
	defer stop()
	defer cancel()
	if err := p.current(ctx); err != nil {
		return false, err
	}
	request := &pendingApproval{process: p, ctx: ctx, answer: make(chan bool, 1), view: ApprovalView{
		RequestID: input.RequestID, ProcessID: p.id, Binding: p.binding, BindingDigest: p.digest,
		ConsentRevision: p.binding.GrantRevision, OperationKind: input.OperationKind, Details: input.Details, ExpiresAt: input.ExpiresAt}}
	a.mu.Lock()
	if a.closed || a.processes[p.id] != p || p.ctx.Err() != nil || ctx.Err() != nil || p.seen[input.RequestID] ||
		a.pending[input.RequestID] != nil || len(a.pending) >= 256 || len(p.seen) >= 256 {
		a.mu.Unlock()
		return false, ErrApproval
	}
	p.seen[input.RequestID] = true
	a.pending[input.RequestID] = request
	a.mu.Unlock()
	observeApproval(p.ctx, "approval_waiting")
	defer func() {
		event := "approval_interrupted"
		if approvalErr == nil {
			event = "approval_denied"
			if allowed {
				event = "approval_allowed"
			}
		} else if p.ctx.Err() == nil && !input.ExpiresAt.After(time.Now()) {
			event = "approval_expired"
		} else if p.ctx.Err() == nil && ctx.Err() == nil {
			event = "approval_recheck_failed"
		}
		observeApproval(p.ctx, event)
	}()
	defer func() {
		a.mu.Lock()
		if a.pending[input.RequestID] == request {
			delete(a.pending, input.RequestID)
		}
		a.mu.Unlock()
	}()
	timer := time.NewTimer(time.Until(input.ExpiresAt))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false, ErrApproval
	case <-p.ctx.Done():
		return false, ErrApproval
	case <-timer.C:
		return false, ErrApproval
	case allowed := <-request.answer:
		if ctx.Err() != nil || p.ctx.Err() != nil || !input.ExpiresAt.After(time.Now()) {
			return false, ErrApproval
		}
		if err := p.current(ctx); err != nil {
			return false, err
		}
		if ctx.Err() != nil || p.ctx.Err() != nil || !input.ExpiresAt.After(time.Now()) {
			return false, ErrApproval
		}
		return allowed, nil
	}
}

// Decide is an authenticated Participant-local action. There is no Host caller
// or transferable approval token. A consumed, stale or changed decision fails.
func (a *Approvals) Decide(decision ApprovalDecision) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	request := a.pending[decision.RequestID]
	if a.closed || request == nil || request.ctx.Err() != nil || request.process.ctx.Err() != nil ||
		!request.view.ExpiresAt.After(time.Now()) || decision.ProcessID != request.view.ProcessID ||
		decision.BindingDigest != request.view.BindingDigest || decision.ConsentRevision != request.view.ConsentRevision {
		return ErrApproval
	}
	delete(a.pending, decision.RequestID)
	request.answer <- decision.Allow
	return nil
}

func (a *Approvals) Pending() []ApprovalView {
	a.mu.Lock()
	defer a.mu.Unlock()
	views := []ApprovalView{}
	for _, request := range a.pending {
		if request.ctx.Err() == nil && request.process.ctx.Err() == nil && request.view.ExpiresAt.After(time.Now()) {
			views = append(views, request.view)
		}
	}
	sort.Slice(views, func(i, j int) bool { return views[i].RequestID < views[j].RequestID })
	return views
}

func (a *Approvals) RevokePeer(peerID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, p := range a.processes {
		if p.binding.PeerID == peerID {
			p.cancel()
		}
	}
}

func (a *Approvals) Close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.closed = true
	for _, p := range a.processes {
		p.cancel()
	}
	a.pending = nil
}
