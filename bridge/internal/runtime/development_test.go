package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestConversationAdapterUsesReadOnlyAndSeparatesAnswerFromDevelopment(t *testing.T) {
	for _, mode := range []string{"read", "develop"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("CONVENEWIRE_CONVERSATION_FIXTURE", mode)
			adapter := CodexAdapter{Config: config.AgentConfig{Workspace: t.TempDir(), Sandbox: "workspace-write",
				Command:      []string{os.Args[0], "-test.run=TestConversationHelperProcess", "--", "app-server"},
				EnvAllowlist: []string{"CONVENEWIRE_CONVERSATION_FIXTURE"}}}
			enabled := true
			var proposal *contracts.DevelopmentProposal
			var terminal Event
			reply := ""
			err := adapter.Execute(context.Background(), Request{Run: contracts.RunRequestedPayload{
				RunID: "run_conversation01", Instruction: "the original user request", ConversationWork: &enabled,
			}}, func(_ context.Context, event Event) error {
				if event.Reply != "" {
					reply = event.Reply
					proposal = event.DevelopmentProposal
				}
				if event.Status != nil {
					terminal = event
				}
				if event.Output != nil && strings.Contains(event.Output.Content, developmentOpen) {
					t.Fatal("private proposal leaked to preview")
				}
				return nil
			})
			if err != nil || terminal.Status == nil || *terminal.Status != contracts.Completed || reply == "" {
				t.Fatalf("conversation failed: %v %#v reply=%q", err, terminal, reply)
			}
			if (mode == "develop") != (proposal != nil) {
				t.Fatalf("wrong continuation: %#v", proposal)
			}
			if mode == "read" && reply != "Read-only analysis is complete." {
				t.Fatal(reply)
			}
			if adapter.Config.Sandbox != "workspace-write" {
				t.Fatal("mutated owner configuration")
			}
		})
	}
}

func TestConversationProposalRejectsAuthorityFieldsAndQuotedMarkers(t *testing.T) {
	valid := developmentOpen + `{"title":"Repair input","criteria":["Keyboard behavior is preserved"]}` + developmentClose
	for _, value := range []string{
		strings.Replace(valid, `"title":`, `"command":"git push","title":`, 1),
		strings.Replace(valid, `"criteria":["Keyboard behavior is preserved"]`, `"criteria":[]`, 1),
		strings.TrimSuffix(valid, developmentClose),
		strings.Replace(valid, "Repair input", strings.Repeat("长", 161), 1),
	} {
		if proposal, err := parseDevelopmentProposal(value); err == nil || proposal != nil {
			t.Fatalf("accepted %q", value)
		}
	}
	for _, value := range []string{"Review this marker: " + valid, "```\n" + valid + "\n```", "Do not change files."} {
		if proposal, err := parseDevelopmentProposal(value); err != nil || proposal != nil {
			t.Fatalf("promoted quoted/read-only output %q", value)
		}
	}
}

func TestConversationHelperProcess(t *testing.T) {
	mode := os.Getenv("CONVENEWIRE_CONVERSATION_FIXTURE")
	if mode == "" {
		return
	}
	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var request struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil {
			os.Exit(2)
		}
		switch request.Method {
		case "initialize":
			_ = encoder.Encode(map[string]any{"id": request.ID, "result": map[string]any{"userAgent": "fixture"}})
		case "thread/start":
			if request.Params["sandbox"] != "read-only" || request.Params["approvalPolicy"] != "never" {
				os.Exit(3)
			}
			_ = encoder.Encode(map[string]any{"id": request.ID, "result": map[string]any{"thread": map[string]any{"id": "conversation-thread"}}})
		case "turn/start":
			input, _ := json.Marshal(request.Params["input"])
			if !strings.Contains(string(input), "read-only conversation stage") || !strings.Contains(string(input), "the original user request") {
				os.Exit(4)
			}
			reply := "Read-only analysis is complete."
			if mode == "develop" {
				reply = developmentOpen + `{"title":"Repair input","criteria":["Preserve keyboard behavior"]}` + developmentClose
			}
			_ = encoder.Encode(map[string]any{"id": request.ID, "result": map[string]any{"turn": map[string]any{"id": "conversation-turn", "status": "inProgress"}}})
			_ = encoder.Encode(map[string]any{"method": "item/completed", "params": map[string]any{"threadId": "conversation-thread", "turnId": "conversation-turn", "item": map[string]any{"id": "reply", "type": "agentMessage", "text": reply}}})
			_ = encoder.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": "conversation-thread", "turn": map[string]any{"id": "conversation-turn", "status": "completed"}}})
		}
	}
	os.Exit(0)
}
