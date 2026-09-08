package repository

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	execution "convenewire.dev/contracts/generated/go/execution"
)

func workPolicyFixture(t *testing.T, format string) (*fixture, *BindingStore, WorkPolicySpec, TaskGrantSpec, execution.GovernedExecutionManifest) {
	t.Helper()
	f, store, spec, manifest := taskGrantFixture(t, format)
	spec.GrantID = ""
	policy := WorkPolicySpec{PolicyID: "workpolicy_development01", Alias: "日常开发", BindingID: spec.BindingID,
		BindingRevision: spec.BindingRevision, SourceFingerprint: spec.SourceFingerprint, RepositoryID: spec.RepositoryID,
		SourceRef: "refs/heads/main", AgentID: spec.AgentID, RoomIDs: []string{spec.RoomID},
		InitiatorMemberIDs: []string{store.owner.OwnerMemberID}, Operations: slices.Clone(spec.Operations),
		RuntimeProfile: spec.RuntimeProfile, VerificationProfiles: slices.Clone(spec.VerificationProfiles), ScopePolicy: spec.ScopePolicy,
		MaxTaskDurationSeconds: 3600, MaxRunAttempts: 3, MaxConcurrency: 2, ExpiresAt: bindingTime(bindingNow.Add(24 * time.Hour))}
	return f, store, policy, spec, manifest
}

func createWorkPolicy(t *testing.T, store *BindingStore, spec WorkPolicySpec) (WorkPolicyView, WorkGrantParent) {
	t.Helper()
	view, err := store.CreateWorkPolicy(context.Background(), spec, bindingNow)
	if err != nil {
		t.Fatal(err)
	}
	return view, WorkGrantParent{AuthorizationID: "op_work_first0001", PolicyID: view.Spec.PolicyID, PolicyDigest: view.Digest, Revision: 1,
		InitiatorMemberID: store.owner.OwnerMemberID, MaxRunAttempts: 2, MaxConcurrency: 1}
}

func TestWorkPolicyDerivesTwoExactTasksAndSurvivesRestart(t *testing.T) {
	for _, format := range []string{"sha1", "sha256"} {
		t.Run(format, func(t *testing.T) {
			f, store, policy, spec, m := workPolicyFixture(t, format)
			before, _ := json.Marshal(policy)
			view, parent := createWorkPolicy(t, store, policy)
			after, _ := json.Marshal(policy)
			if string(before) != string(after) {
				t.Fatal("caller policy mutated")
			}
			selected, base, err := store.SelectWorkPolicy(context.Background(), spec.AgentID, spec.RoomID, parent.InitiatorMemberID, bindingNow)
			if err != nil || selected.Digest != view.Digest || base != f.base {
				t.Fatalf("offer %s: %v", base, err)
			}
			first, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow)
			if err != nil {
				t.Fatal(err)
			}
			if first.WorkPolicy == nil || first.WorkPolicy.PolicyDigest != view.Digest {
				t.Fatal("missing parent")
			}
			m.Grant = execution.GovernedExecutionManifestGrant(first.Summary.Grant)
			m.Repository.GrantID, m.Repository.GrantRevision = m.Grant.GrantID, m.Grant.Revision
			resignManifest(t, &m)
			if err := store.CheckTaskGrant(context.Background(), m, execution.Prepare, bindingNow); err != nil {
				t.Fatal(err)
			}
			spec.TaskID = "task_second_development01"
			spec.PlanID = "plan_second_development01"
			if _, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow.Add(time.Second)); !errors.Is(err, ErrConflict) {
				t.Fatal("changed request reused an authorization", err)
			}
			secondParent := parent
			secondParent.AuthorizationID = "op_work_second0001"
			second, err := store.DeriveWorkTaskGrant(context.Background(), spec, secondParent, bindingNow.Add(time.Second))
			if err != nil || second.Spec.GrantID == first.Spec.GrantID {
				t.Fatalf("second task: %v", err)
			}
			if f.git(t, f.sourcePath, "rev-parse", "HEAD") != f.base {
				t.Fatal("consent mutated source")
			}
			if err := store.Close(); err != nil {
				t.Fatal(err)
			}
			reopened, err := OpenBindingStore(context.Background(), store.dataRoot, store.owner, f.executable, Limits{})
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			replay, err := reopened.DeriveWorkTaskGrant(context.Background(), first.Spec, parent, bindingNow.Add(time.Minute))
			if err != nil || !reflect.DeepEqual(replay, first) {
				t.Fatalf("durable replay: %v", err)
			}
			if _, err := reopened.IssueTaskGrant(context.Background(), first.Spec, bindingNow.Add(time.Minute)); !errors.Is(err, ErrConflict) {
				t.Fatalf("manual issue dropped parent: %v", err)
			}
		})
	}
}

