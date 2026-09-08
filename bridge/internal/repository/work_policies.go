package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	execution "convenewire.dev/contracts/generated/go/execution"
	wire "convenewire.dev/contracts/generated/go/runtime"
)

var (
	ErrWorkPolicyDenied    = errors.New("development task is outside the owner work policy")
	ErrWorkPolicyAmbiguous = errors.New("multiple owner work policies match this development task")
	workPolicyID           = regexp.MustCompile(`^workpolicy_[A-Za-z0-9_-]{8,128}$`)
	workMemberID           = regexp.MustCompile(`^member_[A-Za-z0-9_-]{8,128}$`)
	workProfileID          = regexp.MustCompile(`^profile_[A-Za-z0-9_-]{8,128}$`)
	workAgentID            = regexp.MustCompile(`^agent_[A-Za-z0-9_-]{8,128}$`)
	workAuthorizationID    = regexp.MustCompile(`^op_[A-Za-z0-9_-]{8,128}$`)
)

// WorkPolicySpec is owner-local standing consent. It contains no executable,
// environment, credential, arbitrary path or reusable remote bearer token.
// Exact Runtime/verifier resolution and Central authority remain separate gates.
type WorkPolicySpec struct {
	PolicyID               string                                               `json:"policyId"`
	Alias                  string                                               `json:"alias"`
	BindingID              string                                               `json:"bindingId"`
	BindingRevision        int                                                  `json:"bindingRevision"`
	SourceFingerprint      string                                               `json:"sourceFingerprint"`
	RepositoryID           string                                               `json:"repositoryId"`
	SourceRef              string                                               `json:"sourceRef"`
	AgentID                string                                               `json:"agentId"`
	RoomIDs                []string                                             `json:"roomIds"`
	InitiatorMemberIDs     []string                                             `json:"initiatorMemberIds"`
	Operations             []execution.KindElement                              `json:"operations"`
	RuntimeProfile         execution.ExecutionGrantSummaryRuntimeProfile        `json:"runtimeProfile"`
	VerificationProfiles   []execution.ExecutionGrantSummaryVerificationProfile `json:"verificationProfiles"`
	ScopePolicy            execution.ExecutionGrantSummaryScopePolicy           `json:"scopePolicy"`
	MaxTaskDurationSeconds int64                                                `json:"maxTaskDurationSeconds"`
	MaxRunAttempts         int64                                                `json:"maxRunAttempts"`
	MaxConcurrency         int64                                                `json:"maxConcurrency"`
	ExpiresAt              string                                               `json:"expiresAt"`
}

type workPolicyRecord struct {
	Version  int            `json:"version"`
	Owner    BindingOwner   `json:"owner"`
	Spec     WorkPolicySpec `json:"spec"`
	IssuedAt string         `json:"issuedAt"`
}

type WorkPolicyView struct {
	Spec      WorkPolicySpec `json:"spec"`
	Revision  int64          `json:"revision"`
	Digest    string         `json:"digest"`
	IssuedAt  string         `json:"issuedAt"`
	RevokedAt *string        `json:"revokedAt"`
}

type workPolicyRevocation struct {
	PolicyID  string `json:"policyId"`
	Digest    string `json:"digest"`
	Revision  int64  `json:"revision"`
	RevokedAt string `json:"revokedAt"`
}

// Initiator and limits must come from the authenticated frozen Central task,
// never from Agent text. The request cannot create or update a standing policy.
type WorkGrantParent struct {
	AuthorizationID   string `json:"authorizationId"`
	PolicyID          string `json:"policyId"`
	PolicyDigest      string `json:"policyDigest"`
	Revision          int64  `json:"revision"`
	InitiatorMemberID string `json:"initiatorMemberId"`
	MaxRunAttempts    int64  `json:"maxRunAttempts"`
	MaxConcurrency    int64  `json:"maxConcurrency"`
}

func DecodeWorkPolicySpec(raw []byte) (WorkPolicySpec, error) {
	var spec WorkPolicySpec
	if len(raw) > 64<<10 {
		return spec, ErrLimit
	}
	canonical, err := wire.CanonicalExecutionJSON(raw)
	if err != nil {
		return spec, ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(canonical))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&spec) != nil {
		return spec, ErrInvalid
	}
	encoded, err := json.Marshal(spec)
	if err != nil {
		return spec, ErrInvalid
	}
	roundTrip, err := wire.CanonicalExecutionJSON(encoded)
	if err != nil || !bytes.Equal(roundTrip, canonical) {
		return spec, ErrInvalid
	}
	return spec, nil
}

