package admission

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"convenewire.dev/bridge/internal/repository"
	"convenewire.dev/bridge/internal/verification"
	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

// ReadyWorkPolicies is metadata, not permission to start a Runtime. It resolves
// the same executable/profile fingerprints used by the exact grant path.
func (r *GovernedAdmissionResources) ReadyWorkPolicies(ctx context.Context, now time.Time) (map[string][]execution.WorkPolicyOffer, error) {
	ready := map[string][]execution.WorkPolicyOffer{}
	if r == nil || now.IsZero() {
		return nil, ErrAdmissionInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.bindings == nil || r.profiles == nil || r.verifiers == nil {
		return nil, ErrAdmissionInvalid
	}
	offers, err := r.bindings.WorkPolicyOffers(ctx, now)
	if err != nil {
		return nil, err
	}
	if _, err := r.profiles.List(); err != nil {
		return nil, err
	}
	if _, err := r.verifiers.List(); err != nil {
		return nil, err
	}
	if r.coordinator == nil || r.preparer == nil {
		return ready, nil
	}
	for _, offer := range offers {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		raw, _ := json.Marshal(offer.Spec)
		policy, err := repository.DecodeWorkPolicySpec(raw)
		if err != nil {
			return nil, ErrAdmissionInvalid
		}
		if r.workProfilesReady(policy.AgentID, policy.RuntimeProfile, policy.VerificationProfiles,
			policy.ScopePolicy.RequirePreventivePathEnforcement) {
			ready[policy.AgentID] = append(ready[policy.AgentID], offer)
		}
	}
	return ready, nil
}

func (r *GovernedAdmissionResources) workProfilesReady(agentID string,
	profile execution.ExecutionGrantSummaryRuntimeProfile,
	verifiers []execution.ExecutionGrantSummaryVerificationProfile, preventive bool) bool {
	agent, exists := r.agents[agentID]
	if !exists || agent.OwnerPrivateOutput || preventive || r.coordinator == nil || r.preparer == nil {
		return false
	}
	if _, err := r.profiles.ResolveRuntime(profile, agentID, agent); err != nil {
		return false
	}
	for _, profile := range verifiers {
		if _, err := r.verifiers.Resolve(verification.Reference{ProfileID: profile.ProfileID,
			Revision: profile.Revision, Digest: profile.Digest}); err != nil {
			return false
		}
	}
	return true
}

// AuthorizeWork is called only by the authenticated, current-epoch Bridge
// connection. It creates a local exact grant, never a plan, Run or process.
func (r *GovernedAdmissionResources) AuthorizeWork(ctx context.Context, request execution.WorkAuthorization,
	now time.Time) (execution.WorkAuthorizationReceipt, error) {
	if r == nil || now.IsZero() {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	raw, err := json.Marshal(request)
	if err != nil || wire.ValidateExecutionCommand("workAuthorization", raw) != nil {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	digest, err := wire.ExecutionDigest(raw)
	if err != nil {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.bindings == nil || r.profiles == nil || r.verifiers == nil || request.DeviceID != r.owner.DeviceID {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	receipt := execution.WorkAuthorizationReceipt{Version: 1, DeviceID: r.owner.DeviceID,
		AuthorizationID: request.Parent.AuthorizationID, RequestDigest: digest, Status: "denied",
		Reason: "unavailable", ObservedAt: now.UTC().Format(time.RFC3339Nano)}
	requestedAt, _ := time.Parse(time.RFC3339Nano, request.RequestedAt)
	deadline, _ := time.Parse(time.RFC3339Nano, request.Deadline)
	expiresAt, _ := time.Parse(time.RFC3339Nano, request.Spec.ExpiresAt)
	if now.Before(requestedAt) || !now.Before(deadline) || !deadline.After(requestedAt) ||
		deadline.Sub(requestedAt) > 5*time.Minute || deadline.After(expiresAt) {
		receipt.Reason = "expired"
		return receipt, nil
	}
	rawSpec, _ := json.Marshal(request.Spec)
	spec, err := repository.DecodeTaskGrantSpec(rawSpec)
	if err != nil {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	parentRaw, _ := json.Marshal(request.Parent)
	var parent repository.WorkGrantParent
	if json.Unmarshal(parentRaw, &parent) != nil {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	if !r.workProfilesReady(spec.AgentID, spec.RuntimeProfile, spec.VerificationProfiles,
		spec.ScopePolicy.RequirePreventivePathEnforcement) {
		receipt.Reason = "profile_unavailable"
		return receipt, nil
	}
	if ctx.Err() != nil {
		return execution.WorkAuthorizationReceipt{}, ctx.Err()
	}
	grant, err := r.bindings.DeriveWorkTaskGrant(ctx, spec, parent, now)
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrWorkPolicyDenied), errors.Is(err, repository.ErrGrantDenied):
			receipt.Reason = "outside_policy"
		case errors.Is(err, repository.ErrWorkPolicyAmbiguous):
			receipt.Reason = "ambiguous_policy"
		case errors.Is(err, repository.ErrGrantExpired):
			receipt.Reason = "expired"
		case errors.Is(err, repository.ErrGrantRevoked), errors.Is(err, repository.ErrBindingRevoked):
			receipt.Reason = "revoked"
		case errors.Is(err, repository.ErrChanged):
			receipt.Reason = "source_changed"
		case errors.Is(err, repository.ErrConflict):
			receipt.Reason = "conflict"
		}
		if ctx.Err() != nil {
			return execution.WorkAuthorizationReceipt{}, ctx.Err()
		}
		return receipt, nil
	}
	grantRaw, _ := json.Marshal(grant.Summary)
	if json.Unmarshal(grantRaw, &receipt.Grant) != nil {
		return execution.WorkAuthorizationReceipt{}, ErrAdmissionInvalid
	}
	receipt.Status, receipt.Reason = "authorized", "authorized"
	return receipt, nil
}
