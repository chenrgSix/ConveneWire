package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestCentralApprovalContinuesSameProcessOnlyAfterDecision(t *testing.T) {
	for _, mode := range []string{"allow", "deny", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("CONVENE_WIRE_APPROVAL_FIXTURE", "1")
			workspace := t.TempDir()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			requested, answer, done := make(chan struct{}), make(chan bool, 1), make(chan error, 1)
			adapter := CodexAdapter{Config: config.AgentConfig{Adapter: "codex", RuntimeKind: "codex", Sandbox: "workspace-write",
				CentralApprovalRevision: 1, Workspace: workspace,
				Command:      []string{os.Args[0], "-test.run=^TestCentralApprovalProcessFixture$", "--", "app-server"},
				EnvAllowlist: []string{"CONVENE_WIRE_APPROVAL_FIXTURE"}},
				Approve: func(ctx context.Context, input contracts.RuntimeApprovalRequestedPayload) (bool, error) {
					if input.OperationKind != "command" || !strings.Contains(input.Details, "permission-test.txt") {
						t.Error("missing exact operation")
					}
					close(requested)
					select {
					case value := <-answer:
						return value, nil
					case <-ctx.Done():
						return false, nil
					}
				}}
			run := contracts.RunRequestedPayload{RunID: "run_approvalprocess1", RoomID: "room_approvalprocess1", TargetAgentID: "agent_approvalprocess1",
				Instruction: "Write test file", Deadline: time.Now().Add(time.Minute), CentralApproval: &contracts.PayloadCentralApproval{Revision: 1}}
			go func() {
				done <- adapter.Execute(ctx, Request{Run: run}, func(context.Context, Event) error { return nil })
			}()
			select {
			case <-requested:
			case <-done:
				t.Fatal("process ended before approval")
			case <-ctx.Done():
				t.Fatal("no approval request")
			}
			if _, err := os.Stat(filepath.Join(workspace, "permission-test.txt")); !os.IsNotExist(err) {
				t.Fatal("file existed before decision")
			}
			before, err := os.ReadFile(filepath.Join(workspace, "process-id"))
			if err != nil {
				t.Fatal(err)
			}
			if mode == "cancel" {
				cancel()
			} else {
				answer <- mode == "allow"
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("process did not settle")
			}
			after, _ := os.ReadFile(filepath.Join(workspace, "process-id"))
			if string(before) != string(after) {
				t.Fatal("process was replaced")
			}
			data, err := os.ReadFile(filepath.Join(workspace, "permission-test.txt"))
			if mode == "allow" {
				if err != nil || string(data) != "approved" {
					t.Fatal("approved side effect missing")
				}
			} else if !os.IsNotExist(err) {
				t.Fatal("denied/canceled side effect")
			}
		})
	}
}

func TestCentralApprovalRejectsUnsupportedOrSensitiveCallbacks(t *testing.T) {
	for _, change := range []string{"secret", "wrong_thread", "session_root", "unsupported", "stdin"} {
		t.Run(change, func(t *testing.T) {
			called := false
			p := newCodexAppServerParser(config.AgentConfig{CentralApprovalRevision: 1}, "")
			p.threadID, p.turnID = "thread-test", "turn-test"
			p.approve = func(context.Context, contracts.RuntimeApprovalRequestedPayload) (bool, error) {
				called = true
				return true, nil
			}
			p.approvalContext = context.Background()
			params := map[string]any{"threadId": p.threadID, "turnId": p.turnID, "itemId": "item", "command": "pwd", "cwd": "/tmp/test"}
			method := "item/commandExecution/requestApproval"
			switch change {
			case "secret":
				params["command"] = "token=secretvalue12345"
			case "wrong_thread":
				params["threadId"] = "other"
			case "session_root":
				method = "item/fileChange/requestApproval"
				params["grantRoot"] = "/"
			case "unsupported":
				method = "item/permissions/requestApproval"
			case "stdin":
				params["kind"] = "writeStdin"
			}
			raw, _ := json.Marshal(map[string]any{"id": 5, "method": method, "params": params})
			if _, _, err := p.consume(raw); err == nil || called {
				t.Fatal("unsupported callback gained authority")
			}
		})
	}
	p := newCodexAppServerParser(config.AgentConfig{CentralApprovalRevision: 1}, "")
	if p.threadRequest()["params"].(map[string]any)["approvalPolicy"] != "never" {
		t.Fatal("missing pin enabled approval")
	}
}

func TestCentralApprovalRequiresRuntimeToConfirmHumanReviewer(t *testing.T) {
	for _, reviewer := range []string{"", "auto_review", "guardian_subagent"} {
		p := newCodexAppServerParser(config.AgentConfig{CentralApprovalRevision: 1}, "")
		p.approve = func(context.Context, contracts.RuntimeApprovalRequestedPayload) (bool, error) {
			t.Fatal("unconfirmed reviewer requested approval")
			return false, nil
		}
		response, _ := json.Marshal(map[string]any{"id": 2, "result": map[string]any{
			"thread": map[string]string{"id": "thread-test"}, "approvalPolicy": "on-request", "approvalsReviewer": reviewer,
		}})
		if _, messages, err := p.consume(response); err == nil || len(messages) != 0 {
			t.Fatal("unconfirmed reviewer started a turn")
		}
	}
}

func TestCentralApprovalProcessFixture(t *testing.T) {
	if os.Getenv("CONVENE_WIRE_APPROVAL_FIXTURE") != "1" {
		return
	}
	defer os.Exit(0)
	_ = os.WriteFile("process-id", []byte(time.Now().String()), 0600)
	encoder := json.NewEncoder(os.Stdout)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
			Result map[string]any `json:"result"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(2)
		}
		switch message.ID {
		case 1:
			_ = encoder.Encode(map[string]any{"id": 1, "result": map[string]any{}})
		case 2:
			if message.Params["sandbox"] != "workspace-write" || message.Params["approvalPolicy"] != "on-request" || message.Params["approvalsReviewer"] != "user" {
				os.Exit(3)
			}
			_ = encoder.Encode(map[string]any{"id": 2, "result": map[string]any{"thread": map[string]string{"id": "thread-test"}, "approvalPolicy": "on-request", "approvalsReviewer": "user"}})
		case 3:
			_ = encoder.Encode(map[string]any{"id": 3, "result": map[string]any{"turn": map[string]string{"id": "turn-test"}}})
			cwd, _ := os.Getwd()
			_ = encoder.Encode(map[string]any{"id": 8, "method": "item/commandExecution/requestApproval", "params": map[string]any{
				"threadId": "thread-test", "turnId": "turn-test", "itemId": "command-test", "command": "printf approved > permission-test.txt", "cwd": cwd}})
		case 8:
			if message.Result["decision"] == "accept" {
				_ = os.WriteFile("permission-test.txt", []byte("approved"), 0600)
			}
			_ = encoder.Encode(map[string]any{"method": "item/completed", "params": map[string]any{"threadId": "thread-test", "turnId": "turn-test",
				"item": map[string]string{"id": "reply-test", "type": "agentMessage", "text": "Approval fixture completed."}}})
			_ = encoder.Encode(map[string]any{"method": "turn/completed", "params": map[string]any{"threadId": "thread-test", "turn": map[string]string{"id": "turn-test", "status": "completed"}}})
		}
	}
}
