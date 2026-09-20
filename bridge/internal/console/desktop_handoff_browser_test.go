package console

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"
)

// Real embedded UI, synthetic native state. No owner profile, Codex process or
// model is opened by this opt-in visual fixture.
func TestDesktopHandoffBrowserFixture(t *testing.T) {
	if os.Getenv("CONVENE_WIRE_HANDOFF_UI_FIXTURE") != "1" {
		t.Skip("opt-in isolated handoff UI")
	}
	service, _ := pairedRecoveryService(t, inertDependencies())
	service.mu.Lock()
	service.configuration.LocalNodeID = "node_fixture_visual01"
	service.state.LocalNodeID = "node_fixture_visual01"
	service.mu.Unlock()
	thread := map[string]any{"threadId": "synthetic-original-thread", "title": "继续实现工作区搜索", "workspace": "/Projects/SearchWorkbench", "model": "gpt-fixture", "provider": "本机 Codex", "tools": []string{"文件与终端", "项目检索"}}
	scope := map[string]any{"taskTitle": "完成搜索入口", "roomName": "产品研发", "agentName": "本机 Codex", "audience": []string{"Local Owner", "协作成员", "本机 Codex (Agent)"}, "state": "available"}
	view := map[string]any{"taskId": "task_visual_fixture01", "scope": scope, "connected": true, "threads": []any{thread}}
	var mu sync.Mutex
	finished := make(chan struct{})
	var once sync.Once
	mux := http.NewServeMux()
	mux.HandleFunc("/api/desktop-codex", service.authorize(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == "POST" {
			var input struct {
				Action, TaskID, ThreadID, ReviewID string
				Disclose                           bool
			}
			if decodeJSON(r, &input) != nil {
				writeError(w, 400, "invalid fixture input")
				return
			}
			switch input.Action {
			case "review":
				view["adoption"] = map[string]any{"id": "visual-adoption", "reviewId": "review-visual01", "state": "reviewed", "sandbox": "workspace-write", "review": map[string]any{"thread": thread}}
			case "confirm":
				if !input.Disclose {
					writeError(w, 400, "consent required")
					return
				}
				view["adoption"].(map[string]any)["state"] = "attached"
			case "release":
				view["adoption"].(map[string]any)["state"] = "released"
			}
		}
		writeJSON(w, 200, view)
	}))
	mux.HandleFunc("POST /fixture/stop", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204); once.Do(func() { close(finished) }) })
	mux.Handle("/", service.Handler())
	server := httptest.NewServer(mux)
	defer server.Close()
	fmt.Printf("HANDOFF_UI_FIXTURE_URL=%s/?token=%s&workspace=1&handoff=1&theme=light\n", server.URL, service.Token())
	select {
	case <-finished:
	case <-time.After(15 * time.Minute):
		t.Fatal("UI fixture timed out")
	}
}