func TestWorkPolicyRevocationInvalidatesExistingGrantAndFutureIssuance(t *testing.T) {
	_, store, policy, spec, m := workPolicyFixture(t, "sha1")
	view, parent := createWorkPolicy(t, store, policy)
	grant, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow)
	if err != nil {
		t.Fatal(err)
	}
	m.Grant = execution.GovernedExecutionManifestGrant(grant.Summary.Grant)
	m.Repository.GrantID, m.Repository.GrantRevision = m.Grant.GrantID, m.Grant.Revision
	resignManifest(t, &m)
	if _, err := store.RevokeWorkPolicy(policy.PolicyID, 1, strings.Repeat("e", 64), bindingNow.Add(time.Second)); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	revoked, err := store.RevokeWorkPolicy(policy.PolicyID, 1, view.Digest, bindingNow.Add(time.Second))
	if err != nil || revoked.RevokedAt == nil {
		t.Fatal(err)
	}
	for _, op := range []execution.KindElement{execution.Prepare, execution.Capture, execution.Verify} {
		if err := store.CheckTaskGrant(context.Background(), m, op, bindingNow.Add(2*time.Second)); !errors.Is(err, ErrGrantRevoked) {
			t.Fatalf("%s: %v", op, err)
		}
	}
	grants, err := store.ListTaskGrants()
	if err != nil || len(grants) != 1 || grants[0].Summary.RevokedAt == nil || grants[0].Summary.Grant.Revision != 2 {
		t.Fatalf("ready inventory retained authority: %+v %v", grants, err)
	}
	if _, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow.Add(2*time.Second)); err == nil {
		t.Fatal("derived after revocation")
	}
	if _, err := store.CreateWorkPolicy(context.Background(), policy, bindingNow.Add(2*time.Second)); !errors.Is(err, ErrGrantRevoked) {
		t.Fatal("resurrected policy", err)
	}
	// Revocation replay is independent of Git availability and immutable.
	store.git = gitRunner{}
	replay, err := store.RevokeWorkPolicy(policy.PolicyID, 1, view.Digest, bindingNow.Add(time.Minute))
	if err != nil || !reflect.DeepEqual(replay, revoked) {
		t.Fatal("revocation replay", err)
	}
}

