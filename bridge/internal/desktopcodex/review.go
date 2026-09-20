package desktopcodex

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"sort"
)

// ThreadView never crosses the native Console boundary.
type ThreadView struct {
	ThreadID      string   `json:"threadId"`
	Title         string   `json:"title"`
	Workspace     string   `json:"workspace"`
	Model         string   `json:"model"`
	Provider      string   `json:"provider"`
	Sandbox       string   `json:"sandbox"`
	Configuration string   `json:"configuration"`
	Tools         []string `json:"tools"`
	Revision      uint64   `json:"revision"`
	Busy          bool     `json:"busy"`
}

func digest(value any) string {
	data := raw(value)
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if decoder.Decode(&decoded) == nil {
		data = raw(decoded)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func makeThreadView(id string, thread, result, params envelope, revision uint64) ThreadView {
	view := ThreadView{ThreadID: id, Title: stringField(thread, "name"), Workspace: stringField(result, "cwd"), Model: stringField(result, "model"), Provider: stringField(result, "modelProvider"), Sandbox: stringField(objectField(result, "sandbox"), "type"), Configuration: digest(params), Revision: revision}
	if view.Workspace == "" {
		view.Workspace = stringField(thread, "cwd")
	}
	if view.Title == "" {
		view.Title = stringField(thread, "preview")
	}
	if len(view.Title) > 240 {
		view.Title = "Codex conversation"
	}
	var tools []envelope
	_ = json.Unmarshal(params["dynamicTools"], &tools)
	for _, tool := range tools {
		if name := stringField(tool, "name"); name != "" {
			view.Tools = append(view.Tools, name)
		}
	}
	for key, value := range objectField(params, "config") {
		if key == "mcp_servers.codex_app.enabled_tools" || key == "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools" {
			var names []string
			if json.Unmarshal(value, &names) == nil {
				view.Tools = append(view.Tools, names...)
			}
		}
	}
	sort.Strings(view.Tools)
	return view
}
func (m *Mediator) List(ctx context.Context) ([]ThreadView, error) {
	r, e := m.command(ctx, controlCommand{kind: "list"})
	return r.views, e
}
func (m *Mediator) snapshot(ctx context.Context, f Fence) (ThreadView, error) {
	r, e := m.command(ctx, controlCommand{kind: "snapshot", fence: f})
	return r.view, e
}
func (m *Mediator) checkRead(ctx context.Context, f Fence, kind string) (json.RawMessage, error) {
	r, e := m.command(ctx, controlCommand{kind: kind, fence: f})
	return r.metadata, e
}
func (m *Mediator) Interrupt(ctx context.Context, f Fence) error {
	_, e := m.command(ctx, controlCommand{kind: "interrupt", fence: f})
	return e
}

type Review struct {
	Thread           ThreadView `json:"thread"`
	Fingerprint      string     `json:"fingerprint"`
	AuthorityDigest  string     `json:"authorityDigest"`
	CheckpointDigest string     `json:"checkpointDigest"`
}

// Review fences source input before reading current configuration. Tool inventory
// is obtained on the original connection; secrets and transcript text are hashed,
// not returned in the review or forwarded to the Hub.
func (m *Mediator) Review(ctx context.Context, f Fence) (Review, error) {
	state, err := m.State(ctx, f)
	if err != nil {
		return Review{}, err
	}
	if state.Running || state.Paused || state.Uncertain {
		return Review{}, ErrBusy
	}
	view, err := m.snapshot(ctx, f)
	if err != nil {
		return Review{}, err
	}
	cwd, e := filepath.EvalSymlinks(view.Workspace)
	if e != nil || !filepath.IsAbs(cwd) || cwd != view.Workspace || view.Model == "" || view.Provider == "" {
		return Review{}, ErrUnavailable
	}
	meta, err := m.ReadMetadata(ctx, f)
	if err != nil {
		return Review{}, err
	}
	var metadata struct {
		Thread struct {
			ID     string `json:"id"`
			Status struct {
				Type string `json:"type"`
			} `json:"status"`
		} `json:"thread"`
	}
	if json.Unmarshal(meta, &metadata) != nil || metadata.Thread.ID != view.ThreadID || metadata.Thread.Status.Type != "idle" {
		return Review{}, ErrBusy
	}
	queue, err := m.checkRead(ctx, f, "queue")
	if err != nil {
		return Review{}, err
	}
	var q struct {
		Data []json.RawMessage `json:"data"`
	}
	if json.Unmarshal(queue, &q) != nil || q.Data == nil || len(q.Data) != 0 {
		return Review{}, ErrBusy
	}
	goal, err := m.checkRead(ctx, f, "goal")
	if err != nil {
		return Review{}, err
	}
	var g envelope
	if json.Unmarshal(goal, &g) != nil || g["goal"] == nil || string(g["goal"]) != "null" {
		return Review{}, ErrBusy
	}
	configuration, err := m.checkRead(ctx, f, "config")
	if err != nil {
		return Review{}, err
	}
	toolData, err := m.checkRead(ctx, f, "tools")
	if err != nil {
		return Review{}, err
	}
	var inventory struct {
		Data []struct {
			Name  string                     `json:"name"`
			Tools map[string]json.RawMessage `json:"tools"`
		} `json:"data"`
		NextCursor *string `json:"nextCursor"`
	}
	if json.Unmarshal(toolData, &inventory) != nil || inventory.NextCursor != nil {
		return Review{}, ErrUnavailable
	}
	for _, server := range inventory.Data {
		for name := range server.Tools {
			view.Tools = append(view.Tools, server.Name+"/"+name)
		}
	}
	sort.Strings(view.Tools)
	if len(view.Tools) > 512 {
		return Review{}, ErrCapacity
	}
	state, err = m.State(ctx, f)
	if err != nil || state.Running || state.Paused || state.Uncertain {
		return Review{}, ErrBusy
	}
	authorityView := view
	authorityView.Revision = 0
	authorityView.Title = ""
	authorityView.Busy = false
	authorityDigest := digest([]any{authorityView, json.RawMessage(configuration), json.RawMessage(toolData)})
	return Review{Thread: view, AuthorityDigest: authorityDigest, CheckpointDigest: digest(json.RawMessage(meta)), Fingerprint: digest([]any{view, json.RawMessage(meta), authorityDigest})}, nil
}
