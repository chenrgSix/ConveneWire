package desktopcodex

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

func TestControlCapabilityOriginClosedMethodsAndOwnedCleanup(t *testing.T) {
	m, _, _, ctx := mediatorFixture(t)
	root := filepath.Join(t.TempDir(), "owner")
	plan := filepath.Join(root, "plan.json")
	control, err := StartControl(ctx, m, plan, Plan{Version: 1}, root)
	if err != nil {
		t.Fatal(err)
	}
	defer control.Close()
	client, err := Connect(filepath.Join(root, "connection.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = client.Call(ctx, ControlRequest{Action: "list"}); err != nil {
		t.Fatal(err)
	}
	if _, err = client.Call(ctx, ControlRequest{Action: "thread/resume", ThreadID: "foreign"}); err == nil {
		t.Fatal("arbitrary native RPC accepted")
	}
	if _, err = StartControl(ctx, m, plan, Plan{Version: 1}, root); err == nil {
		t.Fatal("duplicate descriptor owner accepted")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", client.Descriptor.Socket)
	}}
	httpClient := &http.Client{Transport: transport, Timeout: time.Second}
	defer transport.CloseIdleConnections()
	for _, scenario := range []struct {
		body, token, origin string
		status              int
	}{
		{`{"action":"list"}`, "", "", 403}, {`{"action":"list"}`, "wrong", "", 403},
		{`{"action":"list"}`, client.Descriptor.Token, "http://native.codex", 403},
		{`{"action":"list","action":"continue"}`, client.Descriptor.Token, "", 400},
		{`{"action":"list","rpc":"thread/resume"}`, client.Descriptor.Token, "", 400},
	} {
		request, _ := http.NewRequest("POST", "http://native.codex/control", strings.NewReader(scenario.body))
		request.Header.Set("X-ConveneWire-Codex", scenario.token)
		if scenario.origin != "" {
			request.Header.Set("Origin", scenario.origin)
		}
		response, e := httpClient.Do(request)
		if e != nil {
			t.Fatal(e)
		}
		response.Body.Close()
		if response.StatusCode != scenario.status {
			t.Fatalf("status %d != %d", response.StatusCode, scenario.status)
		}
	}
	socket := client.Descriptor.Socket
	control.Close()
	if _, err = os.Lstat(socket); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("owned socket retained")
	}
	if _, err = os.Lstat(filepath.Join(root, "connection.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("descriptor retained")
	}
}
func TestPrivateAdoptionRecoveryNeverForgetsPendingOperations(t *testing.T) {
	root := filepath.Join(t.TempDir(), "owner")
	record := Adoption{ID: "local-adoption", State: "running", Scope: localwire.DesktopHandoffScope{NodeID: "node_fixture_0001", TaskID: "task_fixture_0001"}, Operations: map[string]Receipt{"run_fixture_0001": {Hash: "immutable", State: "pending"}}}
	file := filepath.Join(root, digest(record.Scope.TaskID)+".json")
	if err := ReplacePrivate(file, record); err != nil {
		t.Fatal(err)
	}
	hubCalls := 0
	hub := func(context.Context, localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
		hubCalls++
		return record.Scope, nil
	}
	agent := func(string) (config.AgentConfig, error) { return config.AgentConfig{}, nil }
	coordinator, err := NewCoordinator(root, record.Scope.NodeID, filepath.Join(t.TempDir(), "connection.json"), hub, agent)
	if err != nil {
		t.Fatal(err)
	}
	if coordinator.records[record.Scope.TaskID].State != "paused" || !coordinator.HasTask(record.Scope.TaskID) {
		t.Fatal("recovery dropped binding")
	}
	if !errors.Is(coordinator.WorkReady(), ErrBusy) {
		t.Fatal("uncertain native execution did not retain scheduling fence")
	}
	if _, err = coordinator.Execute(context.Background(), record.Scope.TaskID, "agent_fixture_0001", "room_fixture_0001", record.ID, "digest", "run_fixture_0001", "resend"); err == nil {
		t.Fatal("restart resubmitted pending operation")
	}
	if hubCalls != 0 {
		t.Fatal("unreviewed recovery crossed control boundary")
	}
	if _, err = NewCoordinator(root, "node_foreign_0001", filepath.Join(root, "connection.json"), hub, agent); err == nil {
		t.Fatal("foreign Node adopted private journal")
	}
	before, _ := os.ReadFile(file)
	if err = os.Chmod(file, 0644); err != nil {
		t.Fatal(err)
	}
	if err = ReplacePrivate(file, map[string]bool{"replaced": true}); err == nil {
		t.Fatal("insecure journal replaced")
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("untrusted journal was modified")
	}
}
func TestReviewDigestIsIndependentOfJSONMemberOrder(t *testing.T) {
	a := json.RawMessage(`{"config":{"model":"one","tools":{"b":2,"a":1}},"checkpoint":3}`)
	b := json.RawMessage(`{"checkpoint":3,"config":{"tools":{"a":1,"b":2},"model":"one"}}`)
	if digest(a) != digest(b) {
		t.Fatal("native serialization order invalidated review")
	}
	if digest(a) == digest(json.RawMessage(`{"checkpoint":4}`)) {
		t.Fatal("changed checkpoint was not pinned")
	}
}

