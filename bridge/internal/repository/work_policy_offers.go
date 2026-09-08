package repository

import (
	"context"
	"encoding/json"
	"time"

	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

// WorkPolicyOffers observes exact source commits without issuing any grant.
// Profile availability and configured Agent identity are checked by admission.
func (s *BindingStore) WorkPolicyOffers(ctx context.Context, now time.Time) ([]execution.WorkPolicyOffer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return nil, err
	}
	if now.IsZero() {
		return nil, ErrInvalid
	}
	views, err := s.listWorkPolicies()
	if err != nil {
		return nil, err
	}
	offers := []execution.WorkPolicyOffer{}
	for _, view := range views {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		issued, _ := time.Parse(time.RFC3339Nano, view.IssuedAt)
		expires, _ := time.Parse(time.RFC3339Nano, view.Spec.ExpiresAt)
		if view.RevokedAt != nil || now.Before(issued) || !now.Before(expires) {
			continue
		}
		base, err := s.workPolicySource(ctx, view.Spec)
		if err != nil {
			continue
		}
		raw, err := json.Marshal(struct {
			Version    int            `json:"version"`
			Spec       WorkPolicySpec `json:"spec"`
			Revision   int64          `json:"revision"`
			Digest     string         `json:"digest"`
			IssuedAt   string         `json:"issuedAt"`
			ObservedAt string         `json:"observedAt"`
			BaseCommit string         `json:"baseCommit"`
		}{1, view.Spec, view.Revision, view.Digest, view.IssuedAt, bindingTime(now), base})
		if err != nil {
			return nil, err
		}
		normalized, err := wire.ValidateAndNormalizeExecutionCommand("workPolicyOffer", raw)
		if err != nil {
			return nil, ErrInvalid
		}
		var offer execution.WorkPolicyOffer
		if err := json.Unmarshal(normalized, &offer); err != nil {
			return nil, ErrInvalid
		}
		offers = append(offers, offer)
	}
	return offers, nil
}
