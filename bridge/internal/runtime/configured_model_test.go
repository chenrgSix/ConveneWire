package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
)

// The test executable acts as an app-server without any model or credentials.
// Intercept the native preset before Go's flag parser sees app-server arguments.
func init() {
	mode := os.Getenv("CONVENE_WIRE_MODEL_FIXTURE")
	if mode == "" || len(os.Args) != 4 || os.Args[1] != "app-server" {
		return
	}
	journal, err := os.Create(os.Getenv("CONVENE_WIRE_MODEL_JOURNAL"))
	if err != nil {
		os.Exit(2)
	}
	defer journal.Close()
	cwd, _ := os.Getwd()
	_ = json.NewEncoder(journal).Encode(map[string]any{"cwd": cwd, "pid": os.Getpid(), "unexpectedSecret": os.Getenv("MODEL_FIXTURE_SECRET")})
	if mode == "hang" {
		time.Sleep(time.Minute)
		os.Exit(0)
	}
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message map[string]any
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(3)
		}
		_ = json.NewEncoder(journal).Encode(message)
		switch message["method"] {
		case "initialize":
			fmt.Println(`{"id":1,"result":{}}`)
		case "initialized":
		case "config/read":
			switch mode {
			case "malformed":
				fmt.Println(`not json`)
			case "wrong-id":
				fmt.Println(`{"id":9,"result":{"config":{"model":"wrong"}}}`)
			case "error":
				fmt.Println(`{"id":2,"error":{"code":-1,"message":"secret"}}`)
			case "request":
				fmt.Println(`{"id":7,"method":"config/write","params":{}}`)
			case "oversize":
				fmt.Println(strings.Repeat("x", configuredModelMaxOutput+1))
			case "notifications":
				for i := 0; i < 40000; i++ {
					fmt.Println(`{"method":"notification","params":{}}`)
				}
				fmt.Println(`{"id":2,"result":{"config":{"model":"too-late"}}}`)
			case "missing":
				fmt.Println(`{"id":2,"result":{"config":{"model":null}}}`)
			case "sensitive":
				fmt.Println(`{"id":2,"result":{"config":{"model":"sk-never-publish"}}}`)
			case "wrong-type":
				fmt.Println(`{"id":2,"result":{"config":{"model":{"secret":"value"}}}}`)
			default:
				fmt.Println(`{"method":"notice","params":{"ignored":true}}`)
				fmt.Println(`{"id":2,"result":{"config":{"model":"fixture-default","api_key":"sk-private","workspace":"/private/owner"},"layers":[{"secret":"private"}]}}`)
			}
		default:
			os.Exit(4) // No thread, turn, config write or approval response is permitted.
		}
	}
	os.Exit(0)
}

func modelFixture(t *testing.T, mode string) (config.AgentConfig, string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	journal := filepath.Join(dir, "requests.jsonl")
	t.Setenv("CONVENE_WIRE_MODEL_FIXTURE", mode)
	t.Setenv("CONVENE_WIRE_MODEL_JOURNAL", journal)
	t.Setenv("MODEL_FIXTURE_SECRET", "must-not-inherit")
	return config.AgentConfig{Adapter: "codex", Command: config.CodexPresetCommand(exe), Workspace: dir,
		EnvAllowlist: []string{"CONVENE_WIRE_MODEL_FIXTURE", "CONVENE_WIRE_MODEL_JOURNAL", "SystemRoot"}}, journal
}

