package peer

import (
	"errors"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// Revision zero is the implicit default, never a persisted preference.
func effectiveExecutionTrust(local LocalConnection) wire.PeerExecutionTrust {
	if local.ExecutionTrust == nil {
		return wire.PeerExecutionTrust{Enabled: true}
	}
	return *local.ExecutionTrust
}

func executionTrustActive(local LocalConnection, now time.Time) bool {
	expiry, err := time.Parse(time.RFC3339Nano, local.Receipt.Membership.ExpiresAt)
	return err == nil && expiry.After(now) && local.State == "active" &&
		local.Receipt.Membership.State == "active" && local.Departure == nil
}

func executionTrustTransition(previous, next LocalConnection, now time.Time) error {
	if equalJSON(previous.ExecutionTrust, next.ExecutionTrust) {
		return nil
	}
	if next.ExecutionTrust == nil || !executionTrustActive(previous, now) || !executionTrustActive(next, now) ||
		next.ExecutionTrust.Revision != effectiveExecutionTrust(previous).Revision+1 {
		return ErrStore
	}
	return nil
}

func (s *Store) executionTrust(membershipID string, now time.Time) (wire.PeerExecutionTrust, error) {
	state, err := s.Read()
	if err != nil {
		return wire.PeerExecutionTrust{}, err
	}
	local, found := findConnection(state, membershipID)
	if !found || !executionTrustActive(local, now) {
		return wire.PeerExecutionTrust{}, ErrExport
	}
	return effectiveExecutionTrust(local), nil
}

// SetExecutionTrust is an Owner-only operation. Its revision is independent of
// background export synchronization. A stale choice cannot overwrite a newer one.
func (e *Exporter) SetExecutionTrust(membershipID string, expected int64, enabled bool, now time.Time) (string, wire.PeerExecutionTrust, error) {
	if expected < 0 || expected >= 9007199254740991 {
		return "", wire.PeerExecutionTrust{}, ErrConflict
	}
	for attempt := 0; attempt < 8; attempt++ {
		state, err := e.store.Read()
		if err != nil {
			return "", wire.PeerExecutionTrust{}, err
		}
		index, local, found := exportConnection(state, membershipID)
		if !found || !executionTrustActive(local, now) {
			return "", wire.PeerExecutionTrust{}, ErrExport
		}
		current := effectiveExecutionTrust(local)
		if current.Revision == expected+1 && current.Enabled == enabled {
			return local.Receipt.Membership.PeerID, current, nil
		}
		if current.Revision != expected {
			return "", wire.PeerExecutionTrust{}, ErrConflict
		}
		if local.ExecutionTrust != nil && current.Enabled == enabled {
			return local.Receipt.Membership.PeerID, current, nil
		}
		next := wire.PeerExecutionTrust{Enabled: enabled, Revision: expected + 1}
		state.Connections[index].ExecutionTrust = &next
		state.Revision++
		if err := e.store.Update(state.Revision-1, state, now); errors.Is(err, ErrConflict) {
			continue
		} else if err != nil {
			return "", wire.PeerExecutionTrust{}, err
		}
		return local.Receipt.Membership.PeerID, next, nil
	}
	return "", wire.PeerExecutionTrust{}, ErrConflict
}
