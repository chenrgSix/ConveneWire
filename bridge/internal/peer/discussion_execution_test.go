package peer

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	wire "convenewire.dev/contracts/generated/go/peer"
)

// The Host contributor is an offline adapter exposed through the real Owner
// API. Both remote turns run the actual restricted native Pi process adapter.
// This proves the Peer/Host protocol path, not physical Device UI acceptance.
func TestPeerDiscussionRunsUseNativeSessionsAndFrozenFinalization(t *testing.T) {
	f, client, c, partition, initial := runExecutionFixture(t, "pi")
	f.control(t, map[string]any{"action": "cancel-run", "runId": initial.RunID})
	var created struct{ DiscussionID, PeerRunID string }
	f.controlResult(t, map[string]any{"action": "create-discussion"}, &created)
	if created.DiscussionID == "" || created.PeerRunID == "" {
		t.Fatal("actual Discussion did not create its remote Wave slot")
	}
	type discussionView struct {
		Discussion struct{ State string }
		Waves      []struct{ WaveID, State string }
		Turns      []struct{ TurnID, RunID, Kind, State string }
	}
	readView := func() discussionView {
		var view discussionView
		f.controlResult(t, map[string]any{"action": "discussion-state", "discussionId": created.DiscussionID}, &view)
		return view
	}
	var before discussionView
	awaitRunWorker(t, "Host contributor did not settle while the Peer contribution remained pending", func() bool {
		before = readView()
		completed := 0
		for _, turn := range before.Turns {
			if turn.State == "completed" {
				completed++
			}
		}
		return len(before.Waves) == 1 && len(before.Turns) == 2 && completed == 1
	})
	// Reopen with one accepted contribution and one undelivered Peer Turn.
	// Recovery must retain the original Wave/Turn/Run identities and leave its
	// barrier open for that contribution, rather than scheduling a replacement.
	f.control(t, map[string]any{"action": "restart-host"})
	after := readView()
	if len(after.Waves) != 1 || len(after.Turns) != 2 || after.Waves[0].WaveID != before.Waves[0].WaveID || after.Waves[0].State != "open" {
		t.Fatal("Host recovery duplicated or prematurely closed the partial contribution Wave", after)
	}
	for index, turn := range after.Turns {
		if turn.TurnID != before.Turns[index].TurnID || turn.RunID != before.Turns[index].RunID || turn.State != before.Turns[index].State {
			t.Fatal("Host recovery replaced an existing contribution identity or committed outcome", before, after)
		}
	}
	ids := []string{}
	for turn := 0; turn < 2; turn++ {
		connection, err := client.ConnectRuntime(context.Background(), c.store, partition.receipt.MembershipID)
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(connection.Context(), 25*time.Second)
		func() {
			defer connection.Close()
			defer cancel()
			delivery, err := client.PollRuns(ctx, connection, nil)
			if err != nil || delivery == nil {
				t.Fatal("remote Discussion delivery missing", err)
			}
			var request struct {
				Binding wire.PeerExecutionBinding
				Payload struct {
					Instruction string
					Session     struct{ ResumePolicy string }
				}
			}
			if err := json.Unmarshal(delivery.Request, &request); err != nil || request.Payload.Session.ResumePolicy != "start_new" {
				t.Fatal("Discussion attempted to reuse an older native context", err)
			}
			if turn == 0 && request.Binding.RunID != created.PeerRunID {
				t.Fatal("worker received another Run")
			}
			if turn == 1 && (!strings.Contains(request.Payload.Instruction, "Peer Pi completed.") ||
				!strings.Contains(request.Payload.Instruction, "Host offline contributor") ||
				!strings.Contains(request.Payload.Instruction, "Produce the final")) {
				t.Fatal("native Finalizer did not receive the frozen accepted Wave")
			}
			execution := &peerRunExecution{factory: c.runtime, client: client, journal: partition.Runs(),
				membership: partition.receipt.MembershipID, delivery: *delivery}
			if err := execution.execute(ctx); err != nil {
				t.Fatal(err)
			}
			id := request.Binding.RunID
			assertRunSettledOnce(t, f, partition, id, "completed")
			state, err := partition.Runs().Transport(id)
			if err != nil {
				t.Fatal(err)
			}
			started := false
			for _, raw := range state.Events {
				var event struct{ Session *struct{ Disposition string } }
				if json.Unmarshal(raw, &event) != nil {
					t.Fatal("invalid retained event")
				}
				if event.Session != nil {
					if event.Session.Disposition != "started" {
						t.Fatal("later Discussion resumed the previous native session")
					}
					started = true
				}
			}
			if !started {
				t.Fatal("actual Pi adapter did not report a new native session")
			}
			ids = append(ids, id)
		}()
		if turn == 0 {
			// The Finalizer already exists in Host persistence, but has not been
			// fetched. Reopen the Host service/database before its first delivery.
			f.control(t, map[string]any{"action": "restart-host"})
		}
	}
	view := readView()
	if view.Discussion.State != "completed" || len(view.Waves) != 2 || len(view.Turns) != 3 || ids[0] == ids[1] {
		t.Fatal("native Discussion did not finalize exactly once", view)
	}
	source, _ := c.sources.Resolve(initial.LocalAgentID)
	marker, err := os.ReadFile(filepath.Join(source.Configuration.Workspace, "runtime-started"))
	if err != nil || strings.Count(string(marker), "started\n") != 2 {
		t.Fatal("native Discussion process was repeated", string(marker), err)
	}
}