func TestConfiguredAgentModelReadsOnlySafeConfiguration(t *testing.T) {
	agent, journal := modelFixture(t, "success")
	model := ConfiguredAgentModel(context.Background(), agent)
	if model == nil || *model != "fixture-default" {
		t.Fatalf("unexpected model %v", model)
	}
	data, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 4 {
		t.Fatalf("unexpected RPC journal %s", data)
	}
	var process struct{ Cwd, UnexpectedSecret string }
	if json.Unmarshal([]byte(lines[0]), &process) != nil || process.UnexpectedSecret != "" {
		t.Fatalf("environment leaked: %s", lines[0])
	}
	actualDir, _ := filepath.EvalSymlinks(process.Cwd)
	expectedDir, _ := filepath.EvalSymlinks(agent.Workspace)
	if actualDir != expectedDir {
		t.Fatalf("wrong cwd: %q", process.Cwd)
	}
	for i, method := range []string{"initialize", "initialized", "config/read"} {
		var request struct {
			Method string
			Params map[string]any
		}
		if json.Unmarshal([]byte(lines[i+1]), &request) != nil || request.Method != method {
			t.Fatalf("unexpected RPC %s", lines[i+1])
		}
		if method == "config/read" && (request.Params["cwd"] != agent.Workspace || request.Params["includeLayers"] != false) {
			t.Fatalf("wrong config scope %v", request.Params)
		}
	}
}

func TestConfiguredAgentModelFailsClosed(t *testing.T) {
	for _, mode := range []string{"malformed", "wrong-id", "error", "request", "oversize", "notifications", "missing", "sensitive", "wrong-type", "hang"} {
		t.Run(mode, func(t *testing.T) {
			agent, _ := modelFixture(t, mode)
			if model := ConfiguredAgentModel(context.Background(), agent); model != nil {
				t.Fatalf("unsafe metadata accepted: %q", *model)
			}
		})
	}
}

func TestConfiguredAgentModelSkipsUnneededProcesses(t *testing.T) {
	agent := config.AgentConfig{Adapter: "codex", Command: []string{"/does-not-exist", "app-server", "-c", "model=explicit-model"}}
	if model := ConfiguredAgentModel(context.Background(), agent); model == nil || *model != "explicit-model" {
		t.Fatal("explicit selector needed a process")
	}
	agent.Command = append(agent.Command, "--profile", "review")
	if ConfiguredAgentModel(context.Background(), agent) != nil {
		t.Fatal("ambiguous profile was reported")
	}
	agent, journal := modelFixture(t, "success")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if ConfiguredAgentModel(ctx, agent) != nil {
		t.Fatal("cancelled query returned metadata")
	}
	if _, err := os.Stat(journal); !os.IsNotExist(err) {
		t.Fatal("cancelled query started a child")
	}
}

func TestConfiguredAgentModelHonorsBudgetAndReapsChild(t *testing.T) {
	agent, journal := modelFixture(t, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	startedChild := make(chan int, 1)
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				data, _ := os.ReadFile(journal)
				var process struct{ PID int }
				if json.Unmarshal(data, &process) == nil && process.PID != 0 {
					startedChild <- process.PID
					cancel()
					return
				}
			}
		}
	}()
	started := time.Now()
	if ConfiguredAgentModel(ctx, agent) != nil {
		t.Fatal("hanging child returned metadata")
	}
	cancel()
	<-watchDone
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("query did not honor its budget: %s", elapsed)
	}
	var pid int
	select {
	case pid = <-startedChild:
	default:
		t.Fatal("fixture did not initialize before the metadata deadline")
	}
	child, err := os.FindProcess(pid)
	if err == nil {
		defer child.Release()
		// Wait must fail because ConfiguredAgentModel already reaped its child.
		if _, err := child.Wait(); err == nil {
			t.Fatal("metadata resolver left an unreaped child")
		}
	}
}

func TestConfiguredAgentModelCodexCompatibility(t *testing.T) {
	exe := os.Getenv("CONVENE_WIRE_CODEX_METADATA_TEST_BIN")
	if exe == "" {
		t.Skip("optional installed Codex, read-only RPC with isolated home")
	}
	home := t.TempDir()
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("model = \"fixture-configured-model\"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("CODEX_HOME", home)
	t.Setenv("PATH", filepath.Dir(exe))
	agent := config.AgentConfig{Adapter: "codex", Command: config.CodexPresetCommand(exe), Workspace: home, EnvAllowlist: []string{"HOME", "CODEX_HOME", "PATH", "SystemRoot"}}
	if model := ConfiguredAgentModel(context.Background(), agent); model == nil || *model != "fixture-configured-model" {
		t.Fatalf("installed Codex did not report the isolated configuration: %v", model)
	}
}
