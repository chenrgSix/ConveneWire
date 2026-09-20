//go:build darwin || linux

package desktopcodex

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func fixture(t *testing.T) (Plan, string, string) {
	t.Helper()
	root := t.TempDir()
	app := filepath.Join(root, "Codex.app")
	desktop := filepath.Join(app, "Contents", "MacOS", "Codex")
	provider := filepath.Join(app, "Contents", "Resources", "codex")
	archive := filepath.Join(app, "Contents", "Resources", "app.asar")
	proxy := filepath.Join(root, "proxy")
	for name, content := range map[string]string{desktop: "desktop", provider: "provider", archive: "archive", proxy: "proxy"} {
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(content), 0700); err != nil {
			t.Fatal(err)
		}
	}
	target := filepath.Join(root, "launch", "plan.json")
	plan, err := Prepare(desktop, target)
	if err != nil {
		t.Fatal(err)
	}
	return plan, target, proxy
}

func TestPrivateImmutablePlan(t *testing.T) {
	plan, target, proxy := fixture(t)
	verified, err := LoadVerified(target, proxy)
	if err != nil || verified != plan {
		t.Fatalf("verify prepared plan: %v", err)
	}
	info, err := os.Stat(target)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("plan must be owner-only")
	}
	before, _ := os.ReadFile(target)
	if _, err := Prepare(plan.Desktop.Path, target); err == nil {
		t.Fatal("preparation must not overwrite a previous plan")
	}
	after, _ := os.ReadFile(target)
	if string(before) != string(after) {
		t.Fatal("failed preparation changed the original plan")
	}
}

func TestRejectChangedComponentsAndRecursion(t *testing.T) {
	for _, component := range []string{"desktop", "provider", "archive", "provider-link", "recursive-copy"} {
		t.Run(component, func(t *testing.T) {
			plan, target, proxy := fixture(t)
			switch component {
			case "desktop":
				os.WriteFile(plan.Desktop.Path, []byte("updated"), 0700)
			case "provider":
				os.WriteFile(plan.Provider.Path, []byte("updated"), 0700)
			case "archive":
				os.WriteFile(plan.Archive.Path, []byte("updated"), 0700)
			case "provider-link":
				copyPath := plan.Provider.Path + ".copy"
				if err := os.Rename(plan.Provider.Path, copyPath); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(copyPath, plan.Provider.Path); err != nil {
					t.Fatal(err)
				}
			case "recursive-copy":
				os.WriteFile(proxy, []byte("provider"), 0700)
			}
			if _, err := LoadVerified(target, proxy); err == nil {
				t.Fatal("unsafe component was accepted")
			}
		})
	}
	plan, target, _ := fixture(t)
	if _, err := LoadVerified(target, plan.Provider.Path); err == nil {
		t.Fatal("direct proxy recursion was accepted")
	}
}

func TestRejectUnsafeOrMalformedPlan(t *testing.T) {
	for _, mode := range []string{"public", "symlink", "trailing", "unknown", "oversized", "mixed-bundle"} {
		t.Run(mode, func(t *testing.T) {
			plan, target, proxy := fixture(t)
			data, _ := os.ReadFile(target)
			switch mode {
			case "public":
				if err := os.Chmod(target, 0644); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Rename(target, target+".original"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target+".original", target); err != nil {
					t.Fatal(err)
				}
			case "trailing":
				os.WriteFile(target, append(data, []byte(" {}")...), 0600)
			case "unknown":
				os.WriteFile(target, []byte(strings.Replace(string(data), `"version": 1`, `"version": 1, "fallback": true`, 1)), 0600)
			case "oversized":
				os.WriteFile(target, []byte(strings.Repeat(" ", 17<<10)), 0600)
			case "mixed-bundle":
				plan.Provider.Path = proxy
				data, _ := json.Marshal(plan)
				os.WriteFile(target, data, 0600)
			}
			if _, err := LoadVerified(target, proxy); err == nil {
				t.Fatal("unsafe plan was accepted")
			}
		})
	}
}

func TestDesktopArgumentBoundary(t *testing.T) {
	for _, args := range [][]string{
		{"--version"}, {"-V"}, {"app-server"},
		{"-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled"},
		{"app-server", "--listen", "stdio://", "-c", "model_provider=fixture"},
		{"--enable=example", "app-server", "--listen=stdio://", "--disable", "another"},
	} {
		if err := ValidateArguments(args); err != nil {
			t.Fatalf("valid desktop invocation %v: %v", args, err)
		}
	}
	for _, args := range [][]string{
		nil, {"exec", "prompt"}, {"app-server", "daemon", "start"}, {"app-server", "proxy"},
		{"app-server", "--listen", "ws://127.0.0.1:1234"}, {"app-server", "--listen=unix://"},
		{"-c"}, {"app-server", "--config="}, {"--config=features.test=true"},
		{"app-server", "--listen=stdio://", "--listen=ws://0.0.0.0:1234"},
	} {
		if err := ValidateArguments(args); err == nil {
			t.Fatalf("unsupported invocation accepted: %v", args)
		}
	}
}

func TestLaunchCannotDuplicateOrOverrideAnotherTransport(t *testing.T) {
	plan, target, proxy := fixture(t)
	if _, err := LaunchArguments(plan, target, proxy, nil, true); !errors.Is(err, ErrDesktopRunning) {
		t.Fatalf("running desktop must block launch: %v", err)
	}
	for _, entry := range []string{"CODEX_APP_SERVER_WS_URL=ws://127.0.0.1:1234", "CODEX_CLI_PATH=/some/other/provider"} {
		if _, err := LaunchArguments(plan, target, proxy, []string{entry}, false); err == nil {
			t.Fatal("pre-existing transport override must not be silently replaced")
		}
	}
	args, err := LaunchArguments(plan, target, proxy, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"-a", plan.Bundle(), "--env", "CODEX_CLI_PATH=" + proxy, "--env", ConfigEnvironment + "=" + target}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("unexpected launch arguments: %v", args)
	}
	if _, err := LaunchArguments(plan, target, proxy, []string{"CODEX_CLI_PATH=" + plan.Provider.Path}, false); err != nil {
		t.Fatalf("the already pinned native provider is not a conflicting override: %v", err)
	}
}

func TestProviderRetainsProfileAndToolHost(t *testing.T) {
	input := []string{"HOME=/owner", "CODEX_HOME=/owner/custom", "DESKTOP_TOOL_SOCKET=/owned/socket", "CODEX_CLI_PATH=/proxy", ConfigEnvironment + "=/plan"}
	got := ProviderEnvironment(input, "/native/codex")
	want := []string{"HOME=/owner", "CODEX_HOME=/owner/custom", "DESKTOP_TOOL_SOCKET=/owned/socket", "CODEX_CLI_PATH=/native/codex"}
	if !reflect.DeepEqual(got, want) || len(input) != 5 {
		t.Fatal("proxy changed the owner's profile/tool environment or retained its own execution override")
	}
}