func normalizeWorkPolicy(spec WorkPolicySpec) (WorkPolicySpec, error) {
	raw, err := json.Marshal(spec)
	if err != nil || len(raw) > 64<<10 {
		return spec, ErrInvalid
	}
	var cloned WorkPolicySpec
	if json.Unmarshal(raw, &cloned) != nil {
		return spec, ErrInvalid
	}
	spec = cloned
	if !workPolicyID.MatchString(spec.PolicyID) || !bindingID.MatchString(spec.BindingID) ||
		spec.BindingRevision != 1 || !sha256ID.MatchString(spec.SourceFingerprint) ||
		!repositoryID.MatchString(spec.RepositoryID) || !validGrantTarget(spec.SourceRef) ||
		!workAgentID.MatchString(spec.AgentID) || !validBindingAlias(spec.Alias) || !validBindingTime(spec.ExpiresAt) ||
		spec.MaxTaskDurationSeconds < 60 || spec.MaxTaskDurationSeconds > 86400 ||
		spec.MaxRunAttempts < 1 || spec.MaxRunAttempts > 100 || spec.MaxConcurrency < 1 || spec.MaxConcurrency > 16 {
		return spec, ErrInvalid
	}
	if !normalizePolicyIDs(spec.RoomIDs, grantRoomID, 64) || !normalizePolicyIDs(spec.InitiatorMemberIDs, workMemberID, 64) ||
		!workProfileID.MatchString(spec.RuntimeProfile.ProfileID) || spec.RuntimeProfile.Revision != 1 ||
		!sha256ID.MatchString(spec.RuntimeProfile.Digest) || spec.Operations == nil || len(spec.Operations) > 3 ||
		!slices.Contains(spec.Operations, execution.Prepare) || !slices.Contains(spec.Operations, execution.Capture) ||
		spec.VerificationProfiles == nil || len(spec.VerificationProfiles) > 16 {
		return spec, ErrInvalid
	}
	slices.Sort(spec.Operations)
	for i, operation := range spec.Operations {
		if (operation != execution.Prepare && operation != execution.Capture && operation != execution.Verify) ||
			(i > 0 && operation == spec.Operations[i-1]) {
			return spec, ErrInvalid
		}
	}
	slices.SortFunc(spec.VerificationProfiles, func(a, b execution.ExecutionGrantSummaryVerificationProfile) int {
		return strings.Compare(a.ProfileID, b.ProfileID)
	})
	for i, profile := range spec.VerificationProfiles {
		if !workProfileID.MatchString(profile.ProfileID) || profile.Revision != 1 || !sha256ID.MatchString(profile.Digest) ||
			!slices.Contains(spec.Operations, execution.Verify) || (i > 0 && profile.ProfileID == spec.VerificationProfiles[i-1].ProfileID) {
			return spec, ErrInvalid
		}
	}
	policy, err := freezeScopePolicy(execution.ManifestScopePolicy(spec.ScopePolicy))
	if err != nil || policy.Access != execution.IsolatedWrite {
		return spec, ErrInvalid
	}
	spec.ScopePolicy = execution.ExecutionGrantSummaryScopePolicy(policy)
	return spec, nil
}

func normalizePolicyIDs(ids []string, pattern *regexp.Regexp, limit int) bool {
	if len(ids) == 0 || len(ids) > limit {
		return false
	}
	slices.Sort(ids)
	for i, id := range ids {
		if !pattern.MatchString(id) || (i > 0 && id == ids[i-1]) {
			return false
		}
	}
	return true
}

func (s *BindingStore) CreateWorkPolicy(ctx context.Context, spec WorkPolicySpec, now time.Time) (WorkPolicyView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return WorkPolicyView{}, err
	}
	normalized, err := normalizeWorkPolicy(spec)
	if err != nil || now.IsZero() || !validBindingTime(bindingTime(now)) {
		return WorkPolicyView{}, ErrInvalid
	}
	expires, _ := time.Parse(time.RFC3339Nano, normalized.ExpiresAt)
	if !now.Before(expires) || expires.Sub(now) > 90*24*time.Hour {
		return WorkPolicyView{}, ErrGrantExpired
	}
	previous, view, err := s.getWorkPolicy(spec.PolicyID)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return WorkPolicyView{}, err
	}
	if err == nil {
		if view.RevokedAt != nil {
			return WorkPolicyView{}, ErrGrantRevoked
		}
		previousIssued, _ := time.Parse(time.RFC3339Nano, previous.IssuedAt)
		if !reflect.DeepEqual(previous.Spec, normalized) || now.Before(previousIssued) {
			return WorkPolicyView{}, ErrConflict
		}
	}
	if _, err := s.workPolicySource(ctx, normalized); err != nil {
		return WorkPolicyView{}, err
	}
	if previous.IssuedAt != "" {
		return view, durablefs.SyncParent(s.workPolicyPath(spec.PolicyID, false))
	}
	views, err := s.listWorkPolicies()
	if err != nil {
		return WorkPolicyView{}, err
	}
	if len(views) >= 64 {
		return WorkPolicyView{}, ErrLimit
	}
	record := workPolicyRecord{Version: 1, Owner: s.owner, Spec: normalized, IssuedAt: bindingTime(now)}
	raw, _ := json.Marshal(record)
	if err := s.check(); err != nil {
		return WorkPolicyView{}, err
	}
	if err := writeExclusive(s.workPolicyPath(spec.PolicyID, false), raw); err != nil {
		return WorkPolicyView{}, err
	}
	_, view, err = s.getWorkPolicy(spec.PolicyID)
	return view, err
}

