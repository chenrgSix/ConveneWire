package connection

import (
	"encoding/json"
	"strings"
	"testing"

	"convenewire.dev/bridge/internal/config"
)

func TestAgentPublicationUsesConnectionModelSnapshot(t *testing.T) {
	agent := config.AgentConfig{Name: "Builder", Adapter: "codex", Workspace: t.TempDir(), Command: config.CodexPresetCommand("codex")}
	client := Client{}
	model := "fixture-default"
	for i := 0; i < 2; i++ {
		publication, err := client.agentPublication(agent, "agent_fixture12345678", PreparedRuns{}, &model)
		if err != nil {
			t.Fatal(err)
		}
		if publication.Payload.ConfiguredModel == nil || *publication.Payload.ConfiguredModel != model {
			t.Fatal("connection snapshot lost during publication")
		}
		data, err := json.Marshal(publication)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), agent.Workspace) || strings.Contains(string(data), "app-server") {
			t.Fatal("local configuration leaked in publication")
		}
	}
	publication, err := client.agentPublication(agent, "agent_fixture12345678", PreparedRuns{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if publication.Payload.ConfiguredModel != nil {
		t.Fatal("missing metadata reused stale model")
	}
}
