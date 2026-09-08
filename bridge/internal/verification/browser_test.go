package verification

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func browserTestSpec() *BrowserSpec {
	return &BrowserSpec{Version: 1, DocumentRoot: ".", StartPath: "/", Width: 900, Height: 700, Steps: []BrowserStep{{Action: "visible", Selector: "h1"}}, Screenshot: true}
}

func TestBrowserProfilePinsDocumentScopeAndRejectsCommands(t *testing.T) {
	executable := filepath.Join(t.TempDir(), "chrome-headless-shell")
	if err := os.WriteFile(executable, []byte("owner-selected browser fingerprint"), 0o700); err != nil {
		t.Fatal(err)
	}
	spec := ProfileSpec{ProfileID: "profile_browser0001", Revision: 1, Command: []string{executable}, EnvironmentNames: []string{}, TimeoutMilliseconds: 10000, OutputLimitBytes: 1 << 20, Browser: browserTestSpec()}
	dataDir := filepath.Join(t.TempDir(), "data")
	if err := os.Mkdir(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	store, err := OpenProfileStore(dataDir, testOwner())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	view, err := store.Register(spec, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := store.Resolve(Reference{ProfileID: view.ProfileID, Revision: 1, Digest: view.Digest})
	if err != nil || resolved.Browser == nil {
		t.Fatal(err)
	}
	resolved.Browser.Steps[0].Selector = ".changed"
	again, err := store.Resolve(resolved.Reference)
	if err != nil || again.Browser.Steps[0].Selector != "h1" {
		t.Fatal("mutable resolved browser scope", err)
	}
	for name, mutate := range map[string]func(*ProfileSpec){
		"desktop browser":    func(s *ProfileSpec) { s.Command[0] = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
		"extra flags":        func(s *ProfileSpec) { s.Command = append(s.Command, "--no-sandbox") },
		"outside root":       func(s *ProfileSpec) { s.Browser.DocumentRoot = "../secrets" },
		"remote URL":         func(s *ProfileSpec) { s.Browser.StartPath = "https://example.com" },
		"arbitrary script":   func(s *ProfileSpec) { s.Browser.Steps[0].Action = "evaluate" },
		"unbounded viewport": func(s *ProfileSpec) { s.Browser.Width = 10000 },
	} {
		t.Run(name, func(t *testing.T) {
			copy := spec
			copy.Command = append([]string{}, spec.Command...)
			copy.Browser = cloneBrowserSpec(spec.Browser)
			mutate(&copy)
			raw, _ := json.Marshal(copy)
			if _, err := DecodeProfileSpec(raw); err == nil {
				t.Fatal("unsafe profile accepted")
			}
		})
	}
	changed := spec
	changed.Browser = cloneBrowserSpec(spec.Browser)
	changed.Browser.StartPath = "/other.html"
	if _, err := store.Register(changed, time.Now()); !errors.Is(err, ErrProfileConflict) {
		t.Fatal("changed browser intent reused immutable profile", err)
	}
}

func TestBrowserSiteDeniesTraversalSymlinksOtherOriginsAndWrites(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<h1>candidate</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".env"), []byte("private"), 0o600); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Symlink(".env", filepath.Join(root, "secret.txt")); err != nil {
			t.Fatal(err)
		}
	}
	site, err := openBrowserSite(root, ".")
	if err != nil {
		t.Fatal(err)
	}
	defer site.close()
	proxy, _ := url.Parse(site.proxy)
	transport := &http.Transport{Proxy: http.ProxyURL(proxy)}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Second}
	response, err := client.Get(site.origin + "/")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(response.Header.Get("Content-Security-Policy"), "connect-src 'self'") {
		t.Fatal("candidate policy missing")
	}
	for _, target := range []string{site.origin + "/.env", site.origin + "/secret.txt", site.origin + "/%2e%2e/.env", "http://127.0.0.1:1/", "https://example.com/"} {
		response, err := client.Get(target)
		if err == nil {
			response.Body.Close()
			if response.StatusCode < 400 {
				t.Fatalf("escaped static origin: %s", target)
			}
		}
	}
	response, err = client.Post(site.origin+"/", "text/plain", strings.NewReader("write"))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("write accepted")
	}
}

