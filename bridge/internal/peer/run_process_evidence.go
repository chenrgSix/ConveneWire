package peer

import (
	"errors"
	"sync"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
)

var ErrRunProcessUnknown = errors.New("Peer Runtime process completion is unconfirmed")

type runtimeExecution struct {
	Invoked          bool
	ProcessesStopped bool
}

// processEvidence observes the actual Node-owned leases used by one adapter
// invocation. Returning from an adapter (even with nil) is not process evidence.
// A failed preparation may have found an existing process, so it also fences
// the shared resource until the next core's native process reconciliation.
type processEvidence struct {
	parent  bridgeruntime.GovernedProcessTracker
	mu      sync.Mutex
	pending int
}

func (p *processEvidence) PrepareProcess(identity bridgeruntime.GovernedProcessIdentity) (bridgeruntime.GovernedProcessLease, error) {
	p.mu.Lock()
	p.pending++
	p.mu.Unlock()
	lease, err := p.parent.PrepareProcess(identity)
	if err != nil {
		// A duplicate of an exactly proven finished process still cannot run,
		// but it need not block other work. Changed pins and ambiguous records
		// cannot satisfy this independent durable completion check.
		if completion, ok := p.parent.(interface {
			RequireFinished(bridgeruntime.GovernedProcessIdentity) error
		}); ok && completion.RequireFinished(identity) == nil {
			p.mu.Lock()
			p.pending--
			p.mu.Unlock()
		}
		return nil, err
	}
	if lease == nil {
		return nil, ErrRunProcessUnknown
	}
	return &processEvidenceLease{GovernedProcessLease: lease, owner: p}, nil
}

func (p *processEvidence) stopped() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pending == 0
}

type processEvidenceLease struct {
	bridgeruntime.GovernedProcessLease
	owner    *processEvidence
	resolved sync.Once
}

func (l *processEvidenceLease) resolve(err error) error {
	if err == nil {
		l.resolved.Do(func() {
			l.owner.mu.Lock()
			l.owner.pending--
			l.owner.mu.Unlock()
		})
	}
	return err
}

func (l *processEvidenceLease) Finished(observation bridgeruntime.GovernedProcessObservation) error {
	return l.resolve(l.GovernedProcessLease.Finished(observation))
}

func (l *processEvidenceLease) Abandon() error {
	return l.resolve(l.GovernedProcessLease.Abandon())
}
