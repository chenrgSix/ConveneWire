package peer

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func TestPeerRunPreviewCoalescesSnapshotsAcrossRunsWithoutSharingContent(t *testing.T) {
	factory := &runtimeFactory{}
	newRun := func(host string) *peerRunExecution {
		return &peerRunExecution{factory: factory, delivery: RunDelivery{Settlement: RunSettlementCapability{
			Binding: wire.PeerExecutionBinding{AuthorityNodeID: host}}}}
	}
	first, sameHost, otherHost := newRun("node_firsthost001"), newRun("node_firsthost001"), newRun("node_otherhost001")
	at := time.Now()
	preview := first.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: "first"}}, at)
	if preview["content"] != "first" || preview["reset"] != false {
		t.Fatal("first preview was lost", preview)
	}
	for i := 0; i < 100; i++ {
		if first.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: " +"}}, at) != nil {
			t.Fatal("one Run exhausted the Host preview budget")
		}
	}
	if sameHost.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: "isolated"}}, at) != nil {
		t.Fatal("another Run bypassed the shared Host budget")
	}
	if otherHost.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: "other"}}, at) == nil {
		t.Fatal("one Host blocked another Host's previews")
	}
	preview = first.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: " end"}}, at.Add(peerPreviewInterval))
	if preview["content"] != strings.Repeat(" +", 100)+" end" || preview["reset"] != false {
		t.Fatal("coalesced snapshot omitted skipped text", preview)
	}
	preview = sameHost.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: " tail"}}, at.Add(2*peerPreviewInterval))
	if preview["content"] != "isolated tail" {
		t.Fatal("another Run's private preview entered this snapshot", preview)
	}
	preview = first.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: strings.Repeat("中", peerPreviewRunes+100), Reset: true}}, at.Add(3*peerPreviewInterval))
	if content := preview["content"].(string); utf8.RuneCountInString(content) != peerPreviewRunes || !utf8.ValidString(content) {
		t.Fatal("preview did not retain a bounded Unicode tail")
	}
	preview = first.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: "token=highly-sensitive-value", Reset: true}}, at.Add(4*peerPreviewInterval))
	if strings.Contains(preview["content"].(string), "highly-sensitive-value") {
		t.Fatal("preview escaped redaction")
	}
	if first.previewEvent(bridgeruntime.Event{Reply: "final", Output: &bridgeruntime.OutputDelta{Content: "obsolete"}}, at.Add(5*peerPreviewInterval)) != nil || first.preview != "" {
		t.Fatal("preview replaced the complete reply")
	}
}

func TestPeerRunPreviewCapacityDoesNotConsumeAuthoritativeEventSpace(t *testing.T) {
	e := &peerRunExecution{factory: &runtimeFactory{}, delivery: RunDelivery{Settlement: RunSettlementCapability{
		Binding: wire.PeerExecutionBinding{AuthorityNodeID: "node_capacityhost001"}}}}
	at := time.Now()
	for i := 0; i < 20; i++ {
		// Reset to a different large visible snapshot so delta compression cannot
		// disguise checkpoint usage. Excess optional previews stop before append.
		content := strings.Repeat([]string{"中", "文"}[i%2], peerPreviewRunes)
		e.previewEvent(bridgeruntime.Event{Output: &bridgeruntime.OutputDelta{Content: content, Reset: true}}, at.Add(time.Duration(i)*peerPreviewInterval))
	}
	if e.previewBytes != peerPreviewBytes || e.previewEvents > 4 {
		t.Fatal("oversized previews could exhaust the durable Run outbox", e.previewBytes, e.previewEvents)
	}
	if e.previewEvent(bridgeruntime.Event{Reply: "complete reply"}, at.Add(time.Hour)) != nil || e.preview != "" {
		t.Fatal("preview saturation interfered with reply cleanup")
	}
}

func TestPeerRunPreviewBudgetSerializesConcurrentProducers(t *testing.T) {
	var budget peerPreviewBudget
	var granted atomic.Int32
	var workers sync.WaitGroup
	at := time.Now()
	for i := 0; i < 64; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			if budget.allow("node_sharedhost001", at) {
				granted.Add(1)
			}
		}()
	}
	workers.Wait()
	if granted.Load() != 1 || !budget.allow("node_sharedhost001", at.Add(peerPreviewInterval)) {
		t.Fatal("concurrent producers bypassed preview pacing", granted.Load())
	}
	budget.cooldown("node_sharedhost001", at.Add(time.Second))
	if budget.allow("node_sharedhost001", at.Add(time.Second)) || !budget.allow("node_sharedhost001", at.Add(time.Second+peerPreviewInterval)) {
		t.Fatal("slow publication removed the coalescing interval")
	}
}

func TestPeerRunPreviewBurstKeepsTheActualNativeReplyAndSettlement(t *testing.T) {
	f, client, c, partition, binding := runExecutionFixture(t, "generic-burst")
	connection, err := client.ConnectRuntime(context.Background(), c.store, partition.receipt.MembershipID)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	received, err := client.PollRuns(context.Background(), connection, nil)
	if err != nil || received == nil {
		t.Fatal(err)
	}
	execution := &peerRunExecution{factory: c.runtime, client: client, journal: partition.Runs(), membership: partition.receipt.MembershipID, delivery: *received}
	ctx, cancel := context.WithTimeout(connection.Context(), 20*time.Second)
	defer cancel()
	if err := execution.execute(ctx); err != nil {
		record, _ := partition.Runs().Load(binding.RunID)
		state, _ := partition.Runs().Transport(binding.RunID)
		if record.Outcome != nil {
			t.Log("local outcome", record.Outcome.State, "events", len(state.Events), "ack", state.Acknowledged(), "context", ctx.Err())
		}
		t.Fatal("native burst exhausted transport or lost completion", err)
	}
	assertRunSettledOnce(t, f, partition, binding.RunID, "completed")
	state, err := partition.Runs().Transport(binding.RunID)
	if err != nil || len(state.Events) >= 50 {
		t.Fatal("burst was not coalesced before journaling", len(state.Events), err)
	}
	previews, replies, completed := 0, 0, 0
	for index, raw := range state.Events {
		var event struct {
			Type, Content, Status string
			Sequence              int
		}
		if json.Unmarshal(raw, &event) != nil || event.Sequence != index+1 {
			t.Fatal("coalescing created an event sequence gap")
		}
		if event.Type == "output" || event.Type == "activity" {
			previews++
		}
		if event.Type == "reply" && event.Content == "peer-completed" {
			replies++
		}
		if event.Type == "status" && event.Status == "completed" {
			completed++
		}
	}
	if previews == 0 || replies != 1 || completed != 1 {
		t.Fatal("pacing discarded authoritative content or all progress", previews, replies, completed)
	}
}
