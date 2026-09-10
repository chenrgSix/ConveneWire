package localnode

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"convenewire.dev/bridge/internal/bridgecore"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/console"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	contracts "convenewire.dev/contracts/generated/go/localnode"
)

// Shell connects the selected local Team to one existing Console/Bridge core.
// Web can request opening the Console; it cannot supply Runtime configuration.
type Shell struct {
	Hub          *Supervisor
	mu           sync.Mutex
	service      *console.Service
	dependencies console.Dependencies
	workspace    string
	version      string
	requestID    string
	closed       bool
	native       *bridgecore.NativeNode
}

func NewShell(hub *Supervisor, workspace, version string, dependencies console.Dependencies) *Shell {
	return &Shell{Hub: hub, dependencies: dependencies, workspace: workspace, version: version}
}

func (shell *Shell) Console() *console.Service {
	shell.mu.Lock()
	defer shell.mu.Unlock()
	return shell.service
}

// Poll returns true once per explicit Owner request to open the native Console.
func (shell *Shell) Poll(ctx context.Context) (bool, error) {
	shell.mu.Lock()
	defer shell.mu.Unlock()
	if shell.closed {
		return false, errors.New("Local Node is closed")
	}
	state, err := shell.Hub.ControlState(ctx)
	if err != nil {
		return false, err
	}
	if state.Binding == nil {
		return false, nil
	}
	if shell.service == nil {
		if err := shell.attach(*state.Binding); err != nil {
			return false, err
		}
	}
	requested := state.ConsoleRequestID != "" && state.ConsoleRequestID != shell.requestID
	shell.requestID = state.ConsoleRequestID
	return requested, nil
}

func (shell *Shell) attach(binding contracts.Binding) error {
	root := shell.Hub.Data.Root
	configPath := filepath.Join(root, "bridge.json")
	dataDir := filepath.Join(root, "bridge")
	candidate := config.Config{SchemaVersion: config.CurrentSchemaVersion, LocalNodeID: shell.Hub.Data.Identity.NodeID,
		ServerURL: binding.ServerURL, DeviceName: "Local Node", DataDir: dataDir, Agents: []config.AgentConfig{}}
	if _, err := os.Lstat(configPath); errors.Is(err, os.ErrNotExist) {
		if err := config.Save(configPath, candidate); err != nil {
			return err
		}
	} else if err != nil {
		return err
	} else {
		existing, err := config.Load(configPath)
		if err != nil {
			return err
		}
		if existing.LocalNodeID != candidate.LocalNodeID || existing.ServerURL != candidate.ServerURL || existing.DataDir != dataDir {
			return errors.New("existing Bridge profile does not belong to this Local Node")
		}
	}
	credential := pairing.Credential{ServerURL: binding.ServerURL, TeamID: binding.TeamID, DeviceID: binding.DeviceID, OwnerMemberID: binding.OwnerMemberID, Token: binding.Token}
	saved, err := pairing.Load(dataDir)
	if err == nil {
		if saved.ServerURL != credential.ServerURL || saved.TeamID != credential.TeamID || saved.DeviceID != credential.DeviceID ||
			saved.OwnerMemberID != credential.OwnerMemberID || saved.Token != credential.Token {
			return errors.New("existing Bridge credential differs from the Local Node binding")
		}
	} else {
		// Do not reinterpret a malformed credential as an unpaired installation.
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := pairing.Save(dataDir, credential); err != nil {
			return err
		}
	}
	if shell.native == nil {
		shell.native, err = bridgecore.NewNativeNode(root, shell.Hub.Data.Identity)
		if err != nil {
			return err
		}
	}
	dependencies := shell.dependencies
	native := shell.native
	if run := dependencies.RunBridge; run != nil {
		dependencies.RunBridge = func(ctx context.Context, cfg config.Config, credential pairing.Credential, observer operations.Observer) error {
			return run(bridgecore.WithNativeNode(ctx, native), cfg, credential, observer)
		}
	}
	if run := dependencies.RunBridgeWithProvisioning; run != nil {
		dependencies.RunBridgeWithProvisioning = func(ctx context.Context, cfg config.Config, credential pairing.Credential, observer operations.Observer, handler connection.ProvisionHandler) error {
			return run(bridgecore.WithNativeNode(ctx, native), cfg, credential, observer, handler)
		}
	}
	service, err := console.New(console.Options{ConfigPath: configPath, DataDir: dataDir, Workspace: shell.workspace, Version: shell.version, NativePeers: native}, dependencies)
	if err != nil {
		return err
	}
	if err := service.StartConfiguredBridge(); err != nil {
		service.Close()
		return err
	}
	shell.service = service
	return nil
}

func (shell *Shell) Handler() http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		service := shell.Console()
		if service == nil {
			response.Header().Set("Content-Type", "text/html; charset=utf-8")
			response.Header().Set("Cache-Control", "no-store")
			fmt.Fprint(response, "<!doctype html><html lang=zh-CN><meta charset=utf-8><title>本机 Agent</title><main><h1>先选择本地 Team</h1><p>请在本地空间中创建或选择 Team，然后点击“连接本机 Runtime”。</p></main></html>")
			return
		}
		service.Handler().ServeHTTP(response, request)
	})
}

func (shell *Shell) Close() error {
	shell.mu.Lock()
	defer shell.mu.Unlock()
	if shell.closed {
		return nil
	}
	shell.closed = true
	if shell.service != nil {
		shell.service.Close()
	}
	if shell.native != nil {
		shell.native.Close()
	}
	return shell.Hub.Close()
}
