package config

import (
	"strings"
	"testing"
)

func TestConfiguredModelSelectors(t *testing.T) {
	for _, tc := range []struct {
		name, kind, want string
		args             []string
	}{
		{"codex override", "codex", "gpt-6-astra", []string{"codex", "app-server", "-c", `model="gpt-6-astra"`}},
		{"codex long override", "codex", "vendor/model-v1", []string{"codex", "app-server", "--config=model='vendor/model-v1'"}},
		{"pi override", "pi", "provider/model", []string{"pi", "--mode", "rpc", "--model", "provider/model"}},
		{"default", "codex", "", CodexPresetCommand("codex")},
		{"profile", "codex", "", []string{"codex", "app-server", "-c", "model=gpt-6-astra", "--profile=review"}},
		{"duplicate", "codex", "", []string{"codex", "app-server", "-c", "model=one", "-c", "model=two"}},
		{"cycling", "pi", "", []string{"pi", "--model", "one", "--models", "one,two"}},
		{"missing", "pi", "", []string{"pi", "--model"}},
		{"other runtime", "generic", "", []string{"tool", "--model", "one"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			model := (AgentConfig{Adapter: tc.kind, Command: tc.args}).ConfiguredModel()
			if tc.want == "" {
				if model != nil {
					t.Fatalf("expected unknown, got %q", *model)
				}
			} else if model == nil || *model != tc.want {
				t.Fatalf("expected %q, got %v", tc.want, model)
			}
		})
	}
}

func TestModelMetadataRejectsUnsafeValuesAndCustomCommands(t *testing.T) {
	for _, value := range []string{"", " ", "/Users/alice/config", "https://provider/model", "model\nsecret", "sk-secret", "sk_secret", strings.Repeat("a", 121)} {
		if SafeModelName(value) != nil {
			t.Errorf("accepted unsafe model %q", value)
		}
	}
	preset := AgentConfig{RuntimeKind: "codex", Command: CodexPresetCommand("/opt/codex")}
	if !preset.UsesDefaultCodexModel() {
		t.Fatal("native preset was rejected")
	}
	for _, args := range [][]string{{}, {"", "app-server", "--listen", "stdio://"}, {"codex", "app-server"}, {"wrapper", "codex", "app-server", "--listen", "stdio://"}, append(CodexPresetCommand("codex"), "--profile", "review")} {
		preset.Command = args
		if preset.UsesDefaultCodexModel() {
			t.Errorf("custom command accepted: %v", args)
		}
	}
	preset.RuntimeKind, preset.Command = "pi", CodexPresetCommand("codex")
	if preset.UsesDefaultCodexModel() {
		t.Fatal("wrong runtime accepted")
	}
}
