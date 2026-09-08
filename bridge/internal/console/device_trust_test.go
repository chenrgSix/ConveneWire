package console

import (
	"context"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestDeviceTrustOwnerConsentDrainsAndPersistsExactRevision(t *testing.T) {
	dependencies := inertDependencies()
	var running, saves atomic.Int32
	started := make(chan struct{}, 4)
	dependencies.RunBridge = func(ctx context.Context, _ config.Config, _ pairing.Credential, _ operations.Observer) error {
		running.Add(1)
		started <- struct{}{}
		<-ctx.Done()
		running.Add(-1)
		return ctx.Err()
	}
	dependencies.ReplaceConfig = func(path string, c config.Config) error {
		if running.Load() != 0 {
			return errors.New("consent raced a process")
		}
		saves.Add(1)
		return config.Replace(path, c)
	}
	service, _ := pairedRecoveryService(t, dependencies)
	server := httptest.NewServer(service.Handler())
	defer server.Close()
	if service.State().DeviceExecutionTrust.Mode != "restricted" {
		t.Fatal("default granted trust")
	}
	if _, err := service.StartBridge(); err != nil {
		t.Fatal(err)
	}
	waitSignal(t, started, "start")
	submit := func(token, mode string, revision int, confirm bool, want int) {
		t.Helper()
		r := consoleRequest(t, server.URL, token, http.MethodPost, "/api/device-execution-trust", map[string]any{"mode": mode, "expectedRevision": revision, "confirm": confirm})
		defer r.Body.Close()
		if r.StatusCode != want {
			t.Fatalf("status %d want %d", r.StatusCode, want)
		}
	}
	submit("wrong", "full", 0, true, 401)
	submit(service.Token(), "full", 0, false, 400)
	submit(service.Token(), "full", 0, true, 200)
	waitSignal(t, started, "restart")
	if service.State().DeviceExecutionTrust.Mode != "full" || saves.Load() != 1 {
		t.Fatal("full trust missing")
	}
	loaded, err := config.Load(service.options.ConfigPath)
	if err != nil || loaded.DeviceExecutionTrust.Revision != 1 {
		t.Fatalf("not durable: %v", err)
	}
	submit(service.Token(), "full", 0, true, 200)
	if saves.Load() != 1 {
		t.Fatal("replay wrote new authority")
	}
	submit(service.Token(), "restricted", 1, true, 200)
	waitSignal(t, started, "revocation restart")
	submit(service.Token(), "full", 0, true, 409)
	if service.State().DeviceExecutionTrust.Mode != "restricted" || service.State().DeviceExecutionTrust.Revision != 2 || saves.Load() != 2 {
		t.Fatal("revocation did not win")
	}
}

func TestDeviceTrustFailedRevocationKeepsBridgeStopped(t *testing.T) {
	dependencies := inertDependencies()
	service, _ := pairedRecoveryService(t, dependencies)
	server := httptest.NewServer(service.Handler())
	defer server.Close()
	post := func(mode string, rev int) *http.Response {
		return consoleRequest(t, server.URL, service.Token(), http.MethodPost, "/api/device-execution-trust", map[string]any{"mode": mode, "expectedRevision": rev, "confirm": true})
	}
	r := post("full", 0)
	r.Body.Close()
	if r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	if _, err := service.StartBridge(); err != nil {
		t.Fatal(err)
	}
	service.dependencies.ReplaceConfig = func(string, config.Config) error { return errors.New("fixture disk failure") }
	r = post("restricted", 1)
	r.Body.Close()
	if r.StatusCode != 409 || service.State().BridgeRunning {
		t.Fatal("failed revocation restarted trusted execution")
	}
}
