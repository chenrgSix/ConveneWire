package admission

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/repository"
	execution "convenewire.dev/contracts/generated/go/execution"
)

func workResourcesFixture(t *testing.T) (*GovernedAdmissionResources, execution.WorkAuthorization, time.Time) {
	t.Helper()
	_, git, cfg, credential, agents := governedResourcesFixture(t)
	r, err := OpenGovernedAdmissionResources(context.Background(), cfg, credential, git, agents)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	now := time.Date(2026, 9, 8, 0, 0, 0, 123, time.UTC)
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	runResourceGit(t, git, root, "init", "-b", "main")
	runResourceGit(t, git, root, "config", "user.name", "ConveneWire Test")
	runResourceGit(t, git, root, "config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(root, "base.txt"), []byte("base"), 0o600); err != nil {
		t.Fatal(err)
	}
	runResourceGit(t, git, root, "add", "base.txt")
	runResourceGit(t, git, root, "commit", "-m", "base")
	base := strings.TrimSpace(runResourceGit(t, git, root, "rev-parse", "HEAD"))
	binding, err := r.bindings.Bind(context.Background(), repository.BindRepository{BindingID: "repobind_work0001",
		RepositoryID: "repo_work0001", Alias: "Work source", SelectedRoot: root, AllowedRoots: []string{root}}, now)
	if err != nil {
		t.Fatal(err)
	}
	agentID := "agent_runtime0001"
	agent := agents[agentID]
	digest, err := CodexConfigurationDigest(agent, agentID, "convenewire_governed")
	if err != nil {
		t.Fatal(err)
	}
	profile, err := r.profiles.registerCodex(context.Background(), CodexRegistration{Spec: RuntimeProfileSpec{
		ProfileID: "profile_work0001", Revision: 1, AgentID: agentID, RuntimeKind: CodexRuntimeKind,
		ConfigurationDigest: digest, PermissionProfile: "convenewire_governed"}, Agent: agent}, now, fixedProber("convenewire_governed"))
	if err != nil {
		t.Fatal(err)
	}
	policy := repository.WorkPolicySpec{PolicyID: "workpolicy_resources01", Alias: "Development", BindingID: binding.BindingID,
		BindingRevision: binding.Revision, SourceFingerprint: binding.SourceFingerprint, RepositoryID: binding.RepositoryID,
		SourceRef: "refs/heads/main", AgentID: agentID, RoomIDs: []string{"room_work0001"}, InitiatorMemberIDs: []string{credential.OwnerMemberID},
		Operations:             []execution.KindElement{execution.Capture, execution.Prepare},
		RuntimeProfile:         execution.ExecutionGrantSummaryRuntimeProfile{ProfileID: profile.Spec.ProfileID, Revision: 1, Digest: profile.Digest},
		VerificationProfiles:   []execution.ExecutionGrantSummaryVerificationProfile{},
		ScopePolicy:            execution.ExecutionGrantSummaryScopePolicy{Access: execution.IsolatedWrite, AllowedPaths: []string{"src"}, ForbiddenPaths: []string{}},
		MaxTaskDurationSeconds: 3600, MaxRunAttempts: 3, MaxConcurrency: 1, ExpiresAt: now.Add(24 * time.Hour).Format(time.RFC3339Nano)}
	view, err := r.bindings.CreateWorkPolicy(context.Background(), policy, now)
	if err != nil {
		t.Fatal(err)
	}
	parent := repository.WorkGrantParent{AuthorizationID: "op_work_resources01", PolicyID: policy.PolicyID, PolicyDigest: view.Digest, Revision: 1,
		InitiatorMemberID: credential.OwnerMemberID, MaxRunAttempts: 2, MaxConcurrency: 1}
	spec := repository.TaskGrantSpec{GrantID: repository.WorkTaskGrantID(parent), BindingID: binding.BindingID, BindingRevision: binding.Revision,
		SourceFingerprint: binding.SourceFingerprint, RepositoryID: binding.RepositoryID, BaseCommit: base, PlanID: "plan_work_resources01", PlanRevision: 1,
		PlanDigest: strings.Repeat("a", 64), NodeKey: "build", RoomID: policy.RoomIDs[0], TaskID: "task_work_resources01", DefinitionRevision: 1, CriteriaRevision: 1,
		AgentID: agentID, ExpiresAt: now.Add(time.Hour).Format(time.RFC3339Nano), Operations: policy.Operations, RuntimeProfile: policy.RuntimeProfile,
		VerificationProfiles: policy.VerificationProfiles, ScopePolicy: policy.ScopePolicy, IntegrationTargets: []execution.ExecutionGrantSummaryIntegrationTarget{}}
	raw, _ := json.Marshal(map[string]any{"version": 1, "deviceId": credential.DeviceID, "parent": parent, "spec": spec,
		"requestedAt": now.Format(time.RFC3339Nano), "deadline": now.Add(time.Minute).Format(time.RFC3339Nano)})
	var request execution.WorkAuthorization
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	return r, request, now
}

