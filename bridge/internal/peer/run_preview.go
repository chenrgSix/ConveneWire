package peer

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	bridgeruntime "convenewire.dev/bridge/internal/runtime"
)

const peerPreviewInterval = 500 * time.Millisecond
const peerPreviewRunes = 20_000
const peerPreviewBytes = 256 * 1024
const peerPreviewEvents = 512

// One native core shares preview bandwidth across all Runs targeting the same
// Host. Lifecycle, reply and settlement traffic never consumes this budget.
type peerPreviewBudget struct {
	mu   sync.Mutex
	next map[string]time.Time
}

func (b *peerPreviewBudget) allow(host string, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if now.Before(b.next[host]) {
		return false
	}
	if b.next == nil {
		b.next = map[string]time.Time{}
	}
	if _, exists := b.next[host]; !exists && len(b.next) >= 128 {
		for id, until := range b.next {
			if !now.Before(until) {
				delete(b.next, id)
			}
		}
		if len(b.next) >= 128 {
			return false
		}
	}
	b.next[host] = now.Add(peerPreviewInterval)
	return true
}

func (b *peerPreviewBudget) cooldown(host string, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	// Slow durable I/O must not turn every buffered producer fragment into
	// another publish. Leave a coalescing interval after the publish completes.
	if next := now.Add(peerPreviewInterval); next.After(b.next[host]) {
		b.next[host] = next
	}
}

// The Runtime's complete reply is authoritative. Previews can be coalesced
// before journal sequence allocation; already journaled events are immutable.
// Coalesced deltas retain skipped text; resets replace a changed visible tail.
func (e *peerRunExecution) previewEvent(event bridgeruntime.Event, now time.Time) map[string]any {
	if event.Reply != "" {
		e.preview, e.previewPublished = "", ""
		return nil
	}
	if e.previewBytes >= peerPreviewBytes || e.previewEvents >= peerPreviewEvents {
		return nil
	}
	output := event.Output != nil && (event.Output.Content != "" || event.Output.Reset)
	if output {
		if event.Output.Reset {
			e.preview = ""
		}
		e.preview += event.Output.Content
		if runes := []rune(e.preview); len(runes) > peerPreviewRunes {
			e.preview = string(runes[len(runes)-peerPreviewRunes:])
		}
	}
	if (!output && event.Activity == nil) || !e.factory.previews.allow(e.delivery.Settlement.Binding.AuthorityNodeID, now) {
		return nil
	}
	if output {
		visible := bridgeruntime.RedactSensitiveText(e.preview)
		content, reset := visible, true
		if strings.HasPrefix(visible, e.previewPublished) {
			content, reset = strings.TrimPrefix(visible, e.previewPublished), false
		}
		value := e.boundPreview(map[string]any{"type": "output", "content": content, "reset": reset})
		if value != nil {
			e.previewPublished = visible
		}
		return value
	}
	a := event.Activity
	value := map[string]any{"type": "activity", "activityId": a.ID, "kind": a.Kind, "phase": a.Phase, "reset": a.Reset}
	if a.Label != "" {
		value["label"] = bridgeruntime.RedactSensitiveText(a.Label)
	}
	if a.Content != "" {
		value["content"] = bridgeruntime.RedactSensitiveText(a.Content)
	}
	return e.boundPreview(value)
}

func (e *peerRunExecution) boundPreview(value map[string]any) map[string]any {
	raw, err := json.Marshal(value)
	// Leave headroom for the subsequently allocated sequence and encoding.
	size := len(raw) + 64
	if err != nil || e.previewBytes+size > peerPreviewBytes {
		e.previewBytes = peerPreviewBytes
		return nil
	}
	e.previewBytes += size
	e.previewEvents++
	return value
}
