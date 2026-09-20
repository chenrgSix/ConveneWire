package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
)

func conversationFixture(t *testing.T, mode string) (config.AgentConfig, string) {
	t.Helper()
	dir := t.TempDir()
	exe := filepath.Join(dir, "codex-metadata.exe")
	buildContext, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	build := exec.CommandContext(buildContext, "go", "build", "-o", exe, "./testdata/codex-metadata/main.go")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build isolated metadata fixture: %v\n%s", err, output)
	}
	journal := filepath.Join(dir, "metadata-requests.jsonl")
	t.Setenv("CONVENE_WIRE_CONVERSATION_FIXTURE", mode)
	t.Setenv("CONVENE_WIRE_CONVERSATION_JOURNAL", journal)
	return config.AgentConfig{Adapter: "codex", RuntimeKind: "codex", Workspace: dir,
		Command: config.CodexPresetCommand(exe), EnvAllowlist: []string{"CONVENE_WIRE_CONVERSATION_FIXTURE", "CONVENE_WIRE_CONVERSATION_JOURNAL", "SystemRoot"}}, journal
}

func assertConversationFixtureQueried(t *testing.T, journal, method string) {
	t.Helper()
	source, err := os.ReadFile(journal)
	if err != nil {
		t.Fatalf("fixture never reached the protocol request: %v", err)
	}
	var methods []string
	for _, line := range strings.Split(strings.TrimSpace(string(source)), "\n") {
		var request struct{ Method string }
		if err := json.Unmarshal([]byte(line), &request); err != nil {
			t.Fatalf("invalid fixture journal: %v", err)
		}
		methods = append(methods, request.Method)
	}
	if strings.Join(methods, ",") != "initialize,initialized,"+method {
		t.Fatalf("expected an actual %s request, got %v", method, methods)
	}
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
			agent, journal := conversationFixture(t, mode)
			page, err := ListCodexConversations(context.Background(), agent, "")
			assertConversationFixtureQueried(t, journal, "thread/list")
			if !errors.Is(err, ErrCodexConversationMetadata) || len(page.Conversations) != 0 {
				t.Fatalf("unsafe metadata accepted: %#v %v", page, err)
			}
		})
	}
	t.Run("wrong-selected-thread", func(t *testing.T) {
		agent, journal := conversationFixture(t, "wrong-thread")
		if _, err := ReadCodexConversation(context.Background(), agent, "thread_fixture"); !errors.Is(err, ErrCodexConversationMetadata) {
			t.Fatalf("wrong selection: %v", err)
		}
		assertConversationFixtureQueried(t, journal, "thread/read")
	})
}

func TestCodexConversationMetadataAllowsNotificationsWithoutRequestIDs(t *testing.T) {
	agent, journal := conversationFixture(t, "notification")
	if _, err := ListCodexConversations(context.Background(), agent, ""); err != nil {
		t.Fatalf("valid notification rejected: %v", err)
	}
	assertConversationFixtureQueried(t, journal, "thread/list")
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
	agent, journal := conversationFixture(t, "hang")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := ListCodexConversations(ctx, agent, "")
		finished <- err
	}()
	// Cancel only after the child has reached the deliberately hanging request.
	// Otherwise slow test-process startup could make this test pass without ever
	// exercising cancellation of an established protocol exchange.
	deadline := time.Now().Add(3 * time.Second)
	for {
		source, _ := os.ReadFile(journal)
		if strings.Contains(string(source), `"method":"thread/list"`) {
			break
		}
		select {
		case err := <-finished:
			t.Fatalf("query ended before the fixture received it: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			cancel()
			<-finished
			t.Fatal("fixture did not reach the hanging request")
		}
		time.Sleep(5 * time.Millisecond)
	}
	start := time.Now()
	cancel()
	if err := <-finished; !errors.Is(err, ErrCodexConversationMetadata) {
		t.Fatalf("hang returned success: %v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatal("canceled query did not finish promptly")
	}
	assertConversationFixtureQueried(t, journal, "thread/list")
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
