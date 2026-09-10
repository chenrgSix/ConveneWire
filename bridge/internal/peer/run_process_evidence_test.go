package peer

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
)

func TestPeerRuntimeClaimsOnlyAfterQueueAndBeforeActualAdapter(t *testing.T) {
	for _, denied := range []bool{false, true} {
		t.Run(map[bool]string{false: "claimed", true: "journal denied"}[denied], func(t *testing.T) {
			f := newRuntimeFactoryFixture(t, "generic")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			release, err := f.gate.Acquire(ctx, f.binding.LocalAgentID)
			if err != nil {
				t.Fatal(err)
			}
			defer release()
			checked := make(chan struct{}, 1)
			var claimed atomic.Bool
			current := func(context.Context) error {
				select {
				case checked <- struct{}{}:
				default:
				}
				return nil
			}
			before := func(context.Context) error {
				if denied {
					return ErrStore
				}
				claimed.Store(true)
				return nil
			}
			type outcome struct {
				result runtimeExecution
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				result, err := f.connectors.runtime.executeManaged(ctx, f.membership, f.binding, f.request, current,
					func(context.Context, bridgeruntime.Event) error {
						if !claimed.Load() {
							return errors.New("adapter ran before durable claim")
						}
						return nil
					}, before)
				done <- outcome{result, err}
			}()
			select {
			case <-checked:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if claimed.Load() {
				t.Fatal("claimed while physical resource was busy")
			}
			release()
			var got outcome
			select {
			case got = <-done:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if got.result.Invoked == denied || !got.result.ProcessesStopped || denied && !errors.Is(got.err, ErrStore) || !denied && got.err != nil {
				t.Fatalf("unexpected process evidence: %+v, %v", got.result, got.err)
			}
			_, err = os.Stat(filepath.Join(f.workspace, "runtime-started"))
			if denied && !os.IsNotExist(err) || !denied && err != nil {
				t.Fatal("actual child crossed claim boundary", err)
			}
			released, err := f.gate.Acquire(ctx, f.binding.LocalAgentID)
			if err != nil {
				t.Fatal("safe process retained resource", err)
			}
			released()
		})
	}
}

type completionLossTracker struct {
	parent      bridgeruntime.GovernedProcessTracker
	prepareLoss bool
}

func (t completionLossTracker) PrepareProcess(id bridgeruntime.GovernedProcessIdentity) (bridgeruntime.GovernedProcessLease, error) {
	if t.prepareLoss {
		return nil, ErrStore
	}
	lease, err := t.parent.PrepareProcess(id)
	if err != nil {
		return nil, err
	}
	return completionLossLease{lease}, nil
}

type completionLossLease struct {
	bridgeruntime.GovernedProcessLease
}

func (l completionLossLease) Finished(observation bridgeruntime.GovernedProcessObservation) error {
	// The real child is cleaned up, but its confirmation is unavailable to the
	// caller. A success-looking adapter result must still remain unconfirmed.
	return errors.Join(l.GovernedProcessLease.Finished(observation), ErrStore)
}

func TestPeerRuntimeRetainsPhysicalFenceWhenProcessEvidenceIsUnconfirmed(t *testing.T) {
	for _, prepareLoss := range []bool{false, true} {
		t.Run(map[bool]string{false: "completion", true: "preparation"}[prepareLoss], func(t *testing.T) {
			f := newRuntimeFactoryFixture(t, "generic")
			f.connectors.runtime.processes = completionLossTracker{f.processes, prepareLoss}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			result, err := f.connectors.runtime.executeManaged(ctx, f.membership, f.binding, f.request,
				func(context.Context) error { return nil }, ignoreRuntimeEvent, func(context.Context) error { return nil })
			if !result.Invoked || result.ProcessesStopped || !errors.Is(err, ErrRunProcessUnknown) {
				t.Fatalf("ambiguous process reported safe: %+v, %v", result, err)
			}
			borrow, stop := context.WithTimeout(ctx, 50*time.Millisecond)
			defer stop()
			if release, err := f.gate.Acquire(borrow, f.binding.LocalAgentID); err == nil {
				release()
				t.Fatal("unconfirmed child released shared workspace")
			}
			if err := f.processes.FenceAll(ctx); err != nil {
				t.Fatal("Node process recovery", err)
			}
		})
	}
}
