package console

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"slices"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/repository"
	"convenewire.dev/bridge/internal/verification"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

type WorkPolicyInput struct {
	Spec    json.RawMessage `json:"spec"`
	Confirm bool            `json:"confirm"`
}

func createWorkPolicy(ctx context.Context, cfg config.Config, credential pairing.Credential,
	input WorkPolicyInput, now time.Time) (repository.WorkPolicyView, error) {
	if !input.Confirm {
		return repository.WorkPolicyView{}, repository.ErrInvalid
	}
	spec, err := repository.DecodeWorkPolicySpec(input.Spec)
	if err != nil || wire.ValidateExecutionCommand("workPolicySpec", input.Spec) != nil {
		return repository.WorkPolicyView{}, repository.ErrInvalid
	}
	selected, err := identity.LookupConfigured(cfg.DataDir, cfg.Agents, spec.AgentID)
	if err != nil {
		return repository.WorkPolicyView{}, err
	}
	if selected.OwnerPrivateOutput || spec.ScopePolicy.RequirePreventivePathEnforcement {
		return repository.WorkPolicyView{}, fmt.Errorf("Selected Agent or path enforcement is unavailable")
	}
	git, err := exec.LookPath("git")
	if err != nil {
		return repository.WorkPolicyView{}, fmt.Errorf("Git is unavailable on this device")
	}
	stores, err := openGovernedOwnerStoresWithGit(ctx, cfg, credential, git)
	if err != nil {
		return repository.WorkPolicyView{}, err
	}
	defer stores.close()
	if _, err = stores.runtimeProfiles.ResolveRuntime(spec.RuntimeProfile, spec.AgentID, selected); err != nil {
		return repository.WorkPolicyView{}, err
	}
	for _, profile := range spec.VerificationProfiles {
		if _, err = stores.verificationProfiles.Resolve(verification.Reference{ProfileID: profile.ProfileID,
			Revision: profile.Revision, Digest: profile.Digest}); err != nil {
			return repository.WorkPolicyView{}, err
		}
	}
	policies, err := stores.bindings.ListWorkPolicies()
	if err != nil {
		return repository.WorkPolicyView{}, err
	}
	for _, policy := range policies {
		expiry, _ := time.Parse(time.RFC3339Nano, policy.Spec.ExpiresAt)
		if policy.Spec.PolicyID == spec.PolicyID || policy.RevokedAt != nil || !now.Before(expiry) || policy.Spec.AgentID != spec.AgentID {
			continue
		}
		if intersects(spec.RoomIDs, policy.Spec.RoomIDs) && intersects(spec.InitiatorMemberIDs, policy.Spec.InitiatorMemberIDs) {
			return repository.WorkPolicyView{}, fmt.Errorf("An active policy already covers this Agent, Room and initiator; revoke it before replacing it")
		}
	}
	return stores.bindings.CreateWorkPolicy(ctx, spec, now)
}

func intersects(left, right []string) bool {
	for _, value := range left {
		if slices.Contains(right, value) {
			return true
		}
	}
	return false
}

func revokeWorkPolicy(ctx context.Context, cfg config.Config, credential pairing.Credential,
	id string, input GovernedGrantRevocationInput, now time.Time) (repository.WorkPolicyView, error) {
	if !input.Confirm || input.ExpectedRevision != 1 || input.ExpectedDigest == "" {
		return repository.WorkPolicyView{}, repository.ErrInvalid
	}
	// Revocation needs no working Git or Runtime executable.
	stores, err := openGovernedOwnerStores(ctx, cfg, credential)
	if err != nil {
		return repository.WorkPolicyView{}, err
	}
	defer stores.close()
	return stores.bindings.RevokeWorkPolicy(id, input.ExpectedRevision, input.ExpectedDigest, now)
}

func (s *Service) createWorkPolicy(response http.ResponseWriter, request *http.Request) {
	var input WorkPolicyInput
	if err := decodeJSON(request, &input); err != nil || !input.Confirm {
		writeError(response, http.StatusBadRequest, "Confirm the exact local work policy before saving")
		return
	}
	if err := wire.ValidateExecutionCommand("workPolicySpec", input.Spec); err != nil {
		writeError(response, http.StatusBadRequest, publicError(err))
		return
	}
	s.mutateWorkPolicy(response, func(ctx context.Context, cfg config.Config, credential pairing.Credential) (repository.WorkPolicyView, error) {
		return s.dependencies.CreateWorkPolicy(ctx, cfg, credential, input, time.Now().UTC())
	})
}

func (s *Service) revokeWorkPolicy(response http.ResponseWriter, request *http.Request) {
	var input GovernedGrantRevocationInput
	if err := decodeJSON(request, &input); err != nil || !input.Confirm || input.ExpectedRevision != 1 || input.ExpectedDigest == "" {
		writeError(response, http.StatusBadRequest, "Confirm the exact local work policy revocation")
		return
	}
	s.mutateWorkPolicy(response, func(ctx context.Context, cfg config.Config, credential pairing.Credential) (repository.WorkPolicyView, error) {
		return s.dependencies.RevokeWorkPolicy(ctx, cfg, credential, request.PathValue("policyId"), input, time.Now().UTC())
	})
}

func (s *Service) mutateWorkPolicy(response http.ResponseWriter,
	mutate func(context.Context, config.Config, pairing.Credential) (repository.WorkPolicyView, error)) {
	s.mu.Lock()
	if s.governedMutation || s.closed || s.configuration == nil || s.credential == nil || s.owner == nil {
		s.mu.Unlock()
		writeError(response, http.StatusConflict, "Local policy mutation is unavailable")
		return
	}
	s.governedMutation = true
	wasRunning := s.bridgeCancel != nil || s.state.BridgeRunning
	s.mu.Unlock()
	if wasRunning {
		s.StopBridge()
	}
	ctx, cfg, credential, err := s.governedOwnerContext(true)
	var view repository.WorkPolicyView
	if err == nil {
		view, err = mutate(ctx, cfg, credential)
	}
	s.mu.Lock()
	s.governedMutation = false
	s.governedStateLoaded = false
	s.mu.Unlock()
	var restartErr error
	if wasRunning {
		_, restartErr = s.StartBridge()
	}
	if err != nil {
		writeError(response, http.StatusConflict, publicError(err))
		return
	}
	// Preserve the committed receipt if reconnect fails; clients must not silently retry a new policy.
	writeJSON(response, http.StatusOK, struct {
		Policy            repository.WorkPolicyView `json:"policy"`
		BridgeRestarted   bool                      `json:"bridgeRestarted"`
		ReconnectRequired bool                      `json:"reconnectRequired"`
	}{Policy: view, BridgeRestarted: wasRunning && restartErr == nil, ReconnectRequired: restartErr != nil})
}
