package console

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/repository"
	"convenewire.dev/bridge/internal/verification"
)

func consoleWorkPolicy(t *testing.T) repository.WorkPolicyView {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "packages", "contracts", "fixtures", "work-policy-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		Cases []struct {
			Kind     string          `json:"kind"`
			Instance json.RawMessage `json:"instance"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, entry := range cases.Cases {
		if entry.Kind == "workPolicySpec" {
			spec, err := repository.DecodeWorkPolicySpec(entry.Instance)
			if err != nil {
				t.Fatal(err)
			}
			return repository.WorkPolicyView{Spec: spec, Revision: 1, Digest: strings.Repeat("a", 64), IssuedAt: "2026-09-08T00:00:00Z"}
		}
	}
	t.Fatal("missing fixture")
	return repository.WorkPolicyView{}
}

func TestWorkPolicyConsoleRequiresOwnerAndDrainsBeforeCreateAndRevoke(t *testing.T) {
	policy := consoleWorkPolicy(t)
	dependencies := inertDependencies()
	var running, mutations atomic.Int32
	started := make(chan struct{}, 3)
	dependencies.RunBridge = func(ctx context.Context, _ config.Config, _ pairing.Credential, _ operations.Observer) error {
		running.Add(1)
		started <- struct{}{}
		<-ctx.Done()
		running.Add(-1)
		return ctx.Err()
	}
	dependencies.CreateWorkPolicy = func(_ context.Context, _ config.Config, _ pairing.Credential, input WorkPolicyInput, _ time.Time) (repository.WorkPolicyView, error) {
		if running.Load() != 0 || !input.Confirm {
			return repository.WorkPolicyView{}, errors.New("mutation raced Bridge")
		}
		mutations.Add(1)
		return policy, nil
	}
	dependencies.RevokeWorkPolicy = func(_ context.Context, _ config.Config, _ pairing.Credential, id string, input GovernedGrantRevocationInput, now time.Time) (repository.WorkPolicyView, error) {
		if running.Load() != 0 || id != policy.Spec.PolicyID || input.ExpectedDigest != policy.Digest || !input.Confirm {
			return repository.WorkPolicyView{}, errors.New("revocation raced or changed authority")
		}
		mutations.Add(1)
		stamp := now.Format(time.RFC3339Nano)
		view := policy
		view.RevokedAt = &stamp
		return view, nil
	}
	service, _ := pairedRecoveryService(t, dependencies)
	if err := service.StartConfiguredBridge(); err != nil {
		t.Fatal(err)
	}
	waitSignal(t, started, "start")
	server := httptest.NewServer(service.Handler())
	defer server.Close()
	raw, _ := json.Marshal(policy.Spec)
	for _, value := range []any{WorkPolicyInput{Spec: raw}, map[string]any{"spec": policy.Spec, "confirm": true, "command": "git push"}} {
		response := consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/work-policies", value)
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest || mutations.Load() != 0 || running.Load() != 1 {
			t.Fatal("invalid mutation reached owner authority")
		}
	}
	response := consoleRequest(t, server.URL, "wrong-token", http.MethodPost, "/api/work-policies", WorkPolicyInput{Spec: raw, Confirm: true})
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized || mutations.Load() != 0 {
		t.Fatal("non-owner mutation was accepted")
	}
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/work-policies", WorkPolicyInput{Spec: raw, Confirm: true})
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"bridgeRestarted":true`) {
		t.Fatalf("create: %d %s", response.StatusCode, body)
	}
	waitSignal(t, started, "restart after create")
	response = consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/work-policies/"+policy.Spec.PolicyID+"/revoke",
		GovernedGrantRevocationInput{ExpectedRevision: 1, ExpectedDigest: policy.Digest, Confirm: true})
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"revokedAt":"`) {
		t.Fatalf("revoke: %d %s", response.StatusCode, body)
	}
	waitSignal(t, started, "restart after revoke")
	if mutations.Load() != 2 {
		t.Fatal("unexpected mutation count")
	}
}