func TestBrowserStartupFailureTimeoutAndCancellationRetainDistinctStages(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix fixture executables; native Windows execution separate")
	}
	for _, mode := range []string{"crash", "timeout", "cancel"} {
		t.Run(mode, func(t *testing.T) {
			workspace := t.TempDir()
			parent := t.TempDir()
			executable := filepath.Join(t.TempDir(), "chrome-headless-shell")
			script := "#!/bin/sh\nexit 7\n"
			if mode != "crash" {
				script = "#!/bin/sh\nsleep 30\n"
			}
			if err := os.WriteFile(executable, []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			digest, _ := executableDigest(executable)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				cancel()
			}
			timeout := 500 * time.Millisecond
			if mode == "crash" {
				timeout = 3 * time.Second
			}
			result, err := (Runner{TemporaryParent: parent}).Run(ctx, ResolvedProfile{Executable: executable, ExecutableDigest: digest,
				Timeout: timeout, OutputLimitBytes: 1 << 20, Browser: browserTestSpec()}, workspace)
			if err != nil {
				t.Fatal(err)
			}
			want := OutcomeFailed
			if mode == "timeout" {
				want = OutcomeTimeout
			}
			if mode == "cancel" {
				want = OutcomeCanceled
			}
			if result.Outcome != want {
				t.Fatalf("outcome %s: %s", result.Outcome, result.Log)
			}
			var log struct {
				Browser BrowserReport `json:"browser"`
			}
			if json.Unmarshal(result.Log, &log) != nil {
				t.Fatal("missing browser log")
			}
			if log.Browser.PageLoad != "not_run" || log.Browser.VisualReview != "not_performed" || log.Browser.Cleanup != "completed" {
				t.Fatalf("stages conflated: %s", result.Log)
			}
			entries, _ := os.ReadDir(parent)
			if len(entries) != 0 {
				t.Fatal("browser root leaked")
			}
		})
	}
}

// Explicit local-browser test with a disposable candidate and no model, account,
// user browser profile or installed Bridge changes. Supply an owned executable.
func TestBrowserPhysicalCandidate(t *testing.T) {
	executable := os.Getenv("CONVENE_WIRE_BROWSER_EXECUTABLE")
	if executable == "" {
		t.Skip("opt-in owner-selected local browser")
	}
	var outside atomic.Int32
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { outside.Add(1); w.WriteHeader(200) }))
	defer external.Close()
	workspace := t.TempDir()
	parent := t.TempDir()
	page := `<!doctype html><meta charset="utf-8"><title>Candidate verification</title><style>body{font:18px sans-serif;background:#f5f5ef;padding:40px}button,input{font:inherit;padding:12px;margin:8px}h1{color:#526c39}</style><h1>隔离候选页面</h1><label>任务目标<input id="goal"></label><button id="save" onclick="document.querySelector('#result').textContent=document.querySelector('#goal').value">保存</button><p id="result">待填写</p><p id="network">等待网络检查</p><script>fetch(` + string(mustJSON(external.URL)) + `).then(()=>document.querySelector('#network').textContent='escaped').catch(()=>document.querySelector('#network').textContent='blocked')</script>`
	if err := os.WriteFile(filepath.Join(workspace, "index.html"), []byte(page), 0o600); err != nil {
		t.Fatal(err)
	}
	digest, err := executableDigest(executable)
	if err != nil {
		t.Fatal(err)
	}
	spec := browserTestSpec()
	spec.Steps = []BrowserStep{{Action: "fill", Selector: "#goal", Value: "自动交付验证"}, {Action: "click", Selector: "#save"}, {Action: "text", Selector: "#result", Value: "自动交付验证"}, {Action: "text", Selector: "#network", Value: "blocked"}}
	result, err := (Runner{TemporaryParent: parent}).Run(context.Background(), ResolvedProfile{Executable: executable, ExecutableDigest: digest, Timeout: 20 * time.Second, OutputLimitBytes: 1 << 20, Browser: spec}, workspace)
	if err != nil {
		t.Fatal(err)
	}
	var log struct {
		Browser BrowserReport `json:"browser"`
	}
	if err := json.Unmarshal(result.Log, &log); err != nil {
		t.Fatal(err)
	}
	if result.Outcome != OutcomePassed || log.Browser.Startup != "passed" || log.Browser.PageLoad != "passed" || log.Browser.Screenshot.State != "captured" || log.Browser.VisualReview != "not_performed" {
		t.Fatalf("physical browser verification: %s", result.Log)
	}
	if outside.Load() != 0 {
		t.Fatal("candidate reached an unapproved origin")
	}
	if entries, _ := os.ReadDir(parent); len(entries) != 0 {
		t.Fatal("browser process/profile root leaked")
	}
	if destination := os.Getenv("CONVENE_WIRE_BROWSER_EVIDENCE_DIR"); destination != "" {
		if err := os.MkdirAll(destination, 0o700); err != nil {
			t.Fatal(err)
		}
		image, err := base64.StdEncoding.DecodeString(log.Browser.Screenshot.Data)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(destination, "candidate.png"), image, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(destination, "browser-result.json"), result.Log, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}
