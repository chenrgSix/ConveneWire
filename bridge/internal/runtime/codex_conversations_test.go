package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
)

func init() {
	mode := os.Getenv("CONVENE_WIRE_CONVERSATION_FIXTURE")
	if mode == "" || len(os.Args) != 4 || os.Args[1] != "app-server" {
		return
	}
	journal, err := os.OpenFile(os.Getenv("CONVENE_WIRE_CONVERSATION_JOURNAL"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		os.Exit(2)
	}
	defer journal.Close()
	workspace, _ := os.Getwd()
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message struct {
			ID     int            `json:"id"`
			Method string         `json:"method"`
			Params map[string]any `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(3)
		}
		_, _ = journal.Write(append(append([]byte{}, scanner.Bytes()...), '\n'))
		switch message.Method {
		case "initialize":
			fmt.Println(`{"id":1,"result":{}}`)
		case "initialized":
		case "thread/list", "thread/read":
			thread := map[string]any{"id": "thread_fixture", "name": "Existing conversation", "cwd": workspace, "updatedAt": 123,
				"historyMode": "legacy", "preview": "PRIVATE_FIRST_MESSAGE", "path": "/private/rollout", "turns": []any{"PRIVATE_HISTORY"}, "status": map[string]any{"type": "idle"}}
			switch mode {
			case "foreign-workspace":
				thread["cwd"] = filepath.Dir(workspace)
			case "wrong-thread":
				thread["id"] = "thread_foreign"
			case "invalid-thread":
				thread["id"] = "../thread"
			case "title-control":
				thread["name"] = "bad\x1btitle"
			case "unknown-history":
				thread["historyMode"] = "future-unsupported"
			case "old-server":
				delete(thread, "historyMode")
			case "paginated":
				thread["historyMode"] = "paginated"
			case "error":
				fmt.Println(`{"id":2,"error":{"message":"PRIVATE_PROVIDER_ERROR"}}`)
				continue
			case "wrong-id":
				fmt.Println(`{"id":9,"result":{}}`)
				continue
			case "request":
				fmt.Println(`{"id":3,"method":"item/tool/call","params":{}}`)
				continue
			case "request-zero":
				fmt.Println(`{"id":0,"method":"item/tool/call","params":{}}`)
			case "notification":
				fmt.Println(`{"method":"server/notice","params":{}}`)
			case "oversize":
				fmt.Println(strings.Repeat("x", codexConversationMaxOutput+1))
				continue
			case "hang":
				time.Sleep(time.Minute)
				continue
			}
			var result any = map[string]any{"thread": thread}
			if message.Method == "thread/list" {
				if message.Params["cwd"] != workspace || message.Params["limit"] != float64(codexConversationPageSize) || message.Params["useStateDbOnly"] != true {
					os.Exit(4)
				}
				rows := []any{thread}
				if mode == "duplicate" {
					rows = append(rows, thread)
				}
				if mode == "too-many" {
					rows = make([]any, codexConversationPageSize+1)
				}
				result = map[string]any{"data": rows, "nextCursor": "next-page"}
			} else if message.Params["includeTurns"] != false {
				os.Exit(5)
			}
			_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"id": 2, "result": result})
		default:
			os.Exit(6) // Never resume, start, mutate configuration, or answer tools.
		}
	}
	os.Exit(0)
}

func conversationFixture(t *testing.T, mode string) (config.AgentConfig, string) {
	t.Helper()
	dir := t.TempDir()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	journal := filepath.Join(dir, "metadata-requests.jsonl")
	t.Setenv("CONVENE_WIRE_CONVERSATION_FIXTURE", mode)
	t.Setenv("CONVENE_WIRE_CONVERSATION_JOURNAL", journal)
	return config.AgentConfig{Adapter: "codex", RuntimeKind: "codex", Workspace: dir,
		Command: config.CodexPresetCommand(exe), EnvAllowlist: []string{"CONVENE_WIRE_CONVERSATION_FIXTURE", "CONVENE_WIRE_CONVERSATION_JOURNAL", "SystemRoot"}}, journal
}

func TestCodexConversationMetadataReadsOneLocalPageWithoutHistoryOrOwnership(t *testing.T) {
	agent, journal := conversationFixture(t, "success")
	page, err := ListCodexConversations(context.Background(), agent, "opaque-page")
	if err != nil || len(page.Conversations) != 1 || page.NextCursor != "next-page" {
		t.Fatalf("metadata page: %#v %v", page, err)
	}
	thread, err := ReadCodexConversation(context.Background(), agent, page.Conversations[0].ID)
	if err != nil || thread != page.Conversations[0] {
		t.Fatalf("selected metadata: %#v %v", thread, err)
	}
	encoded, _ := json.Marshal(page)
	for _, private := range []string{"PRIVATE", "rollout", "status", "turns", "preview"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("projected private history or false ownership signal: %s", encoded)
		}
	}
	source, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(source)), "\n")
	if len(lines) != 6 || !strings.Contains(lines[2], `"cursor":"opaque-page"`) ||
		!strings.Contains(lines[2], `"sourceKinds":["vscode","appServer","cli"]`) || !strings.Contains(lines[5], `"includeTurns":false`) {
		t.Fatalf("unexpected RPC sequence: %s", source)
	}
}

func TestCodexConversationMetadataRejectsUntrustedReplies(t *testing.T) {
	for _, mode := range []string{"foreign-workspace", "invalid-thread", "title-control", "unknown-history", "error", "wrong-id", "request", "request-zero", "oversize", "duplicate", "too-many"} {
		t.Run(mode, func(t *testing.T) {
			agent, _ := conversationFixture(t, mode)
			page, err := ListCodexConversations(context.Background(), agent, "")
			if !errors.Is(err, ErrCodexConversationMetadata) || len(page.Conversations) != 0 {
				t.Fatalf("unsafe metadata accepted: %#v %v", page, err)
			}
		})
	}
	t.Run("wrong-selected-thread", func(t *testing.T) {
		agent, _ := conversationFixture(t, "wrong-thread")
		if _, err := ReadCodexConversation(context.Background(), agent, "thread_fixture"); !errors.Is(err, ErrCodexConversationMetadata) {
			t.Fatalf("wrong selection: %v", err)
		}
	})
}

func TestCodexConversationMetadataAllowsNotificationsWithoutRequestIDs(t *testing.T) {
	agent, _ := conversationFixture(t, "notification")
	if _, err := ListCodexConversations(context.Background(), agent, ""); err != nil {
		t.Fatalf("valid notification rejected: %v", err)
	}
}

func TestCodexConversationMetadataDoesNotTreatUnknownOrPaginatedAsResumable(t *testing.T) {
	for mode, expected := range map[string]string{"old-server": "unknown", "paginated": "paginated"} {
		t.Run(mode, func(t *testing.T) {
			agent, _ := conversationFixture(t, mode)
			thread, err := ReadCodexConversation(context.Background(), agent, "thread_fixture")
			if err != nil || thread.HistoryMode != expected {
				t.Fatalf("history format silently reclassified: %#v %v", thread, err)
			}
		})
	}
}

func TestCodexConversationMetadataRejectsInputsBeforeLaunching(t *testing.T) {
	agent, journal := conversationFixture(t, "success")
	if _, err := ListCodexConversations(context.Background(), agent, "cursor\n"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
	if _, err := ReadCodexConversation(context.Background(), agent, "../thread"); err == nil {
		t.Fatal("invalid ID accepted")
	}
	agent.Command = append(agent.Command, "--dangerously-bypass-approvals-and-sandbox")
	if _, err := ListCodexConversations(context.Background(), agent, ""); err == nil {
		t.Fatal("unsafe command accepted")
	}
	if _, err := os.Stat(journal); !os.IsNotExist(err) {
		t.Fatal("invalid query launched a child")
	}
}

func TestCodexConversationMetadataCancellationDrainsChild(t *testing.T) {
	agent, _ := conversationFixture(t, "hang")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := ListCodexConversations(ctx, agent, ""); !errors.Is(err, ErrCodexConversationMetadata) {
		t.Fatalf("hang returned success: %v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("canceled query did not finish promptly")
	}
}

func TestCodexConversationMetadataInstalledCompatibility(t *testing.T) {
	exe := os.Getenv("CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN")
	if exe == "" {
		t.Skip("optional installed Codex with disposable home; metadata RPCs only")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CODEX_HOME", home)
	agent := config.AgentConfig{Adapter: "codex", RuntimeKind: "codex", Command: config.CodexPresetCommand(exe), Workspace: home,
		EnvAllowlist: []string{"HOME", "USERPROFILE", "CODEX_HOME", "PATH", "SystemRoot"}}
	page, err := ListCodexConversations(context.Background(), agent, "")
	if err != nil || len(page.Conversations) != 0 || page.NextCursor != "" {
		t.Fatalf("installed Codex metadata contract: %#v %v", page, err)
	}
	if _, err := ReadCodexConversation(context.Background(), agent, "00000000-0000-0000-0000-000000000001"); !errors.Is(err, ErrCodexConversationMetadata) {
		t.Fatalf("missing installed Thread must fail: %v", err)
	}
}
