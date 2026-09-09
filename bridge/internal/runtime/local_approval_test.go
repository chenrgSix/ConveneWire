package runtime

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"convenewire.dev/bridge/internal/config"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestLocalApprovalBindsOneChildWithoutDeviceConsent(t *testing.T) {
	for _, mode := range []string{"allow", "deny", "disconnect", "child exit"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("CONVENE_WIRE_APPROVAL_FIXTURE", "1")
			if mode == "child exit" {
				t.Setenv("CONVENE_WIRE_APPROVAL_FIXTURE_EXIT", "1")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			workspace := t.TempDir()
			requested, answer, done := make(chan struct{}), make(chan bool, 1), make(chan error, 1)
			opened, closed := 0, 0
			var live context.Context
			adapter := CodexAdapter{Config: config.AgentConfig{Adapter: "codex", RuntimeKind: "codex", Sandbox: "workspace-write", Workspace: workspace,
				Command:      []string{os.Args[0], "-test.run=^TestCentralApprovalProcessFixture$", "--", "app-server"},
				EnvAllowlist: []string{"CONVENE_WIRE_APPROVAL_FIXTURE", "CONVENE_WIRE_APPROVAL_FIXTURE_EXIT"}},
				Approve: func(context.Context, contracts.RuntimeApprovalRequestedPayload) (bool, error) {
					t.Error("Peer callback reached Central approval")
					return false, nil
				},
				LocalApproval: func(ctx context.Context) (LocalApprovalSession, error) {
					opened++
					live = ctx
					return LocalApprovalSession{Revision: 7, Close: func() { closed++ }, Approve: func(ctx context.Context, input contracts.RuntimeApprovalRequestedPayload) (bool, error) {
						if input.Revision != 7 || input.RunID != "run_localapproval001" || input.AgentID != "agent_projection001" {
							t.Error("local revision or execution binding lost")
						}
						close(requested)
						select {
						case value := <-answer:
							return value, nil
						case <-ctx.Done():
							return false, ctx.Err()
						}
					}}, nil
				}}
			run := contracts.RunRequestedPayload{RunID: "run_localapproval001", RoomID: "room_localapproval001", TargetAgentID: "agent_projection001",
				Instruction: "Write a reviewed test file", Deadline: time.Now().Add(time.Minute)}
			go func() {
				done <- adapter.Execute(ctx, Request{Run: run}, func(context.Context, Event) error { return nil })
			}()
			if mode != "child exit" {
				select {
				case <-requested:
				case <-done:
					t.Fatal("child did not request local approval")
				case <-ctx.Done():
					t.Fatal("local callback unavailable")
				}
				if _, err := os.Stat(filepath.Join(workspace, "permission-test.txt")); !os.IsNotExist(err) {
					t.Fatal("unreviewed side effect")
				}
				if mode == "disconnect" {
					cancel()
				} else {
					answer <- mode == "allow"
				}
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(4 * time.Second):
				t.Fatal("child exit/disconnect left a live approval continuation")
			}
			if opened != 1 || closed != 1 || live.Err() == nil {
				t.Fatal("local approval owner survived its child", opened, closed)
			}
			_, err := os.Stat(filepath.Join(workspace, "permission-test.txt"))
			if (mode == "allow") != (err == nil) {
				t.Fatal("local approval did not control the side effect", err)
			}
		})
	}
}

func TestLocalApprovalRejectsInheritedAuthorityBeforeChildStart(t *testing.T) {
	for _, mutation := range []string{"central pin", "device pin", "central consent", "device consent", "private", "full sandbox"} {
		t.Run(mutation, func(t *testing.T) {
			adapter := CodexAdapter{Config: config.AgentConfig{Sandbox: "workspace-write"}, LocalApproval: func(context.Context) (LocalApprovalSession, error) {
				t.Fatal("invalid authority started a local approval owner")
				return LocalApprovalSession{}, nil
			}}
			run := contracts.RunRequestedPayload{}
			switch mutation {
			case "central pin":
				run.CentralApproval = &contracts.PayloadCentralApproval{Revision: 1}
			case "device pin":
				run.DeviceTrust = &contracts.PayloadDeviceTrust{Mode: "full", Revision: 1}
			case "central consent":
				adapter.Config.CentralApprovalRevision = 1
			case "device consent":
				adapter.Config.TrustedExecutionRevision = 1
			case "private":
				adapter.Config.OwnerPrivateOutput = true
			case "full sandbox":
				adapter.Config.Sandbox = "danger-full-access"
			}
			var last Event
			if err := adapter.Execute(context.Background(), Request{Run: run}, func(_ context.Context, event Event) error { last = event; return nil }); err != nil || last.Error == nil || last.Error.Code != "LOCAL_APPROVAL_CHANGED" {
				t.Fatal("Peer authority was interpreted as Device execution", err)
			}
		})
	}
}
