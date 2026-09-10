package peer

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"convenewire.dev/bridge/internal/delivery"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/peer"
)

// runtimeFactory borrows the owning core's physical scheduler and process store.
// Network Run admission supplies a required freshness check; a retained Export
// or an authenticated socket alone cannot call an adapter successfully.
type runtimeFactory struct {
	store      *Store
	sources    *Sources
	exporter   *Exporter
	partitions *RuntimePartitions
	approvals  *Approvals
	gate       delivery.ExecutionGate
	processes  bridgeruntime.GovernedProcessTracker
	clock      func() time.Time
	previews   peerPreviewBudget
}

// BindRuntime is native core composition, before this connector epoch starts.
// All connectors must borrow the same Node-owned resources. No Device owner,
// credentials, Host-provided configuration or alternate scheduler is created.
func (c *Connectors) BindRuntime(partitions *RuntimePartitions, gate delivery.ExecutionGate, processes bridgeruntime.GovernedProcessTracker) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started.Load() || c.runtime != nil || partitions == nil || partitions.store != c.store || gate == nil || processes == nil {
		return ErrStore
	}
	c.runtime = &runtimeFactory{store: c.store, sources: c.sources, exporter: c.exporter, partitions: partitions,
		approvals: c.approvals, gate: gate, processes: processes, clock: c.clock}
	return nil
}

// ExecuteRuntime is for the authenticated Peer Run coordinator. That coordinator
// must bind current to this exact immutable Run, verify its semantic digest and
// obtain current Host admission on every invocation, including after waits.
// The execution context belongs to the connection/Run lifetime, never a Console
// request. This method does not authorize network input or retry delivery.
func (c *Connectors) ExecuteRuntime(ctx context.Context, membershipID string, binding wire.PeerExecutionBinding,
	request bridgeruntime.Request, current func(context.Context) error, emit bridgeruntime.EmitFunc) error {
	c.mu.Lock()
	factory := c.runtime
	c.mu.Unlock()
	if factory == nil {
		return ErrExport
	}
	return factory.execute(ctx, membershipID, binding, request, current, emit)
}

func (f *runtimeFactory) local(membershipID string, binding wire.PeerExecutionBinding) (ExportSource, error) {
	state, err := f.store.Read()
	if err != nil {
		return ExportSource{}, err
	}
	local, found := findConnection(state, membershipID)
	if !found || state.Participant.NodeID != binding.ParticipantNodeID ||
		local.Receipt.Invitation.Host.NodeID != binding.AuthorityNodeID || local.Receipt.Membership.PeerID != binding.PeerID ||
		local.Receipt.Membership.Scope.TeamID != binding.TeamID {
		return ExportSource{}, ErrExport
	}
	record, err := f.exporter.Effective(membershipID, binding.LocalAgentID, binding.RoomID, f.clock())
	if err != nil {
		return ExportSource{}, err
	}
	a := record.Acceptance
	digest, err := semanticDigest(a)
	if err != nil || record.Projection.ProjectionAgentID != binding.ProjectionAgentID ||
		a.PeerID != binding.PeerID || a.AuthorityNodeID != binding.AuthorityNodeID || a.ParticipantNodeID != binding.ParticipantNodeID ||
		a.TeamID != binding.TeamID || a.ExportID != binding.ExportID || a.GrantRevision != binding.GrantRevision ||
		a.GrantDigest != binding.GrantDigest || a.AcceptanceID != binding.AcceptanceID || a.Revision != binding.AcceptanceRevision ||
		digest != binding.AcceptanceDigest || !a.Capabilities.SupportsStart {
		return ExportSource{}, ErrExport
	}
	return f.sources.Resolve(binding.LocalAgentID)
}

func (f *runtimeFactory) execute(ctx context.Context, membershipID string, binding wire.PeerExecutionBinding,
	request bridgeruntime.Request, hostCurrent func(context.Context) error, emit bridgeruntime.EmitFunc) error {
	_, err := f.executeManaged(ctx, membershipID, binding, request, hostCurrent, emit, nil)
	return err
}

