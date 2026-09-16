package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"time"

	"convenewire.dev/bridge/internal/config"
)

const configuredModelTimeout = 1500 * time.Millisecond
const configuredModelMaxOutput = 1 << 20

// ConfiguredAgentModel obtains display metadata only. It never starts a thread,
// resumes a Session, runs a model turn or writes configuration. Failure is an
// unknown label, not a failure to connect or execute the Agent.
func ConfiguredAgentModel(ctx context.Context, agent config.AgentConfig) *string {
	if model := agent.ConfiguredModel(); model != nil {
		return model
	}
	if ctx.Err() != nil || !agent.UsesDefaultCodexModel() {
		return nil
	}
	return readCodexConfiguredModel(ctx, agent)
}

type modelConfigResponse struct {
	ID     int             `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

func readCodexConfiguredModel(ctx context.Context, agent config.AgentConfig) *string {
	ctx, cancel := context.WithTimeout(ctx, configuredModelTimeout)
	defer cancel()
	command, managed, err := NewOwnedCommand(ctx, agent.Command)
	if err != nil {
		return nil
	}
	command.Dir, command.Env = agent.Workspace, allowedEnvironment(agent.EnvAllowlist)
	command.Stderr = io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil
	}
	defer stdin.Close()
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil
	}
	defer stdout.Close()
	if managed.Start() != nil {
		return nil
	}

	replies := make(chan modelConfigResponse)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer close(replies)
		scanner := bufio.NewScanner(io.LimitReader(stdout, configuredModelMaxOutput+1))
		scanner.Buffer(make([]byte, 4096), configuredModelMaxOutput)
		readBytes := 0
		for scanner.Scan() {
			readBytes += len(scanner.Bytes()) + 1
			if readBytes > configuredModelMaxOutput {
				return
			}
			var reply modelConfigResponse
			if json.Unmarshal(scanner.Bytes(), &reply) != nil {
				return
			}
			if reply.ID == 0 && reply.Method != "" {
				continue // Notifications carry no display evidence.
			}
			if reply.ID == 0 || reply.Method != "" {
				return // Never answer a child-initiated RPC request.
			}
			select {
			case replies <- reply:
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() {
		cancel()
		_ = stdin.Close()
		_ = managed.Wait()
		_ = stdout.Close()
		<-readDone
	}()

	encoder := json.NewEncoder(stdin)
	call := func(id int, method string, params any) (json.RawMessage, bool) {
		if encoder.Encode(map[string]any{"id": id, "method": method, "params": params}) != nil {
			return nil, false
		}
		select {
		case reply, ok := <-replies:
			return reply.Result, ok && reply.ID == id && (len(reply.Error) == 0 || string(reply.Error) == "null") && len(reply.Result) != 0
		case <-ctx.Done():
			return nil, false
		}
	}
	if _, ok := call(1, "initialize", map[string]any{
		"clientInfo": map[string]string{"name": "convenewire_model_metadata", "version": "1"},
	}); !ok {
		return nil
	}
	if encoder.Encode(map[string]any{"method": "initialized"}) != nil {
		return nil
	}
	raw, ok := call(2, "config/read", map[string]any{"cwd": agent.Workspace, "includeLayers": false})
	if !ok {
		return nil
	}
	var result struct {
		Config struct {
			Model string `json:"model"`
		} `json:"config"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return nil
	}
	return config.SafeModelName(result.Config.Model)
}