func TestControlReplacesOnlyItsStaleSocketDirectory(t *testing.T) {
	m, _, _, ctx := mediatorFixture(t)
	root := filepath.Join(t.TempDir(), "owner")
	plan := filepath.Join(root, "plan.json")
	first, err := StartControl(ctx, m, plan, Plan{Version: 1}, root)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	// Simulate a crashed process: the listener and OS lease close, but its private
	// descriptor and socket directory remain for the next owned startup.
	first.server.Close()
	first.lease.Release()
	second, err := StartControl(ctx, m, plan, Plan{Version: 1}, root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if _, err = os.Lstat(filepath.Dir(first.descriptor.Socket)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("stale owned directory retained")
	}
	first.Close()
	client, err := Connect(filepath.Join(root, "connection.json"))
	if err != nil || client.Descriptor.Epoch != second.descriptor.Epoch {
		t.Fatal("old cleanup removed replacement descriptor")
	}
}

func TestReleaseRetriesHubAcknowledgmentAndClearsOnlyUnconfirmedReview(t *testing.T) {
	for _, confirmed := range []bool{false, true} {
		t.Run(fmt.Sprint(confirmed), func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "owner")
			record := Adoption{ID: "local-adoption", State: "releasing", Scope: localwire.DesktopHandoffScope{NodeID: "node_fixture_0001", TaskID: "task_fixture_0001"}, Operations: map[string]Receipt{}}
			if err := ReplacePrivate(filepath.Join(root, digest(record.Scope.TaskID)+".json"), record); err != nil {
				t.Fatal(err)
			}
			calls := 0
			hub := func(_ context.Context, input localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
				calls++
				if input.Action != localwire.Release || input.AdoptionID == nil || *input.AdoptionID != record.ID {
					t.Fatal("release changed identity")
				}
				if calls == 1 {
					return localwire.DesktopHandoffScope{}, ErrClosed
				}
				scope := record.Scope
				scope.State = localwire.Released
				if confirmed {
					scope.AdoptionID = record.ID
				}
				return scope, nil
			}
			makeCoordinator := func() *Coordinator {
				c, err := NewCoordinator(root, record.Scope.NodeID, filepath.Join(root, "unavailable-descriptor"), hub, func(string) (config.AgentConfig, error) { return config.AgentConfig{}, nil })
				if err != nil {
					t.Fatal(err)
				}
				return c
			}
			c := makeCoordinator()
			if err := c.Release(context.Background(), record.Scope.TaskID); err == nil {
				t.Fatal("lost Hub acknowledgment reported success")
			}
			c = makeCoordinator()
			if c.records[record.Scope.TaskID].State != "releasing" {
				t.Fatal("restart lost return intent")
			}
			if err := c.Release(context.Background(), record.Scope.TaskID); err != nil {
				t.Fatal(err)
			}
			if c.HasTask(record.Scope.TaskID) != confirmed {
				t.Fatal("canceled review blocked ordinary Task or adopted tombstone was removed")
			}
			if confirmed && c.records[record.Scope.TaskID].State != "released" {
				t.Fatal("confirmed return not persisted")
			}
		})
	}
}

func TestNativeViewOffersRereviewAfterAudienceChangeOrDisconnection(t *testing.T) {
	for _, state := range []localwire.State{localwire.Paused, localwire.Attached} {
		t.Run(string(state), func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "owner")
			scope := localwire.DesktopHandoffScope{NodeID: "node_fixture_0001", TaskID: "task_fixture_0001", State: state}
			c, err := NewCoordinator(root, scope.NodeID, filepath.Join(root, "absent"), func(context.Context, localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
				return scope, nil
			}, func(string) (config.AgentConfig, error) { return config.AgentConfig{}, nil })
			if err != nil {
				t.Fatal(err)
			}
			c.SetPending(scope.TaskID)
			c.records[scope.TaskID] = &Adoption{Scope: scope, State: "attached", Operations: map[string]Receipt{}}
			view, err := c.View(context.Background())
			if err != nil || view.Adoption == nil || view.Adoption.State != "paused" {
				t.Fatalf("renewed review not reachable: %+v, %v", view, err)
			}
		})
	}
}
