package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"convenewire.dev/bridge/internal/config"
)

// These values are local Owner metadata. Never include them in Agent presence,
// a Room response or an authenticated remote member's session inventory.
type CodexConversation struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Workspace   string `json:"workspace"`
	UpdatedAt   int64  `json:"updatedAt"`
	HistoryMode string `json:"historyMode"`
}

type CodexConversationPage struct {
	Conversations []CodexConversation `json:"conversations"`
	NextCursor    string              `json:"nextCursor,omitempty"`
}

var ErrCodexConversationMetadata = errors.New("Codex conversation metadata is unavailable")

const codexConversationTimeout = 5 * time.Second
const codexConversationMaxOutput = 1 << 20
const codexConversationPageSize = 25

type codexThreadMetadata struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Cwd         string `json:"cwd"`
	UpdatedAt   int64  `json:"updatedAt"`
	HistoryMode string `json:"historyMode"`
	// Preview, history, private storage path and runtime status are deliberately
	// not projected. Another app-server's status does not prove writer ownership.
}

type codexMetadataReply struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

// ListCodexConversations reads one bounded page for the Agent's exact workspace.
// It neither loads a Thread for execution nor starts or resumes any model turn.
func ListCodexConversations(ctx context.Context, agent config.AgentConfig, cursor string) (CodexConversationPage, error) {
	if !validCodexMetadataText(cursor, 4096, true) {
		return CodexConversationPage{}, ErrCodexConversationMetadata
	}
	params := map[string]any{
		"cwd": agent.Workspace, "limit": codexConversationPageSize, "sortKey": "updated_at",
		"sourceKinds": []string{"vscode", "appServer", "cli"}, "useStateDbOnly": true,
	}
	if cursor != "" {
		params["cursor"] = cursor
	}
	raw, err := queryCodexConversationMetadata(ctx, agent, "thread/list", params)
	if err != nil {
		return CodexConversationPage{}, err
	}
	var reply struct {
		Data       []codexThreadMetadata `json:"data"`
		NextCursor string                `json:"nextCursor"`
	}
	if json.Unmarshal(raw, &reply) != nil || reply.Data == nil || len(reply.Data) > codexConversationPageSize ||
		!validCodexMetadataText(reply.NextCursor, 4096, true) {
		return CodexConversationPage{}, ErrCodexConversationMetadata
	}
	page := CodexConversationPage{Conversations: make([]CodexConversation, 0, len(reply.Data)), NextCursor: reply.NextCursor}
	seen := make(map[string]bool)
	for _, thread := range reply.Data {
		value, err := projectCodexConversation(agent, thread)
		if err != nil || seen[value.ID] {
			return CodexConversationPage{}, ErrCodexConversationMetadata
		}
		seen[value.ID] = true
		page.Conversations = append(page.Conversations, value)
	}
	return page, nil
}

// ReadCodexConversation rechecks the selected local Thread without loading its
// history. Success is metadata availability, never permission to take control.
func ReadCodexConversation(ctx context.Context, agent config.AgentConfig, id string) (CodexConversation, error) {
	if !validCodexThreadID(id) {
		return CodexConversation{}, ErrCodexConversationMetadata
	}
	raw, err := queryCodexConversationMetadata(ctx, agent, "thread/read", map[string]any{"threadId": id, "includeTurns": false})
	if err != nil {
		return CodexConversation{}, err
	}
	var reply struct {
		Thread codexThreadMetadata `json:"thread"`
	}
	if json.Unmarshal(raw, &reply) != nil || reply.Thread.ID != id {
		return CodexConversation{}, ErrCodexConversationMetadata
	}
	return projectCodexConversation(agent, reply.Thread)
}

