// Disposable compatibility driver. FD 3 is inherited from the test parent;
// there is no listener or production coordinator endpoint.
package main

import (
	"bytes"
	"context"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/delivery"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	localwire "convenewire.dev/contracts/generated/go/localnode"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"convenewire.dev/bridge/internal/desktopcodex"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	native := os.Getenv("CONVENE_WIRE_CODEX_MEDIATOR_FIXTURE_BIN")
	if !filepath.IsAbs(native) {
		return fmt.Errorf("explicit fixture provider required")
	}
	if err := desktopcodex.ValidateArguments(os.Args[1:]); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 110*time.Second)
	defer cancel()
	provider := exec.CommandContext(ctx, native, os.Args[1:]...)
	provider.Env = os.Environ()
	provider.Stderr = os.Stderr
	provider.WaitDelay = time.Second
	input, err := provider.StdinPipe()
	if err != nil {
		return err
	}
	output, err := provider.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	if err := provider.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	defer func() { cancel(); _ = provider.Wait() }()
	mediator := desktopcodex.NewMediator()
	var coordinator *desktopcodex.Coordinator
	var reopen func() (*desktopcodex.Coordinator, error)
	var runtimeCfg config.AgentConfig
	var fixtureInbox *delivery.Inbox
	if value := os.Getenv("CONVENE_WIRE_HANDOFF_HUB_FIXTURE"); value != "" {
		var hub struct{ Origin, Token, NodeID, AgentID string }
		if json.Unmarshal([]byte(value), &hub) != nil {
			return fmt.Errorf("invalid fixture Hub")
		}
		root := filepath.Join(os.Getenv("HOME"), "adoption-fixture")
		if err := os.MkdirAll(root, 0700); err != nil {
			return err
		}
		workspace, _ := os.Getwd()
		broker, e := desktopcodex.StartControl(ctx, mediator, filepath.Join(root, "launch-plan.json"), desktopcodex.Plan{Version: 1}, os.Getenv("CODEX_HOME"))
		if e != nil {
			return e
		}
		defer broker.Close()
		runtimeCfg = config.AgentConfig{Name: "Local Codex", Adapter: "codex", RuntimeKind: "codex", Workspace: workspace, Sandbox: "read-only", Command: []string{native, "app-server"}}
		hubControl := func(ctx context.Context, input localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error) {
			data, _ := json.Marshal(input)
			request, e := http.NewRequestWithContext(ctx, "POST", hub.Origin+"/api/local-node/control/handoff", bytes.NewReader(data))
			if e != nil {
				return localwire.DesktopHandoffScope{}, e
			}
			request.Header.Set("X-ConveneWire-Node-Control", hub.Token)
			request.Header.Set("Content-Type", "application/json")
			response, e := http.DefaultClient.Do(request)
			if e != nil {
				return localwire.DesktopHandoffScope{}, e
			}
			defer response.Body.Close()
			data, e = io.ReadAll(io.LimitReader(response.Body, 16384))
			if e != nil {
				return localwire.DesktopHandoffScope{}, e
			}
			if response.StatusCode != 200 {
				return localwire.DesktopHandoffScope{}, fmt.Errorf("fixture Hub refused %d: %s", response.StatusCode, data)
			}
			var scope localwire.DesktopHandoffScope
			e = localwire.Decode("DesktopHandoffScope", data, &scope)
			return scope, e
		}
		reopen = func() (*desktopcodex.Coordinator, error) {
			return desktopcodex.NewCoordinator(filepath.Join(root, "records"), hub.NodeID, filepath.Join(root, "connection.json"), hubControl, func(agent string) (config.AgentConfig, error) {
				if agent != hub.AgentID {
					return config.AgentConfig{}, desktopcodex.ErrUnavailable
				}
				return runtimeCfg, nil
			})
		}
		coordinator, e = reopen()
		if e != nil {
			return e
		}
		fixtureInbox, e = delivery.Open(filepath.Join(root, "inbox"))
		if e != nil {
			return e
		}
	}
	control := os.NewFile(3, "owned-fixture-control")
	defer control.Close()
	var operations sync.WaitGroup
	controlDone := make(chan struct{})
	go func() {
		defer close(controlDone)
		decoder, encoder := json.NewDecoder(control), json.NewEncoder(control)
		var lock sync.Mutex
		fences := map[string]desktopcodex.Fence{}
		counter := 0
		slots := make(chan struct{}, 8)
		for {
			var request struct {
				ID     string `json:"id"`
				Method string `json:"method"`
				Params struct {
					ThreadID, Fence, OperationID, Text, TaskID, ReviewID string
					Disclose                                             bool
					Run                                                  contracts.RunRequestedPayload
				} `json:"params"`
			}
			if decoder.Decode(&request) != nil {
				return
			}
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				return
			}
			operations.Add(1)
			go func() {
				defer operations.Done()
				defer func() { <-slots }()
				call, cancel := context.WithTimeout(ctx, 20*time.Second)
				defer cancel()
				lock.Lock()
				fence := fences[request.Params.Fence]
				lock.Unlock()
				var value any
				var err error
				switch request.Method {
				case "coordinator-review":
					coordinator.SetPending(request.Params.TaskID)
					value, err = coordinator.Review(call, request.Params.TaskID, request.Params.ThreadID)
				case "coordinator-confirm":
					value, err = coordinator.Confirm(call, request.Params.TaskID, request.Params.ReviewID, request.Params.Disclose)
				case "coordinator-restart":
					coordinator, err = reopen()
					if err == nil {
						coordinator.SetPending(request.Params.TaskID)
						value, err = coordinator.View(call)
					}
				case "coordinator-release":
					err = coordinator.Release(call, request.Params.TaskID)
					value = map[string]bool{"released": err == nil}
				case "runtime":
					adapter := bridgeruntime.CodexAdapter{Config: runtimeCfg, Desktop: coordinator}
					executor := delivery.RuntimeExecutor{Inbox: fixtureInbox, Adapters: map[string]bridgeruntime.Adapter{request.Params.Run.TargetAgentID: adapter}}
					handler := delivery.Handler{Inbox: fixtureInbox, Gate: delivery.NewAgentExecutionGate(), OnNew: executor.Execute, OnDuplicate: executor.Replay}
					events := []any{}
					err = handler.Handle(call, contracts.RunRequestedMessage{ProtocolVersion: "1.0", MessageID: "msg_fixturehandoff001", Timestamp: time.Now().UTC(), Type: contracts.RunRequested, Payload: request.Params.Run}, func(_ context.Context, event any) error { events = append(events, event); return nil })
					value = events
				case "hold":
					fence, err = mediator.Hold(call, request.Params.ThreadID)
					if err == nil {
						lock.Lock()
						counter++
						token := fmt.Sprint(counter)
						fences[token] = fence
						lock.Unlock()
						value = map[string]string{"fence": token}
					}
				case "review-check":
					value, err = mediator.Review(call, fence)
				case "read":
					value, err = mediator.ReadMetadata(call, fence)
				case "execute":
					value, err = mediator.Execute(call, fence, desktopcodex.Continuation{OperationID: request.Params.OperationID, Text: request.Params.Text})
				case "state":
					value, err = mediator.State(call, fence)
				case "release":
					err = mediator.Release(call, fence)
					value = map[string]bool{"released": err == nil}
				default:
					err = fmt.Errorf("unsupported fixture command")
				}
				response := map[string]any{"id": request.ID, "result": value}
				if err != nil {
					delete(response, "result")
					response["error"] = map[string]string{"message": err.Error()}
				}
				lock.Lock()
				_ = encoder.Encode(response)
				lock.Unlock()
			}()
		}
	}()
	err = mediator.Serve(ctx, desktopcodex.Streams{DesktopInput: os.Stdin, DesktopOutput: os.Stdout, ProviderInput: output, ProviderOutput: input})
	cancel()
	_ = control.Close()
	<-controlDone
	operations.Wait()
	return err
}
