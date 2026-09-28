package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestCodexAdapterReadsUnboundedProtocolOutput(t *testing.T) {
	for _, test := range []struct {
		mode string
		code string
	}{
		{mode: "many-events"},
		{mode: "large-event"},
		{mode: "final-without-newline"},
		{mode: "malformed", code: "CODEX_PROTOCOL_INVALID"},
		{mode: "truncated", code: "CODEX_PROTOCOL_INVALID"},
		{mode: "cancel", code: "CODEX_CANCELED"},
	} {
		t.Run(test.mode, func(t *testing.T) {
			t.Setenv("AGENTROOM_CODEX_HELPER", "success")
			t.Setenv("AGENTROOM_CODEX_OUTPUT_FIXTURE", test.mode)
			adapter := CodexAdapter{Config: config.AgentConfig{
				Command:   []string{os.Args[0], "-test.run=TestCodexHelperProcess", "--", "app-server", "--listen", "stdio://"},
				Workspace: t.TempDir(), Sandbox: "workspace-write",
				EnvAllowlist: []string{"AGENTROOM_CODEX_HELPER", "AGENTROOM_CODEX_OUTPUT_FIXTURE"},
			}}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			var events []Event
			var reply string
			if err := adapter.Execute(ctx, Request{Run: contracts.RunRequestedPayload{Instruction: "implement it"}},
				func(_ context.Context, event Event) error {
					events = append(events, event)
					if event.Reply != "" {
						reply = event.Reply
					}
					if test.mode == "cancel" && event.Activity != nil && event.Activity.ID == "large-tool" {
						cancel()
					}
					return nil
				}); err != nil {
				t.Fatal(err)
			}
			terminal := events[len(events)-1]
			if test.code == "" {
				if terminal.Status == nil || *terminal.Status != contracts.Completed || reply != "Implemented." {
					t.Fatalf("large stream did not complete: terminal=%#v error=%#v reply=%q", terminal, terminal.Error, reply)
				}
			} else {
				expectedStatus := contracts.Failed
				if test.code == "CODEX_CANCELED" {
					expectedStatus = contracts.Canceled
				}
				if terminal.Status == nil || *terminal.Status != expectedStatus || terminal.Error == nil || terminal.Error.Code != test.code || reply != "" {
					t.Fatalf("unexpected failure: terminal=%#v error=%#v reply=%q", terminal, terminal.Error, reply)
				}
			}
			encoded, err := json.Marshal(events)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), "private-tool-payload") {
				t.Fatal("raw tool output escaped into Room events")
			}
		})
	}
}

// Exercise both the former cumulative 4 MiB cap and the Scanner token cap.
// All payloads are tool protocol data and must remain private.
func emitCodexLargeOutputFixture(encoder *json.Encoder, mode string) {
	if mode == "many-events" {
		payload := strings.Repeat("private-tool-payload", 4096)
		for i := 0; i < 128; i++ {
			_ = encoder.Encode(map[string]any{"method": "item/commandExecution/outputDelta", "params": map[string]any{
				"threadId": "019d-thread", "turnId": "turn-1", "itemId": "large-tool", "delta": payload,
			}})
		}
	} else {
		_ = encoder.Encode(map[string]any{"method": "item/completed", "params": map[string]any{
			"threadId": "019d-thread", "turnId": "turn-1",
			"item": map[string]any{
				"id": "large-tool", "type": "commandExecution", "status": "completed",
				"aggregatedOutput": strings.Repeat("private-tool-payload", 300_000),
			},
		}})
	}
	switch mode {
	case "malformed":
		fmt.Println(`{"method":"private-tool-payload"} {}`)
		os.Exit(0)
	case "truncated":
		fmt.Print(`{"method":"private-tool-payload"`)
		os.Exit(0)
	case "cancel":
		// Leave the next JSONL event unfinished; cancellation must unblock reading.
		fmt.Print(`{"method":"`)
		for {
			time.Sleep(time.Second)
		}
	}
}