func projectCodexConversation(agent config.AgentConfig, thread codexThreadMetadata) (CodexConversation, error) {
	if !validCodexThreadID(thread.ID) || !validCodexMetadataText(thread.Name, 512, true) || thread.UpdatedAt < 0 ||
		!filepath.IsAbs(thread.Cwd) || filepath.Clean(thread.Cwd) != filepath.Clean(agent.Workspace) {
		return CodexConversation{}, ErrCodexConversationMetadata
	}
	mode := thread.HistoryMode
	if mode == "" {
		mode = "unknown" // Old metadata is not evidence of a supported history format.
	}
	if mode != "legacy" && mode != "paginated" && mode != "unknown" {
		return CodexConversation{}, ErrCodexConversationMetadata
	}
	return CodexConversation{ID: thread.ID, Title: thread.Name, Workspace: thread.Cwd,
		UpdatedAt: thread.UpdatedAt, HistoryMode: mode}, nil
}

func validCodexThreadID(value string) bool {
	if !validCodexMetadataText(value, 128, false) {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func validCodexMetadataText(value string, maxBytes int, empty bool) bool {
	if (!empty && strings.TrimSpace(value) == "") || len(value) > maxBytes || !utf8.ValidString(value) {
		return false
	}
	return strings.IndexFunc(value, unicode.IsControl) < 0
}

func queryCodexConversationMetadata(ctx context.Context, agent config.AgentConfig, method string, params any) (json.RawMessage, error) {
	if (method != "thread/list" && method != "thread/read") || agent.Adapter != "codex" ||
		(agent.RuntimeKind != "" && agent.RuntimeKind != "codex") || !filepath.IsAbs(agent.Workspace) ||
		validateCodexCommand(agent.Command) != nil {
		return nil, ErrCodexConversationMetadata
	}
	ctx, cancel := context.WithTimeout(ctx, codexConversationTimeout)
	defer cancel()
	command, owned, err := NewOwnedCommand(ctx, agent.Command)
	if err != nil {
		return nil, ErrCodexConversationMetadata
	}
	command.Dir, command.Env, command.Stderr = agent.Workspace, allowedEnvironment(agent.EnvAllowlist), io.Discard
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, ErrCodexConversationMetadata
	}
	defer stdin.Close()
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, ErrCodexConversationMetadata
	}
	defer stdout.Close()
	if owned.Start() != nil {
		return nil, ErrCodexConversationMetadata
	}
	replies := make(chan codexMetadataReply)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer close(replies)
		scanner := bufio.NewScanner(io.LimitReader(stdout, codexConversationMaxOutput+1))
		scanner.Buffer(make([]byte, 4096), codexConversationMaxOutput)
		readBytes := 0
		for scanner.Scan() {
			readBytes += len(scanner.Bytes()) + 1
			if readBytes > codexConversationMaxOutput {
				return
			}
			var reply codexMetadataReply
			if json.Unmarshal(scanner.Bytes(), &reply) != nil {
				return
			}
			if len(reply.ID) == 0 && reply.Method != "" {
				continue
			}
			if len(reply.ID) == 0 || reply.Method != "" {
				return // Discovery can never answer an approval or execute a tool.
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
		_ = owned.Wait()
		_ = stdout.Close()
		<-readDone
	}()
	encoder := json.NewEncoder(stdin)
	call := func(id int, name string, arguments any) (json.RawMessage, error) {
		if encoder.Encode(map[string]any{"id": id, "method": name, "params": arguments}) != nil {
			return nil, ErrCodexConversationMetadata
		}
		select {
		case reply, ok := <-replies:
			var responseID int
			if !ok || json.Unmarshal(reply.ID, &responseID) != nil || responseID != id ||
				len(reply.Error) > 0 && string(reply.Error) != "null" || len(reply.Result) == 0 || string(reply.Result) == "null" {
				return nil, ErrCodexConversationMetadata
			}
			return reply.Result, nil
		case <-ctx.Done():
			return nil, ErrCodexConversationMetadata
		}
	}
	if _, err := call(1, "initialize", map[string]any{"clientInfo": map[string]string{"name": "convenewire_conversation_metadata", "version": "1"}}); err != nil {
		return nil, err
	}
	if encoder.Encode(map[string]any{"method": "initialized"}) != nil {
		return nil, ErrCodexConversationMetadata
	}
	return call(2, method, params)
}
