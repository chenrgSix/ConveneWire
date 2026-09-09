package bridgecore

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/privatefs"
)

func waitNativePeerState(t *testing.T, node *NativeNode, state string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if node.PeerStatus().State == state {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("native Peer state", node.PeerStatus())
}

func TestNativeConnectorFamiliesIsolateFailuresAndDrainOnIdentityChange(t *testing.T) {
	base, node, cfg, _, ids := nativeCoreFixture(t)
	ctx, cancel := context.WithCancel(base)
	defer cancel()
	attempts := make(chan struct{}, 2)
	deviceStopped := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		attempt := 0
		done <- runNativeConnectors(ctx, node, cfg, ids, operations.Observer{}, func(ctx context.Context) error {
			attempt++
			attempts <- struct{}{}
			if attempt == 1 {
				return errors.New("Device fixture temporarily unavailable")
			}
			<-ctx.Done()
			close(deviceStopped)
			return nil
		})
	}()
	waitNativePeerState(t, node, "running")
	for i := 0; i < 2; i++ {
		select {
		case <-attempts:
		case <-time.After(3 * time.Second):
			t.Fatal("Device setup failure was not retried")
		}
	}
	root := filepath.Join(node.root, "peer-state")
	if err := privatefs.CreateDirectory(root); err != nil {
		t.Fatal(err)
	}
	if err := privatefs.WriteFile(filepath.Join(root, "state.json"), []byte("corrupt")); err != nil {
		t.Fatal(err)
	}
	waitNativePeerState(t, node, "unavailable")
	select {
	case <-deviceStopped:
		t.Fatal("Peer corruption stopped Device connector")
	default:
	}
	if err := os.Remove(filepath.Join(node.root, "identity.json")); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, errNativeNode) {
			t.Fatal("native identity failure not reported", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("native identity change did not drain core")
	}
	select {
	case <-deviceStopped:
	default:
		t.Fatal("core returned before Device drained")
	}
}

func TestNativeConfigurationReplacementDrainsPeerEpoch(t *testing.T) {
	ctx, node, cfg, _, ids := nativeCoreFixture(t)
	err := runNativeConnectors(ctx, node, cfg, ids, operations.Observer{}, func(context.Context) error { return connection.ErrConfigurationChanged })
	if !errors.Is(err, connection.ErrConfigurationChanged) || node.PeerStatus().State != "stopped" {
		t.Fatal("configuration replacement did not drain native epoch", err, node.PeerStatus())
	}
}