func TestWorkPolicyRejectsEscalationBeforeAnyGrantWrite(t *testing.T) {
	_, store, policy, spec, _ := workPolicyFixture(t, "sha1")
	_, parent := createWorkPolicy(t, store, policy)
	for name, change := range map[string]func(*TaskGrantSpec, *WorkGrantParent){
		"initiator":       func(_ *TaskGrantSpec, p *WorkGrantParent) { p.InitiatorMemberID = "member_foreign0001" },
		"policy digest":   func(_ *TaskGrantSpec, p *WorkGrantParent) { p.PolicyDigest = strings.Repeat("a", 64) },
		"policy revision": func(_ *TaskGrantSpec, p *WorkGrantParent) { p.Revision = 2 },
		"attempt budget":  func(_ *TaskGrantSpec, p *WorkGrantParent) { p.MaxRunAttempts = 4 },
		"concurrency":     func(_ *TaskGrantSpec, p *WorkGrantParent) { p.MaxConcurrency = 3 },
		"room":            func(s *TaskGrantSpec, _ *WorkGrantParent) { s.RoomID = "room_foreign0001" },
		"agent":           func(s *TaskGrantSpec, _ *WorkGrantParent) { s.AgentID = "agent_foreign0001" },
		"binding":         func(s *TaskGrantSpec, _ *WorkGrantParent) { s.BindingID = "repobind_foreign0001" },
		"base":            func(s *TaskGrantSpec, _ *WorkGrantParent) { s.BaseCommit = strings.Repeat("a", 40) },
		"duration":        func(s *TaskGrantSpec, _ *WorkGrantParent) { s.ExpiresAt = bindingTime(bindingNow.Add(2 * time.Hour)) },
		"paths":           func(s *TaskGrantSpec, _ *WorkGrantParent) { s.ScopePolicy.AllowedPaths = []string{"."} },
		"forbidden":       func(s *TaskGrantSpec, _ *WorkGrantParent) { s.ScopePolicy.ForbiddenPaths = []string{} },
		"runtime":         func(s *TaskGrantSpec, _ *WorkGrantParent) { s.RuntimeProfile.Digest = strings.Repeat("f", 64) },
		"dropped verifier": func(s *TaskGrantSpec, _ *WorkGrantParent) {
			s.VerificationProfiles = []execution.ExecutionGrantSummaryVerificationProfile{}
		},
		"integration": func(s *TaskGrantSpec, _ *WorkGrantParent) { s.Operations = append(s.Operations, execution.Integrate) },
		"grant id":    func(s *TaskGrantSpec, _ *WorkGrantParent) { s.GrantID = "grant_arbitrary0001" },
	} {
		t.Run(name, func(t *testing.T) {
			var changed TaskGrantSpec
			raw, _ := json.Marshal(spec)
			_ = json.Unmarshal(raw, &changed)
			p := parent
			change(&changed, &p)
			if _, err := store.DeriveWorkTaskGrant(context.Background(), changed, p, bindingNow); err == nil {
				t.Fatal("unauthorized derivation")
			}
			entries, err := os.ReadDir(store.grantRoot)
			if err != nil || len(entries) != 0 {
				t.Fatal("denial wrote a grant", err)
			}
		})
	}
}

func TestWorkPolicyExpiryOverlapAndChangedSource(t *testing.T) {
	f, store, policy, spec, _ := workPolicyFixture(t, "sha1")
	_, parent := createWorkPolicy(t, store, policy)
	if _, _, err := store.SelectWorkPolicy(context.Background(), spec.AgentID, spec.RoomID, parent.InitiatorMemberID, bindingNow.Add(24*time.Hour)); !errors.Is(err, ErrWorkPolicyDenied) {
		t.Fatal("expired policy", err)
	}
	if _, _, err := store.SelectWorkPolicy(context.Background(), spec.AgentID, spec.RoomID, parent.InitiatorMemberID, bindingNow.Add(-time.Second)); !errors.Is(err, ErrWorkPolicyDenied) {
		t.Fatal("future policy", err)
	}
	second := policy
	second.PolicyID = "workpolicy_second0001"
	v2, _ := createWorkPolicy(t, store, second)
	if _, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow); !errors.Is(err, ErrWorkPolicyAmbiguous) {
		t.Fatal("ambiguous policy", err)
	}
	if _, err := store.RevokeWorkPolicy(second.PolicyID, 1, v2.Digest, bindingNow); err != nil {
		t.Fatal(err)
	}
	f.write(t, "src/app.txt", "new owner source\n")
	f.git(t, f.sourcePath, "add", "src/app.txt")
	f.git(t, f.sourcePath, "commit", "-m", "owner advances source")
	if _, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow); !errors.Is(err, ErrChanged) {
		t.Fatal("accepted stale offered base", err)
	}
	spec.BaseCommit = f.git(t, f.sourcePath, "rev-parse", "HEAD")
	if _, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow); err != nil {
		t.Fatal(err)
	}
}

func TestWorkPolicyConcurrentDerivationIsOneImmutableGrant(t *testing.T) {
	_, store, policy, spec, _ := workPolicyFixture(t, "sha1")
	_, parent := createWorkPolicy(t, store, policy)
	var wg sync.WaitGroup
	results := make(chan TaskGrantView, 8)
	failures := make(chan error, 8)
	for range 8 {
		wg.Go(func() {
			view, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, bindingNow)
			results <- view
			failures <- err
		})
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first TaskGrantView
	for view := range results {
		if first.Spec.GrantID == "" {
			first = view
		} else if !reflect.DeepEqual(first, view) {
			t.Fatal("duplicate grants")
		}
	}
	views, err := store.ListTaskGrants()
	if err != nil || len(views) != 1 {
		t.Fatal("duplicate records", err)
	}
}