func (s *BindingStore) ListWorkPolicies() ([]WorkPolicyView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return nil, err
	}
	return s.listWorkPolicies()
}

func (s *BindingStore) RevokeWorkPolicy(id string, revision int64, expectedDigest string, now time.Time) (WorkPolicyView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return WorkPolicyView{}, err
	}
	record, view, err := s.getWorkPolicy(id)
	if err != nil {
		return WorkPolicyView{}, err
	}
	if revision != 1 || expectedDigest != view.Digest {
		return WorkPolicyView{}, ErrConflict
	}
	if view.RevokedAt != nil {
		return view, durablefs.SyncParent(s.workPolicyPath(id, true))
	}
	issued, _ := time.Parse(time.RFC3339Nano, record.IssuedAt)
	if now.IsZero() || !validBindingTime(bindingTime(now)) || now.Before(issued) {
		return WorkPolicyView{}, ErrInvalid
	}
	raw, _ := json.Marshal(workPolicyRevocation{PolicyID: id, Revision: 2, Digest: expectedDigest, RevokedAt: bindingTime(now)})
	if err := writeExclusive(s.workPolicyPath(id, true), raw); err != nil {
		return WorkPolicyView{}, err
	}
	_, view, err = s.getWorkPolicy(id)
	return view, err
}

// SelectWorkPolicy does not mint authority. The returned exact local source
// commit is only an offer for Central to freeze into a task/plan negotiation.
func (s *BindingStore) SelectWorkPolicy(ctx context.Context, agent, room, initiator string, now time.Time) (WorkPolicyView, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return WorkPolicyView{}, "", err
	}
	view, err := s.selectWorkPolicy(agent, room, initiator, now)
	if err != nil {
		return WorkPolicyView{}, "", err
	}
	base, err := s.workPolicySource(ctx, view.Spec)
	return view, base, err
}

func (s *BindingStore) selectWorkPolicy(agent, room, initiator string, now time.Time) (WorkPolicyView, error) {
	views, err := s.listWorkPolicies()
	if err != nil {
		return WorkPolicyView{}, err
	}
	var selected []WorkPolicyView
	for _, view := range views {
		expires, _ := time.Parse(time.RFC3339Nano, view.Spec.ExpiresAt)
		issued, _ := time.Parse(time.RFC3339Nano, view.IssuedAt)
		if view.RevokedAt == nil && !now.IsZero() && !now.Before(issued) && now.Before(expires) &&
			view.Spec.AgentID == agent && slices.Contains(view.Spec.RoomIDs, room) && slices.Contains(view.Spec.InitiatorMemberIDs, initiator) {
			selected = append(selected, view)
		}
	}
	if len(selected) == 0 {
		return WorkPolicyView{}, ErrWorkPolicyDenied
	}
	if len(selected) != 1 {
		return WorkPolicyView{}, ErrWorkPolicyAmbiguous
	}
	return selected[0], nil
}

