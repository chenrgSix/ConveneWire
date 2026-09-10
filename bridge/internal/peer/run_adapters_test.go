package peer

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
)

func TestPeerRunNativeAdaptersUseHostAdmissionAndLocalApproval(t *testing.T) {
	for _, mode := range []string{"pi", "codex allow", "codex Host revoke", "codex local withdrawal"} {
		t.Run(mode, func(t *testing.T) {
			kind := "codex"
			if mode == "pi" {
				kind = "pi"
			}
			f, client, connectors, partition, binding := runExecutionFixture(t, kind)
			connection, err := client.ConnectRuntime(context.Background(), connectors.store, partition.receipt.MembershipID)
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()
			received, err := client.PollRuns(context.Background(), connection, nil)
			if err != nil || received == nil {
				t.Fatal(err)
			}
			execution := &peerRunExecution{factory: connectors.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			done, finished := make(chan error, 1), make(chan struct{})
			go func() { defer close(finished); done <- execution.execute(ctx) }()
			t.Cleanup(func() {
				cancel()
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("native adapter did not drain")
				}
			})
			source, _ := connectors.sources.Resolve(binding.LocalAgentID)
			if kind == "codex" {
				var pending ApprovalView
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				for pending.RequestID == "" {
					if views := connectors.Approvals().Pending(); len(views) == 1 {
						pending = views[0]
						break
					}
					select {
					case err := <-done:
						t.Fatal("no native approval", err)
					case <-ctx.Done():
						t.Fatal("approval timed out")
					case <-ticker.C:
					}
				}
				if pending.Binding != binding {
					t.Fatal("approval lost immutable Run binding")
				}
				if _, err := os.Stat(filepath.Join(source.Configuration.Workspace, "permission-test.txt")); !os.IsNotExist(err) {
					t.Fatal("effect before approval")
				}
				foreign := approvalDecision(pending)
				foreign.BindingDigest = strings.Repeat("f", 64)
				if !errors.Is(connectors.Approvals().Decide(foreign), ErrApproval) {
					t.Fatal("foreign approval consumed local request")
				}
				if mode == "codex Host revoke" {
					f.control(t, map[string]any{"action": "revoke", "membershipId": partition.receipt.MembershipID})
				}
				if mode == "codex local withdrawal" {
					state, _ := connectors.store.Read()
					if _, err := connectors.exporter.Withdraw(state.Revision, partition.receipt.MembershipID, binding.ExportID, binding.GrantRevision,
						"op_networkwithdraw001", connectors.clock()); err != nil {
						t.Fatal(err)
					}
				}
				if err := connectors.Approvals().Decide(approvalDecision(pending)); err != nil && (mode == "codex allow" || !errors.Is(err, ErrApproval)) {
					t.Fatal(err)
				}
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatal("native Peer adapter", err)
				}
			case <-ctx.Done():
				t.Fatal("adapter completion timed out")
			}
			record, err := partition.Runs().Load(binding.RunID)
			if err != nil || record.Outcome == nil {
				t.Fatal("local outcome", err)
			}
			state, err := partition.Runs().Transport(binding.RunID)
			if err != nil || state.SettlementReceipt == nil {
				t.Fatal("native settlement", err)
			}
			if kind == "codex" {
				_, err := os.Stat(filepath.Join(source.Configuration.Workspace, "permission-test.txt"))
				if (mode == "codex allow") != (err == nil) || len(connectors.Approvals().Pending()) != 0 {
					t.Fatal("approval boundary failed", err)
				}
			}
			if mode == "pi" || mode == "codex allow" {
				if record.Outcome.State != "completed" {
					t.Fatalf("native outcome %+v", record.Outcome)
				}
				files, err := os.ReadDir(filepath.Join(partition.DataDir(), "runtime-sessions"))
				if err != nil || len(files) != 1 {
					t.Fatal("missing private native Session", err)
				}
				found := false
				for _, event := range state.Events {
					text := string(event)
					if strings.Contains(text, "runtimeScopeId") || strings.Contains(text, "thread-peer-test") {
						t.Fatal("provider identity disclosed")
					}
					if strings.Contains(text, `"session":`) {
						found = true
						if !strings.Contains(text, `"status":"working"`) {
							t.Fatal("Session evidence used a terminal carrier")
						}
					}
				}
				if !found {
					t.Fatal("native Session progress was lost")
				}
			}
			var result struct {
				State                        string
				Events, Replies, Settlements int
			}
			f.controlResult(t, map[string]any{"action": "run-state", "runId": binding.RunID}, &result)
			if result.Settlements != 1 || result.State != record.Outcome.State {
				t.Fatalf("Host did not retain native truth: %+v", result)
			}
		})
	}
}

func TestPeerRunSessionProgressRequiresFrozenCursors(t *testing.T) {
	execution := &peerRunExecution{delivery: RunDelivery{Request: json.RawMessage(`{"payload":{"session":{"contextCursor":7},"contextPlan":{"resultEvidence":{"revision":3}}}}`)}}
	working := contracts.Working
	revision := int64(3)
	event := bridgeruntime.Event{Status: &working, Session: &contracts.LogicalSessionStatus{ContextCursor: 7, Disposition: contracts.Started, ResultEvidenceRevision: &revision}}
	if _, err := execution.status(event); err != nil {
		t.Fatal(err)
	}
	event.Session.ContextCursor = 8
	if _, err := execution.status(event); !errors.Is(err, ErrProof) {
		t.Fatal("unfrozen context accepted", err)
	}
	event.Session.ContextCursor = 7
	revision = 4
	if _, err := execution.status(event); !errors.Is(err, ErrProof) {
		t.Fatal("changed evidence revision accepted", err)
	}
	execution.delivery.Request = json.RawMessage(`{"payload":{"session":{"contextCursor":7}}}`)
	if _, err := execution.status(event); !errors.Is(err, ErrProof) {
		t.Fatal("invented evidence accepted", err)
	}
	revision = 0
	value, err := execution.status(event)
	if err != nil || value["session"].(map[string]any)["resultEvidenceRevision"] != nil {
		t.Fatal("absent evidence was not omitted", err)
	}
}