func TestWorkPolicyDecoderAndStorageRejectTampering(t *testing.T) {
	_, store, policy, _, _ := workPolicyFixture(t, "sha1")
	raw, _ := json.Marshal(policy)
	if _, err := DecodeWorkPolicySpec(raw); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{
		strings.Replace(string(raw), `"policyId":`, `"PolicyId":`, 1),
		strings.TrimSuffix(string(raw), "}") + `,"command":["sh"]}`,
		strings.TrimSuffix(string(raw), "}") + `,"policyId":"workpolicy_duplicate01"}`,
		string(raw) + ` {}`,
		strings.Replace(string(raw), `"maxConcurrency":2,`, "", 1),
	} {
		if _, err := DecodeWorkPolicySpec([]byte(invalid)); err == nil {
			t.Fatal("accepted ambiguous owner command")
		}
	}
	view, _ := createWorkPolicy(t, store, policy)
	changed := policy
	changed.RoomIDs = []string{"room_foreign0001"}
	if _, err := store.CreateWorkPolicy(context.Background(), changed, bindingNow); !errors.Is(err, ErrConflict) {
		t.Fatal("replaced policy", err)
	}
	path := store.workPolicyPath(view.Spec.PolicyID, false)
	stored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record workPolicyRecord
	_ = json.Unmarshal(stored, &record)
	record.Owner.DeviceID = "device_other0001"
	stored, _ = json.Marshal(record)
	if err := os.WriteFile(path, stored, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ListWorkPolicies(); !errors.Is(err, ErrChanged) {
		t.Fatal("foreign policy accepted", err)
	}
}

func TestWorkPolicyFractionalTimesAndExactSymbolicRefDenial(t *testing.T) {
	f, store, policy, spec, _ := workPolicyFixture(t, "sha1")
	now := bindingNow.Truncate(time.Second).Add(time.Second)
	view, err := store.CreateWorkPolicy(context.Background(), policy, now)
	if err != nil {
		t.Fatal(err)
	}
	parent := WorkGrantParent{AuthorizationID: "op_fractional0001", PolicyID: policy.PolicyID,
		PolicyDigest: view.Digest, Revision: 1, InitiatorMemberID: store.owner.OwnerMemberID, MaxRunAttempts: 1, MaxConcurrency: 1}
	grant, err := store.DeriveWorkTaskGrant(context.Background(), spec, parent, now.Add(time.Millisecond))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateWorkPolicy(context.Background(), policy, now.Add(time.Millisecond)); err != nil {
		t.Fatal("fractional replay", err)
	}
	if _, err := store.DeriveWorkTaskGrant(context.Background(), grant.Spec, parent, now.Add(2*time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RevokeWorkPolicy(policy.PolicyID, 1, view.Digest, now.Add(3*time.Millisecond)); err != nil {
		t.Fatal("fractional revoke", err)
	}
	f.git(t, f.sourcePath, "symbolic-ref", "refs/heads/alias", "refs/heads/main")
	policy.PolicyID = "workpolicy_symbolic0001"
	policy.SourceRef = "refs/heads/alias"
	if _, err := store.CreateWorkPolicy(context.Background(), policy, now); !errors.Is(err, ErrChanged) {
		t.Fatal("symbolic branch admitted", err)
	}
}

func TestWorkPolicyBrowserTimestampNormalizesBeforeImmutablePersistence(t *testing.T) {
	_, store, spec, _, _ := workPolicyFixture(t, "sha1")
	spec.ExpiresAt = bindingNow.Add(24 * time.Hour).Format("2006-01-02T15:04:05.000Z")
	first, err := store.CreateWorkPolicy(context.Background(), spec, bindingNow)
	if err != nil {
		t.Fatal(err)
	}
	if !validBindingTime(first.Spec.ExpiresAt) {
		t.Fatal("browser timestamp was not normalized")
	}
	spec.ExpiresAt = first.Spec.ExpiresAt
	replay, err := store.CreateWorkPolicy(context.Background(), spec, bindingNow.Add(time.Second))
	if err != nil || replay.Digest != first.Digest {
		t.Fatal("equivalent timestamp changed immutable policy", err)
	}
}