func (s *BindingStore) DeriveWorkTaskGrant(ctx context.Context, spec TaskGrantSpec, parent WorkGrantParent, now time.Time) (TaskGrantView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.check(); err != nil {
		return TaskGrantView{}, err
	}
	requestedID := spec.GrantID
	spec.GrantID = "grant_work_validation"
	var normalizeErr error
	spec, normalizeErr = normalizeTaskGrant(spec, s.owner, bindingTime(now))
	if normalizeErr != nil {
		return TaskGrantView{}, normalizeErr
	}
	spec.GrantID = requestedID
	view, err := s.selectWorkPolicy(spec.AgentID, spec.RoomID, parent.InitiatorMemberID, now)
	if err != nil {
		return TaskGrantView{}, err
	}
	if view.Spec.PolicyID != parent.PolicyID || view.Digest != parent.PolicyDigest || parent.Revision != 1 ||
		!workGrantWithinPolicy(spec, parent, view.Spec, now) {
		return TaskGrantView{}, ErrWorkPolicyDenied
	}
	if spec.GrantID != "" && spec.GrantID != WorkTaskGrantID(parent) {
		return TaskGrantView{}, ErrConflict
	}
	spec.GrantID = WorkTaskGrantID(parent)
	// Exact replay returns its immutable existing grant even if the source ref
	// advanced after issuance. New grants must freeze the current offered base.
	_, previous, lookupErr := s.getTaskGrant(spec.GrantID)
	if lookupErr != nil && !errors.Is(lookupErr, os.ErrNotExist) {
		return TaskGrantView{}, lookupErr
	}
	if lookupErr == nil && previous.Summary.RevokedAt != nil {
		return TaskGrantView{}, ErrGrantRevoked
	}
	base, err := s.workPolicySource(ctx, view.Spec)
	if err != nil {
		return TaskGrantView{}, err
	}
	if lookupErr != nil && spec.BaseCommit != base {
		return TaskGrantView{}, ErrChanged
	}
	return s.issueTaskGrantLocked(ctx, spec, &parent, now)
}

func workGrantWithinPolicy(spec TaskGrantSpec, parent WorkGrantParent, policy WorkPolicySpec, now time.Time) bool {
	expires, err := time.Parse(time.RFC3339Nano, spec.ExpiresAt)
	policyExpires, _ := time.Parse(time.RFC3339Nano, policy.ExpiresAt)
	if err != nil || !workAuthorizationID.MatchString(parent.AuthorizationID) || now.IsZero() || !now.Before(expires) || expires.After(policyExpires) ||
		expires.Sub(now) > time.Duration(policy.MaxTaskDurationSeconds)*time.Second ||
		spec.BindingID != policy.BindingID || spec.BindingRevision != policy.BindingRevision ||
		spec.SourceFingerprint != policy.SourceFingerprint || spec.RepositoryID != policy.RepositoryID ||
		spec.AgentID != policy.AgentID || !slices.Contains(policy.RoomIDs, spec.RoomID) ||
		!slices.Contains(policy.InitiatorMemberIDs, parent.InitiatorMemberID) || spec.RuntimeProfile != policy.RuntimeProfile ||
		parent.MaxRunAttempts < 1 || parent.MaxRunAttempts > policy.MaxRunAttempts ||
		parent.MaxConcurrency < 1 || parent.MaxConcurrency > policy.MaxConcurrency || len(spec.IntegrationTargets) != 0 ||
		!scopeWithinGrant(execution.ManifestScopePolicy(spec.ScopePolicy), execution.ManifestScopePolicy(policy.ScopePolicy)) {
		return false
	}
	// Required policy verification cannot be dropped by a narrower request.
	if !reflect.DeepEqual(spec.VerificationProfiles, policy.VerificationProfiles) {
		return false
	}
	for _, op := range spec.Operations {
		if !slices.Contains(policy.Operations, op) {
			return false
		}
	}
	return slices.Contains(spec.Operations, execution.Prepare) && slices.Contains(spec.Operations, execution.Capture) &&
		(len(spec.VerificationProfiles) == 0 || slices.Contains(spec.Operations, execution.Verify))
}

// WorkTaskGrantID binds the immutable authorization request before plan compilation.
func WorkTaskGrantID(parent WorkGrantParent) string {
	if !workAuthorizationID.MatchString(parent.AuthorizationID) || !workPolicyID.MatchString(parent.PolicyID) || !sha256ID.MatchString(parent.PolicyDigest) || !workMemberID.MatchString(parent.InitiatorMemberID) || parent.Revision != 1 {
		return ""
	}
	// Identity precedes plan compilation, whose digest itself contains grantId.
	// A changed task/plan under this authorization ID conflicts with the existing
	// immutable issuance instead of creating a second grant.
	raw, err := json.Marshal(struct {
		AuthorizationID   string `json:"authorizationId"`
		PolicyID          string `json:"policyId"`
		PolicyDigest      string `json:"policyDigest"`
		InitiatorMemberID string `json:"initiatorMemberId"`
	}{parent.AuthorizationID, parent.PolicyID, parent.PolicyDigest, parent.InitiatorMemberID})
	if err != nil {
		return ""
	}
	canonical, err := wire.CanonicalExecutionJSON(raw)
	if err != nil {
		return ""
	}
	return "grant_work_" + digest(string(canonical))
}

