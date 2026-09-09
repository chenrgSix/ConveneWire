package runtime

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	contracts "convenewire.dev/contracts/generated/go"
)

// ApprovalFunc transports one immutable request. It never starts a Runtime.
type ApprovalFunc func(context.Context, contracts.RuntimeApprovalRequestedPayload) (bool, error)

func (p *codexAppServerParser) answerApproval(message codexAppServerMessage) ([]any, error) {
	var value struct {
		ThreadID      string          `json:"threadId"`
		TurnID        string          `json:"turnId"`
		ItemID        string          `json:"itemId"`
		Command       string          `json:"command"`
		Cwd           string          `json:"cwd"`
		Reason        string          `json:"reason"`
		Kind          string          `json:"kind"`
		GrantRoot     *string         `json:"grantRoot"`
		Network       json.RawMessage `json:"networkApprovalContext"`
		EnvironmentID *string         `json:"environmentId"`
	}
	if json.Unmarshal(message.Params, &value) != nil || value.ThreadID != p.threadID ||
		value.TurnID != p.turnID || p.turnID == "" || value.ItemID == "" {
		return nil, errors.New("Runtime approval identity is invalid")
	}
	// Keep Runtime callback IDs local and reject reuse, including changed content.
	key := string(message.ID)
	if p.approvalCallbacks[key] {
		return nil, errors.New("Runtime reused an approval callback")
	}
	p.approvalCallbacks[key] = true
	var id any
	if json.Unmarshal(message.ID, &id) != nil {
		return nil, errors.New("Invalid approval callback")
	}
	decision := "decline"
	var kind contracts.OperationKind
	var details string
	switch message.Method {
	case "item/commandExecution/requestApproval":
		if strings.TrimSpace(value.Command) == "" || value.Cwd == "" ||
			(value.Kind != "" && value.Kind != "command") || value.EnvironmentID != nil ||
			(len(value.Network) > 0 && string(value.Network) != "null") {
			return nil, errors.New("Unsupported command approval scope")
		}
		kind = "command"
		details = "Command:\n" + value.Command + "\n\nWorking directory:\n" + value.Cwd + "\n\nReason:\n" + value.Reason
	case "item/fileChange/requestApproval":
		changes := p.approvalFileChanges[value.ItemID]
		// grantRoot is a session-wide grant, outside single-operation approval.
		if value.GrantRoot != nil || changes == "" {
			return nil, errors.New("Unsupported file approval scope")
		}
		kind = "file_change"
		details = "File changes:\n" + changes + "\n\nReason:\n" + value.Reason
	default:
		return nil, errors.New("Unsupported interactive Runtime request")
	}
	if !utf8.ValidString(details) || utf8.RuneCountInString(details) > 12000 || RedactSensitiveText(details) != details {
		return nil, errors.New("Runtime approval details cannot be safely reviewed remotely")
	}
	random := make([]byte, 24)
	if _, err := rand.Read(random); err != nil {
		return nil, err
	}
	expires := time.Now().Add(5 * time.Minute).UTC()
	if deadline, ok := p.approvalContext.Deadline(); ok && deadline.Before(expires) {
		expires = deadline
	}
	request := contracts.RuntimeApprovalRequestedPayload{RequestID: "approval_" + hex.EncodeToString(random),
		RunID: p.runID, AgentID: p.approvalAgentID, Revision: p.config.CentralApprovalRevision,
		OperationKind: kind, Details: details, ExpiresAt: expires}
	approved, err := p.approve(p.approvalContext, request)
	if err != nil {
		return nil, fmt.Errorf("Central approval is unavailable")
	}
	if approved && p.approvalContext.Err() == nil {
		decision = "accept"
	}
	return []any{map[string]any{"id": id, "result": map[string]string{"decision": decision}}}, nil
}

func (p *codexAppServerParser) retainApprovalFileChanges(params json.RawMessage) {
	if p.approve == nil {
		return
	}
	var value struct {
		ThreadID string `json:"threadId"`
		TurnID   string `json:"turnId"`
		Item     struct {
			ID      string          `json:"id"`
			Type    string          `json:"type"`
			Changes json.RawMessage `json:"changes"`
		} `json:"item"`
	}
	if json.Unmarshal(params, &value) != nil || value.ThreadID != p.threadID || value.TurnID != p.turnID ||
		value.Item.Type != "fileChange" || value.Item.ID == "" || len(value.Item.Changes) < 3 || len(value.Item.Changes) > 12000 {
		return
	}
	var changes []struct {
		Path string          `json:"path"`
		Diff string          `json:"diff"`
		Kind json.RawMessage `json:"kind"`
	}
	if json.Unmarshal(value.Item.Changes, &changes) != nil || len(changes) == 0 {
		return
	}
	for _, change := range changes {
		if change.Path == "" || len(change.Kind) == 0 {
			return
		}
	}
	p.approvalFileChanges[value.Item.ID] = string(value.Item.Changes)
}