func TestWorkPolicyConsoleCloneDoesNotMutateParentBounds(t *testing.T) {
	policy := consoleWorkPolicy(t)
	original := GovernedOwnerState{WorkPolicies: []repository.WorkPolicyView{policy}}
	cloned := cloneGovernedOwnerState(original)
	cloned.WorkPolicies[0].Spec.RoomIDs[0] = "room_changed0001"
	cloned.WorkPolicies[0].Spec.ScopePolicy.AllowedPaths[0] = "secrets"
	if original.WorkPolicies[0].Spec.RoomIDs[0] == "room_changed0001" || original.WorkPolicies[0].Spec.ScopePolicy.AllowedPaths[0] == "secrets" {
		t.Fatal("shallow policy clone expanded cached bounds")
	}
}

// Real embedded UI over disposable simulated resources; no installed policy,
// Runtime, Central identity or model is used by the browser fixture.
func TestWorkPolicyBrowserFixture(t *testing.T) {
	if os.Getenv("CONVENE_WIRE_WORK_POLICY_UI_FIXTURE") != "1" {
		t.Skip("opt-in local work policy browser fixture")
	}
	policy := consoleWorkPolicy(t)
	dependencies := inertDependencies()
	dependencies.DiscoverRuntime = func(string) RuntimeDiscovery { return RuntimeDiscovery{} }
	var mu sync.Mutex
	state := GovernedOwnerState{WorkPolicies: []repository.WorkPolicyView{},
		Bindings: []repository.BindingView{{BindingID: policy.Spec.BindingID, RepositoryID: policy.Spec.RepositoryID,
			Revision: 1, SourceFingerprint: policy.Spec.SourceFingerprint, Alias: "示例前端仓库"}},
		RuntimeProfiles: []admission.RuntimeProfileView{{Spec: admission.RuntimeProfileSpec{ProfileID: policy.Spec.RuntimeProfile.ProfileID,
			Revision: 1, PermissionProfile: "isolated_development"}, Digest: policy.Spec.RuntimeProfile.Digest}},
		VerificationProfiles: []verification.ProfileView{{ProfileID: "profile_browser0001", Revision: 1, Digest: strings.Repeat("c", 64), TimeoutMilliseconds: 60000}}}
	dependencies.InspectGovernedOwnerState = func(context.Context, config.Config, pairing.Credential) (GovernedOwnerState, error) {
		mu.Lock()
		defer mu.Unlock()
		return cloneGovernedOwnerState(state), nil
	}
	dependencies.CreateWorkPolicy = func(_ context.Context, _ config.Config, _ pairing.Credential, input WorkPolicyInput, now time.Time) (repository.WorkPolicyView, error) {
		spec, err := repository.DecodeWorkPolicySpec(input.Spec)
		if err != nil {
			return repository.WorkPolicyView{}, err
		}
		mu.Lock()
		defer mu.Unlock()
		view := repository.WorkPolicyView{Spec: spec, Revision: 1, Digest: strings.Repeat("d", 64), IssuedAt: now.Format(time.RFC3339Nano)}
		state.WorkPolicies = append(state.WorkPolicies, view)
		return view, nil
	}
	dependencies.RevokeWorkPolicy = func(_ context.Context, _ config.Config, _ pairing.Credential, id string, input GovernedGrantRevocationInput, now time.Time) (repository.WorkPolicyView, error) {
		mu.Lock()
		defer mu.Unlock()
		for i := range state.WorkPolicies {
			if state.WorkPolicies[i].Spec.PolicyID == id && state.WorkPolicies[i].Digest == input.ExpectedDigest {
				stamp := now.Format(time.RFC3339Nano)
				state.WorkPolicies[i].RevokedAt = &stamp
				return state.WorkPolicies[i], nil
			}
		}
		return repository.WorkPolicyView{}, repository.ErrInvalid
	}
	service, _ := pairedRecoveryService(t, dependencies)
	state.RuntimeProfiles[0].Spec.AgentID = service.State().Agents[0].AgentID
	finished := make(chan struct{})
	var once sync.Once
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/client-access", service.authorize(func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{"memberId": "member_ui_owner0001", "rooms": []map[string]string{{"roomId": "room_ui_development01", "name": "产品开发"}}})
	}))
	mux.HandleFunc("POST /fixture/stop", func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
		once.Do(func() { close(finished) })
	})
	mux.Handle("/", service.Handler())
	server := httptest.NewServer(mux)
	defer server.Close()
	fmt.Printf("WORK_POLICY_FIXTURE_URL=%s/?token=%s\n", server.URL, service.Token())
	select {
	case <-finished:
	case <-time.After(20 * time.Minute):
		t.Fatal("browser fixture timed out")
	}
}