// beforeInvoke is the coordinator's one-time durable journal claim, after the
// physical queue and fresh bilateral checks. It must succeed before any adapter
// can create a child. An unconfirmed process keeps this core's resource locked;
// a replacement core fences the Node process store before admitting new work.
func (f *runtimeFactory) executeManaged(ctx context.Context, membershipID string, binding wire.PeerExecutionBinding,
	request bridgeruntime.Request, hostCurrent func(context.Context) error, emit bridgeruntime.EmitFunc,
	beforeInvoke func(context.Context) error) (result runtimeExecution, resultErr error) {
	result.ProcessesStopped = true
	if ctx == nil || ctx.Err() != nil || hostCurrent == nil || emit == nil || !closed("PeerExecutionBinding", binding) {
		return result, ErrExport
	}
	// Freeze nested context before any wait. Artifact aliases require their own
	// Peer-scoped verified transfer path; Device/private/governed inputs cannot
	// silently fall back to an ordinary Peer invocation.
	raw, err := json.Marshal(request.Run)
	var frozen bridgeruntime.Request
	if err != nil || json.Unmarshal(raw, &frozen.Run) != nil || len(request.Artifacts) != 0 {
		return result, ErrExport
	}
	request = frozen
	r := request.Run
	if r.RunID != binding.RunID || r.RoomID != binding.RoomID || r.TargetAgentID != binding.ProjectionAgentID ||
		r.DeviceTrust != nil || r.CentralApproval != nil || r.OwnerPrivateOutput != nil && *r.OwnerPrivateOutput ||
		r.ConversationWork != nil && *r.ConversationWork || r.ContextManifest != nil && r.ContextManifest.Execution != nil ||
		r.Deadline.IsZero() || !r.Deadline.After(f.clock()) {
		return result, ErrExport
	}
	ctx, cancel := context.WithDeadline(ctx, r.Deadline)
	defer cancel()
	if _, err := f.local(membershipID, binding); err != nil {
		return result, err
	}
	partition, err := f.partitions.Open(membershipID)
	if err != nil {
		return result, err
	}
	current := func(ctx context.Context) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := partition.Check(); err != nil {
			return err
		}
		if _, err := f.local(membershipID, binding); err != nil {
			return err
		}
		if err := hostCurrent(ctx); err != nil {
			return err
		}
		// Network freshness may itself wait. Close the local side of that wait.
		if _, err := f.local(membershipID, binding); err != nil {
			return err
		}
		if err := partition.Check(); err != nil {
			return err
		}
		return ctx.Err()
	}
	if err := current(ctx); err != nil {
		return result, err
	}
	release, err := f.gate.Acquire(ctx, binding.LocalAgentID)
	if err != nil {
		return result, err
	}
	processes := &processEvidence{parent: f.processes}
	defer func() {
		result.ProcessesStopped = processes.stopped()
		if result.ProcessesStopped {
			release()
		} else {
			resultErr = errors.Join(resultErr, ErrRunProcessUnknown)
		}
	}()
	if err := current(ctx); err != nil {
		return result, err
	}
	source, err := f.sources.Resolve(binding.LocalAgentID)
	if err != nil {
		return result, err
	}
	cfg := source.Configuration
	cfg.AuthorityNodeID, cfg.PeerRuntimeNamespace = binding.AuthorityNodeID, partition.Namespace()
	var adapter bridgeruntime.Adapter
	switch {
	case cfg.RuntimeKind == "pi":
		adapter = bridgeruntime.PiAdapter{Config: cfg, Sessions: partition.Sessions()}
	case cfg.Adapter == "codex":
		adapter = bridgeruntime.CodexAdapter{Config: cfg, Sessions: partition.Sessions(),
			LocalApproval: func(live context.Context) (bridgeruntime.LocalApprovalSession, error) {
				return f.approvals.Open(live, binding, current)
			}}
	case cfg.Adapter == "generic":
		adapter = bridgeruntime.GenericAdapter{Config: cfg}
	default:
		return result, ErrExport
	}
	if beforeInvoke != nil {
		if err := beforeInvoke(ctx); err != nil {
			return result, err
		}
	}
	result.Invoked = true
	return result, (bridgeruntime.PeerProcessAdapter{Adapter: adapter, Tracker: processes, Binding: binding}).Execute(ctx, request, emit)
}
