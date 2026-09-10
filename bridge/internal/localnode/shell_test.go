package localnode

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/console"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go/localnode"
)

type shellControlTransport func(*http.Request) (*http.Response, error)

func (f shellControlTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestShellConsolePrecedesTeamBindingAndKeepsNativeOwnerAcrossAttachment(t *testing.T) {
	data, err := OpenData(filepath.Join(t.TempDir(), "node"))
	if err != nil {
		t.Fatal(err)
	}
	state := contracts.LocalNodeControlState{}
	hub := &Supervisor{Data: data, done: make(chan struct{}), controlToken: "control-only", client: &http.Client{Transport: shellControlTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != data.Origin()+"/api/local-node/control/state" || r.Header.Get("X-ConveneWire-Node-Control") != "control-only" {
			t.Fatal("unexpected control request")
		}
		raw, _ := json.Marshal(state)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(raw)), Header: http.Header{}}, nil
	})}}
	started := make(chan pairing.Credential, 2)
	dependencies := RuntimeDependencies("fixture")
	dependencies.RunBridgeWithProvisioning = nil
	dependencies.RunBridge = func(ctx context.Context, _ config.Config, credential pairing.Credential, _ operations.Observer) error {
		started <- credential
		<-ctx.Done()
		return ctx.Err()
	}
	dependencies.InspectGovernedOwnerState = func(context.Context, config.Config, pairing.Credential) (console.GovernedOwnerState, error) {
		return console.GovernedOwnerState{}, nil
	}
	shell := NewShell(hub, t.TempDir(), "fixture", dependencies)
	t.Cleanup(func() {
		if shell.service != nil {
			shell.service.Close()
		}
		if shell.native != nil {
			shell.native.Close()
		}
		_ = data.Close()
	})
	if requested, err := shell.Poll(context.Background()); err != nil || requested {
		t.Fatal("initial Owner Console", requested, err)
	}
	initial, native := shell.Console(), shell.native
	if initial == nil || native == nil || initial.State().Paired || !initial.State().BridgeRunning || initial.State().Connection.State != operations.ConnectionStopped {
		t.Fatal("Console required or invented Device binding")
	}
	if _, err := pairing.Load(filepath.Join(data.Root, "bridge")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("unbound Console wrote a Device credential", err)
	}
	select {
	case <-started:
		t.Fatal("unbound Console started a Device Runtime")
	default:
	}
	read := func(token, origin, route string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:48290"+route, nil)
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Origin", origin)
		response := httptest.NewRecorder()
		shell.Handler().ServeHTTP(response, request)
		return response
	}
	for _, route := range []string{"/api/peers/exports", "/api/peers/joins", "/api/peers/departures"} {
		if response := read(initial.Token(), "http://127.0.0.1:48290", route); response.Code != http.StatusOK {
			t.Fatal(route, response.Code, response.Body.String())
		}
		if response := read("device-not-owner", "http://127.0.0.1:48290", route); response.Code != http.StatusUnauthorized {
			t.Fatal("machine credential entered Owner Console", response.Code)
		}
		if response := read(initial.Token(), "https://foreign.example", route); response.Code != http.StatusForbidden {
			t.Fatal("foreign origin entered Owner Console", response.Code)
		}
	}
	waitPeers := func(want string) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if native.PeerStatus().State == want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("native Peer core state", native.PeerStatus())
	}
	waitPeers("running")
	mutate := func(method, route string, input any) *httptest.ResponseRecorder {
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, "http://127.0.0.1:48290"+route, bytes.NewReader(raw))
		request.Header.Set("Authorization", "Bearer "+initial.Token())
		response := httptest.NewRecorder()
		shell.Handler().ServeHTTP(response, request)
		return response
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	input := console.RuntimeInput{Kind: "codex", Enabled: true, Name: "Independent Agent", Role: "Reviewer",
		ExecutablePath: executable, Workspace: shell.workspace, Sandbox: "read-only"}
	created := mutate(http.MethodPost, "/api/agents", input)
	var agent console.AgentView
	if created.Code != http.StatusCreated || json.Unmarshal(created.Body.Bytes(), &agent) != nil || agent.AgentID == "" {
		t.Fatal("pre-Team Agent configuration", created.Code, created.Body.String())
	}
	input.Name = "Independent Renamed"
	updated := mutate(http.MethodPut, "/api/agents/"+agent.AgentID, input)
	var renamed console.AgentView
	if updated.Code != http.StatusOK || json.Unmarshal(updated.Body.Bytes(), &renamed) != nil || renamed.AgentID != agent.AgentID {
		t.Fatal("pre-Team Agent identity after edit", updated.Code, updated.Body.String())
	}
	initial.StopBridge()
	waitPeers("stopped")
	if _, err := initial.StartBridge(); err != nil {
		t.Fatal(err)
	}
	waitPeers("running")
	if initial.State().Paired || initial.State().Connection.State != operations.ConnectionStopped {
		t.Fatal("editing or restarting the native core invented Device pairing")
	}
	if _, err := pairing.Load(filepath.Join(data.Root, "bridge")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("pre-Team Agent editing wrote Device credentials", err)
	}
	state.ConsoleRequestID = strings.Repeat("A", 43)
	if requested, err := shell.Poll(context.Background()); err != nil || !requested {
		t.Fatal("pre-Team open request", requested, err)
	}
	if requested, err := shell.Poll(context.Background()); err != nil || requested {
		t.Fatal("replayed open request", requested, err)
	}
	state.Binding = &contracts.Binding{ServerURL: data.Origin(), TeamID: "team_shellfixture01", DeviceID: "device_shellfixture01", OwnerMemberID: "member_shellfixture01", Token: strings.Repeat("A", 43)}
	state.ConsoleRequestID = strings.Repeat("B", 43)
	if requested, err := shell.Poll(context.Background()); err != nil || !requested {
		t.Fatal("explicit Team attachment", requested, err)
	}
	attached := shell.Console()
	if attached == initial || shell.native != native || !attached.State().Paired || attached.State().TeamID != state.Binding.TeamID {
		t.Fatal("Team attachment replaced native identity or failed to pair")
	}
	if len(attached.State().Agents) != 1 || attached.State().Agents[0].AgentID != agent.AgentID || attached.State().Agents[0].Name != input.Name {
		t.Fatal("Device attachment forgot unpaired Agent configuration or identity")
	}
	// The fixture's bound runner intentionally has no Peer family. Seeing stopped
	// here proves the old real native worker drained before the new Device starts.
	waitPeers("stopped")
	select {
	case credential := <-started:
		if credential.TeamID != state.Binding.TeamID || credential.DeviceID != state.Binding.DeviceID {
			t.Fatal("started wrong binding")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("explicitly bound Runtime did not start")
	}
	if response := read(initial.Token(), "http://127.0.0.1:48290", "/api/peers/exports"); response.Code != http.StatusUnauthorized {
		t.Fatal("retired Console token was retained")
	}
	state.Binding.Token = strings.Repeat("C", 43)
	if _, err := shell.Poll(context.Background()); err == nil {
		t.Fatal("silently replaced an attached Device credential")
	}
}

func TestUnboundShellRefusesAnExistingDeviceCredential(t *testing.T) {
	data, err := OpenData(filepath.Join(t.TempDir(), "node"))
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	shell := NewShell(&Supervisor{Data: data}, t.TempDir(), "fixture", RuntimeDependencies("fixture"))
	credential := pairing.Credential{ServerURL: data.Origin(), TeamID: "team_shellfixture01", DeviceID: "device_shellfixture01", OwnerMemberID: "member_shellfixture01", Token: strings.Repeat("A", 43)}
	if err := pairing.Save(filepath.Join(data.Root, "bridge"), credential); err != nil {
		t.Fatal(err)
	}
	if err := shell.attach(nil); err == nil {
		t.Fatal("unbound Console adopted an existing Device credential")
	}
	if shell.Console() != nil {
		t.Fatal("unbound credential conflict exposed Console")
	}
	retained, err := pairing.Load(filepath.Join(data.Root, "bridge"))
	if err != nil || retained.Token != credential.Token {
		t.Fatal("credential conflict altered saved data", err)
	}
}
