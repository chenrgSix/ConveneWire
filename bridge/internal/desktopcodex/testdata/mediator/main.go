// Disposable compatibility driver. FD 3 is inherited from the test parent;
// there is no listener or production coordinator endpoint.
package main

import (
	"context"
	"encoding/json"
	"fmt"
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
				ID     string                                              `json:"id"`
				Method string                                              `json:"method"`
				Params struct{ ThreadID, Fence, OperationID, Text string } `json:"params"`
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