func TestWorkPolicyResourcesDerivePublishReplayAndRevoke(t *testing.T) {
	r, request, now := workResourcesFixture(t)
	ctx := context.Background()
	offers, err := r.ReadyWorkPolicies(ctx, now)
	if err != nil || len(offers[request.Spec.AgentID]) != 1 || offers[request.Spec.AgentID][0].BaseCommit != request.Spec.BaseCommit {
		t.Fatalf("offers: %#v %v", offers, err)
	}
	if ready, err := r.ReadyAgentGrants(ctx, now); err != nil || len(ready) != 0 {
		t.Fatal("offer issued a grant", err)
	}
	first, err := r.AuthorizeWork(ctx, request, now)
	if err != nil || first.Status != "authorized" || first.Grant == nil {
		t.Fatalf("authorize: %#v %v", first, err)
	}
	replay, err := r.AuthorizeWork(ctx, request, now.Add(time.Second))
	if err != nil || replay.Grant == nil || replay.RequestDigest != first.RequestDigest || replay.Grant.Grant != first.Grant.Grant {
		t.Fatal("exact replay changed", err)
	}
	if ready, err := r.ReadyAgentGrants(ctx, now); err != nil || len(ready[request.Spec.AgentID]) != 1 {
		t.Fatal("derived grant was not publishable", err)
	}
	if _, err := r.bindings.RevokeWorkPolicy(request.Parent.PolicyID, 1, request.Parent.PolicyDigest, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	}
	if ready, err := r.ReadyAgentGrants(ctx, now.Add(3*time.Second)); err != nil || len(ready) != 0 {
		t.Fatal("revoked grant remained publishable", err)
	}
	if offers, err := r.ReadyWorkPolicies(ctx, now.Add(3*time.Second)); err != nil || len(offers) != 0 {
		t.Fatal("revoked policy remained offered", err)
	}
	denied, err := r.AuthorizeWork(ctx, request, now.Add(3*time.Second))
	if err != nil || denied.Status != "denied" {
		t.Fatal("revoked request authorized", err)
	}
}

func TestWorkPolicyResourcesRejectChangedIdentityDeadlineAndScope(t *testing.T) {
	r, request, now := workResourcesFixture(t)
	for name, mutate := range map[string]func(*execution.WorkAuthorization){
		"device":   func(v *execution.WorkAuthorization) { v.DeviceID = "device_other0001" },
		"future":   func(v *execution.WorkAuthorization) { v.RequestedAt = now.Add(time.Second).Format(time.RFC3339Nano) },
		"deadline": func(v *execution.WorkAuthorization) { v.Deadline = now.Add(time.Hour).Format(time.RFC3339Nano) },
		"scope":    func(v *execution.WorkAuthorization) { v.Spec.ScopePolicy.AllowedPaths = []string{"secrets"} },
		"profile":  func(v *execution.WorkAuthorization) { v.Spec.RuntimeProfile.Digest = strings.Repeat("f", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			raw, _ := json.Marshal(request)
			var v execution.WorkAuthorization
			_ = json.Unmarshal(raw, &v)
			mutate(&v)
			receipt, err := r.AuthorizeWork(context.Background(), v, now)
			if err == nil && receipt.Status != "denied" {
				t.Fatal("changed request authorized")
			}
		})
	}
	if grants, err := r.bindings.ListTaskGrants(); err != nil || len(grants) != 0 {
		t.Fatal("negative request persisted a grant", err)
	}
}
