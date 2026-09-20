package runtime

import (
	"context"
	"testing"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestDesktopAdoptionWithoutOriginalConnectionNeverStartsReplacement(t *testing.T) {
	adoption, audience, task := "adoption_fixture_original_0001", "reviewed", "task_fixture_original_0001"
	run, _ := artifactAliasFixture()
	run.TaskID, run.DesktopAdoptionID, run.DesktopAudienceDigest = &task, &adoption, &audience
	// Any fallback would try this deliberately invalid command and report a
	// process/configuration failure instead of the handoff-specific refusal.
	adapter := CodexAdapter{Config: config.AgentConfig{Command: []string{"must-never-execute"}}}
	var events []Event
	if err := adapter.Execute(context.Background(), Request{Run: run}, func(_ context.Context, e Event) error { events = append(events, e); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Status == nil || *events[0].Status != contracts.Failed || events[0].Error == nil || events[0].Error.Code != "DESKTOP_HANDOFF_UNAVAILABLE" || events[0].Reply != "" {
		t.Fatalf("replacement execution was not refused: %#v", events)
	}
}