func (s *BindingStore) workPolicySource(ctx context.Context, spec WorkPolicySpec) (string, error) {
	record, binding, err := s.get(spec.BindingID)
	if err != nil {
		return "", err
	}
	if binding.RevokedAt != nil {
		return "", ErrBindingRevoked
	}
	if binding.Revision != spec.BindingRevision || binding.RepositoryID != spec.RepositoryID ||
		binding.SourceFingerprint != spec.SourceFingerprint {
		return "", ErrWorkPolicyDenied
	}
	if s.git.executable == "" {
		return "", ErrIncomplete
	}
	current, err := InspectSource(ctx, s.git.executable, record.Source.Root, record.AllowedRoots, s.git.limits)
	if err != nil {
		return "", err
	}
	if current != record.Source {
		return "", ErrChanged
	}
	// One exact concrete branch, without symbolic aliases or ref expressions.
	value, err := s.git.text(ctx, current.Root, "for-each-ref", "--format=%(refname) %(objectname) %(objecttype) %(symref)", "--", spec.SourceRef)
	fields := strings.Fields(value)
	if err != nil || len(fields) != 3 || fields[0] != spec.SourceRef || !objectID.MatchString(fields[1]) || fields[2] != "commit" {
		return "", ErrChanged
	}
	return fields[1], s.check()
}

func (s *BindingStore) getWorkPolicy(id string) (workPolicyRecord, WorkPolicyView, error) {
	var record workPolicyRecord
	if !workPolicyID.MatchString(id) {
		return record, WorkPolicyView{}, ErrInvalid
	}
	if err := readBindingJSON(s.workPolicyPath(id, false), &record); err != nil {
		return record, WorkPolicyView{}, err
	}
	normalized, err := normalizeWorkPolicy(record.Spec)
	expires, _ := time.Parse(time.RFC3339Nano, record.Spec.ExpiresAt)
	issued, timeErr := time.Parse(time.RFC3339Nano, record.IssuedAt)
	if err != nil || record.Version != 1 || record.Owner != s.owner || record.Spec.PolicyID != id ||
		!reflect.DeepEqual(normalized, record.Spec) || timeErr != nil || !validBindingTime(record.IssuedAt) ||
		!issued.Before(expires) || expires.Sub(issued) > 90*24*time.Hour {
		return record, WorkPolicyView{}, ErrChanged
	}
	raw, _ := json.Marshal(record)
	hash, err := wire.ExecutionDigest(raw)
	if err != nil {
		return record, WorkPolicyView{}, ErrChanged
	}
	view := WorkPolicyView{Spec: record.Spec, Revision: 1, Digest: hash, IssuedAt: record.IssuedAt}
	var revoked workPolicyRevocation
	if err := readBindingJSON(s.workPolicyPath(id, true), &revoked); err == nil {
		revokedTime, _ := time.Parse(time.RFC3339Nano, revoked.RevokedAt)
		if revoked.PolicyID != id || revoked.Digest != hash || revoked.Revision != 2 ||
			!validBindingTime(revoked.RevokedAt) || revokedTime.Before(issued) {
			return record, WorkPolicyView{}, ErrChanged
		}
		view.Revision, view.RevokedAt = 2, &revoked.RevokedAt
	} else if !errors.Is(err, os.ErrNotExist) {
		return record, WorkPolicyView{}, err
	}
	return record, view, nil
}

func (s *BindingStore) listWorkPolicies() ([]WorkPolicyView, error) {
	entries, err := os.ReadDir(s.workPolicyRoot)
	if err != nil {
		return nil, err
	}
	if len(entries) > 256 {
		return nil, ErrLimit
	}
	views := []WorkPolicyView{}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".pending-") {
			continue
		}
		id := strings.TrimSuffix(strings.TrimSuffix(name, ".json"), ".revoked")
		if !workPolicyID.MatchString(id) || entry.IsDir() || !strings.HasSuffix(name, ".json") {
			return nil, ErrChanged
		}
		_, view, err := s.getWorkPolicy(id)
		if err != nil {
			return nil, err
		}
		if !strings.HasSuffix(name, ".revoked.json") {
			views = append(views, view)
		}
	}
	if len(views) > 64 {
		return nil, ErrLimit
	}
	return views, nil
}

func (s *BindingStore) workPolicyPath(id string, revoked bool) string {
	if revoked {
		return filepath.Join(s.workPolicyRoot, id+".revoked.json")
	}
	return filepath.Join(s.workPolicyRoot, id+".json")
}
