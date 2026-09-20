package desktopcodex

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

type wirePeer struct {
	net.Conn
	read  *json.Decoder
	write *json.Encoder
}

func peer(conn net.Conn) *wirePeer {
	return &wirePeer{Conn: conn, read: json.NewDecoder(conn), write: json.NewEncoder(conn)}
}
func (p *wirePeer) send(t *testing.T, value any) {
	t.Helper()
	if err := p.write.Encode(value); err != nil {
		t.Fatal(err)
	}
}
func (p *wirePeer) receive(t *testing.T) envelope {
	t.Helper()
	_ = p.SetReadDeadline(time.Now().Add(3 * time.Second))
	defer p.SetReadDeadline(time.Time{})
	var message envelope
	if err := p.read.Decode(&message); err != nil {
		t.Fatal(err)
	}
	return message
}
func requestMessage(id any, method string, params any) map[string]any {
	return map[string]any{"id": id, "method": method, "params": params}
}
func resultMessage(id json.RawMessage, result any) map[string]any {
	return map[string]any{"id": id, "result": result}
}

func mediatorFixture(t *testing.T) (*Mediator, *wirePeer, *wirePeer, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	desktop, source := net.Pipe()
	provider, native := net.Pipe()
	m := NewMediator()
	finished := make(chan error, 1)
	go func() {
		finished <- m.Serve(ctx, Streams{DesktopInput: source, DesktopOutput: source, ProviderInput: native, ProviderOutput: native})
	}()
	t.Cleanup(func() {
		cancel()
		_ = desktop.Close()
		_ = provider.Close()
		select {
		case <-finished:
		case <-time.After(3 * time.Second):
			t.Error("mediator did not drain owned streams")
		}
	})
	d, p := peer(desktop), peer(provider)
	d.send(t, requestMessage(1, "initialize", map[string]any{}))
	init := p.receive(t)
	p.send(t, resultMessage(init["id"], map[string]any{}))
	d.receive(t)
	d.send(t, map[string]any{"method": "initialized"})
	p.receive(t)
	return m, d, p, ctx
}

func loadThread(t *testing.T, desktop, provider *wirePeer, id string) {
	t.Helper()
	desktop.send(t, requestMessage("load-"+id, "thread/resume", map[string]string{"threadId": id}))
	load := provider.receive(t)
	provider.send(t, resultMessage(load["id"], map[string]any{"thread": map[string]any{"id": id, "status": map[string]string{"type": "idle"}}}))
	desktop.receive(t)
}

func event(t *testing.T, desktop, provider *wirePeer, method, thread, turn string, item any) {
	t.Helper()
	params := map[string]any{"threadId": thread, "turnId": turn}
	if strings.HasPrefix(method, "turn/") {
		params["turn"] = map[string]string{"id": turn, "status": "completed"}
	}
	if item != nil {
		params["item"] = item
	}
	provider.send(t, map[string]any{"method": method, "params": params})
	desktop.receive(t)
}

func TestMediatorRoutesIDsCallbacksAndFencesOnlySelectedThread(t *testing.T) {
	m, d, p, ctx := mediatorFixture(t)
	loadThread(t, d, p, "selected")
	loadThread(t, d, p, "unrelated")
	fence, err := m.Hold(ctx, "selected")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Hold(ctx, "selected"); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if _, err := m.State(ctx, Fence{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("forged fence accepted")
	}
	for _, method := range []string{"turn/start", "turn/steer", "turn/interrupt", "thread/resume", "thread/fork", "thread/queue/add", "thread/archive", "thread/newUnknownMutation", "config/value/write"} {
		d.send(t, requestMessage(4, method, map[string]string{"threadId": "selected"}))
		rejected := d.receive(t)
		if string(rejected["id"]) != "4" || rejected["error"] == nil {
			t.Fatalf("write not fenced: %s", method)
		}
	}
	d.send(t, requestMessage(4, "thread/read", map[string]any{"threadId": "selected", "includeTurns": false}))
	desktopRead := p.receive(t)
	if string(desktopRead["id"]) == "4" {
		t.Fatal("source IDs must be isolated")
	}
	metadata := make(chan error, 1)
	go func() { _, err := m.ReadMetadata(ctx, fence); metadata <- err }()
	localRead := p.receive(t)
	if string(localRead["id"]) == string(desktopRead["id"]) {
		t.Fatal("coordinator/source collision")
	}
	p.send(t, resultMessage(localRead["id"], map[string]any{"thread": map[string]any{"id": "selected", "turns": []any{}}}))
	if err := <-metadata; err != nil {
		t.Fatal(err)
	}
	p.send(t, resultMessage(desktopRead["id"], map[string]any{}))
	if string(d.receive(t)["id"]) != "4" {
		t.Fatal("source ID was not restored")
	}
	// Server callback IDs may equal a rewritten client request ID: the response
	// direction must keep the namespaces separate.
	p.send(t, requestMessage(json.RawMessage(desktopRead["id"]), "item/tool/call", map[string]string{"threadId": "selected", "tool": "fixture"}))
	callback := d.receive(t)
	d.send(t, resultMessage(callback["id"], map[string]any{"success": true}))
	if string(p.receive(t)["id"]) != string(callback["id"]) {
		t.Fatal("tool handler reply was diverted")
	}
	d.send(t, requestMessage(8, "turn/start", map[string]string{"threadId": "unrelated"}))
	unrelated := p.receive(t)
	p.send(t, resultMessage(unrelated["id"], map[string]any{"turn": map[string]string{"id": "elsewhere"}}))
	d.receive(t)
	if err := m.Release(ctx, fence); err != nil {
		t.Fatal(err)
	}
	d.send(t, requestMessage(4, "turn/start", map[string]string{"threadId": "selected"}))
	restored := p.receive(t)
	if stringField(restored, "method") != "turn/start" {
		t.Fatal("source control not returned")
	}
}

func TestMediatorExactTurnOutputAndNoDuplicateExecution(t *testing.T) {
	m, d, p, ctx := mediatorFixture(t)
	loadThread(t, d, p, "selected")
	fence, err := m.Hold(ctx, "selected")
	if err != nil {
		t.Fatal(err)
	}
	input := Continuation{OperationID: "operation-1", Text: "Continue original context"}
	completed := make(chan controlReply, 1)
	go func() {
		result, err := m.Execute(ctx, fence, input)
		completed <- controlReply{result: result, err: err}
	}()
	start := p.receive(t)
	if stringField(objectField(start, "params"), "threadId") != "selected" {
		t.Fatal("wrong native Thread")
	}
	if err := m.Release(ctx, fence); !errors.Is(err, ErrBusy) {
		t.Fatal("released pending submission")
	}
	// Deliver events before the acknowledgment to exercise native ordering.
	event(t, d, p, "turn/started", "selected", "our-turn", nil)
	event(t, d, p, "item/completed", "selected", "old-private-turn", map[string]string{"type": "agentMessage", "id": "old", "text": "PRIVATE"})
	event(t, d, p, "item/completed", "selected", "our-turn", map[string]string{"type": "agentMessage", "id": "commentary", "text": "Local progress only", "phase": "commentary"})
	event(t, d, p, "item/completed", "selected", "our-turn", map[string]string{"type": "agentMessage", "id": "reply", "text": "Reviewed continuation"})
	event(t, d, p, "item/completed", "selected", "our-turn", map[string]string{"type": "agentMessage", "id": "reply", "text": "Reviewed continuation"})
	event(t, d, p, "turn/completed", "selected", "our-turn", nil)
	p.send(t, resultMessage(start["id"], map[string]any{"turn": map[string]string{"id": "our-turn"}}))
	result := <-completed
	if result.err != nil || result.result != (ContinuationResult{TurnID: "our-turn", Text: "Reviewed continuation"}) {
		t.Fatalf("incorrect result: %+v", result)
	}
	duplicate, err := m.Execute(ctx, fence, input)
	if err != nil || duplicate != result.result {
		t.Fatalf("duplicate not reconciled locally: %v", err)
	}
	if _, err := m.Execute(ctx, fence, Continuation{OperationID: input.OperationID, Text: "changed"}); !errors.Is(err, ErrInterference) {
		t.Fatal("changed duplicate accepted")
	}
	if err := m.Release(ctx, fence); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Execute(ctx, fence, input); !errors.Is(err, ErrUnavailable) {
		t.Fatal("released handle reused")
	}
}

func TestMediatorBusyInterferenceAndUnknownStayFenced(t *testing.T) {
	for _, scenario := range []string{"busy", "external", "missing-ack-id", "deadline"} {
		t.Run(scenario, func(t *testing.T) {
			m, d, p, ctx := mediatorFixture(t)
			loadThread(t, d, p, "selected")
			if scenario == "busy" {
				event(t, d, p, "turn/started", "selected", "source-turn", nil)
				if _, err := m.Hold(ctx, "selected"); !errors.Is(err, ErrBusy) {
					t.Fatal("active source turn acquired")
				}
				return
			}
			fence, err := m.Hold(ctx, "selected")
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "external" {
				event(t, d, p, "turn/started", "selected", "external", nil)
				if _, err := m.Execute(ctx, fence, Continuation{OperationID: "1", Text: "no"}); !errors.Is(err, ErrInterference) {
					t.Fatal("external turn not detected")
				}
				if err := m.Release(ctx, fence); !errors.Is(err, ErrBusy) {
					t.Fatal("released while external turn active")
				}
				event(t, d, p, "turn/completed", "selected", "external", nil)
				state, err := m.State(ctx, fence)
				if err != nil || !state.Paused {
					t.Fatal("unexpected turn must leave fence paused")
				}
				if err := m.Release(ctx, fence); err != nil {
					t.Fatal(err)
				}
				return
			}
			callContext, cancel := context.WithCancel(ctx)
			defer cancel()
			result := make(chan error, 1)
			go func() {
				_, err := m.Execute(callContext, fence, Continuation{OperationID: "1", Text: "bounded"})
				result <- err
			}()
			request := p.receive(t)
			if scenario == "deadline" {
				cancel()
			} else {
				p.send(t, resultMessage(request["id"], map[string]any{"turn": map[string]any{}}))
			}
			if err := <-result; !errors.Is(err, ErrUnknown) {
				t.Fatal("ambiguous submission was not unknown")
			}
			if err := m.Release(ctx, fence); !errors.Is(err, ErrBusy) && !errors.Is(err, ErrUnknown) {
				t.Fatal("uncertain submission released")
			}
			if _, err := m.Execute(ctx, fence, Continuation{OperationID: "1", Text: "bounded"}); !errors.Is(err, ErrUnknown) {
				t.Fatal("uncertain submission replayed")
			}
		})
	}
}

func TestMediatorRejectsBadFramesAndDrainsBlockedIO(t *testing.T) {
	for _, data := range []string{`{"id":null,"result":{}}`, `{"id":1,"method":"x","result":{}}`, `[]`, "{\"method\":\"\xff\"}", strings.Repeat("x", maxFrame+1)} {
		if _, err := parseEnvelope([]byte(data)); !errors.Is(err, ErrProtocol) {
			t.Fatal("invalid frame accepted")
		}
	}
	m, d, p, ctx := mediatorFixture(t)
	loadThread(t, d, p, "selected")
	// Unmatched callback responses must not reach the provider.
	d.send(t, map[string]any{"id": "unrequested-callback", "result": map[string]any{}})
	select {
	case <-m.done:
	case <-ctx.Done():
		t.Fatal("invalid callback did not close transport")
	}
}

func TestMediatorBoundsOutstandingRequestsAndRejectsPendingAcquisition(t *testing.T) {
	m, d, p, ctx := mediatorFixture(t)
	loadThread(t, d, p, "selected")
	for index := 0; index < maxPending; index++ {
		d.send(t, requestMessage(index, "thread/read", map[string]string{"threadId": "selected"}))
		p.receive(t)
	}
	if _, err := m.Hold(ctx, "selected"); !errors.Is(err, ErrBusy) {
		t.Fatal("acquired with unresolved source requests")
	}
	d.send(t, requestMessage(maxPending, "thread/read", map[string]string{"threadId": "selected"}))
	select {
	case <-m.done:
	case <-ctx.Done():
		t.Fatal("unbounded outstanding requests")
	}
}

func TestMediatorBackpressuresBriefDesktopStallsWithoutDroppingEvents(t *testing.T) {
	m, desktop, provider, ctx := mediatorFixture(t)
	emitted := make(chan error, 1)
	go func() {
		for index := 0; index < 64; index++ {
			if err := provider.write.Encode(map[string]any{"method": "fixture/progress", "params": map[string]int{"index": index}}); err != nil {
				emitted <- err
				return
			}
		}
		emitted <- nil
	}()
	// net.Pipe leaves the desktop writer blocked until this client resumes.
	time.Sleep(50 * time.Millisecond)
	select {
	case <-m.done:
		t.Fatal("brief UI stall closed the provider connection")
	default:
	}
	for index := 0; index < 64; index++ {
		message := desktop.receive(t)
		var actual int
		if err := json.Unmarshal(objectField(message, "params")["index"], &actual); err != nil || actual != index {
			t.Fatal("native event lost or reordered")
		}
	}
	select {
	case err := <-emitted:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("backpressure did not clear")
	}
}

func TestMediatorPinsWorkspaceAndInterruptsOnlyOwnedTurn(t *testing.T) {
	m, d, p, ctx := mediatorFixture(t)
	workspace := t.TempDir()
	d.send(t, requestMessage("load", "thread/resume", map[string]string{"threadId": "selected"}))
	load := p.receive(t)
	p.send(t, resultMessage(load["id"], map[string]any{"cwd": workspace, "thread": map[string]any{"id": "selected", "status": map[string]string{"type": "idle"}}}))
	d.receive(t)
	fence, err := m.Hold(ctx, "selected")
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []Continuation{
		{OperationID: "unsafe", Text: "no", Sandbox: "danger-full-access", Workspace: workspace},
		{OperationID: "foreign", Text: "no", Sandbox: "workspace-write", Workspace: workspace + "/other"},
	} {
		if _, err := m.Execute(ctx, fence, input); err == nil {
			t.Fatal("unreviewed execution scope accepted")
		}
	}
	completed := make(chan error, 1)
	go func() {
		_, err := m.Execute(ctx, fence, Continuation{OperationID: "owned", Text: "work", Sandbox: "workspace-write", Workspace: workspace})
		completed <- err
	}()
	start := p.receive(t)
	params := objectField(start, "params")
	var policy struct {
		Type                                 string
		WritableRoots                        []string
		NetworkAccess                        bool
		ExcludeTmpdirEnvVar, ExcludeSlashTmp bool
	}
	if json.Unmarshal(params["sandboxPolicy"], &policy) != nil || policy.Type != "workspaceWrite" || len(policy.WritableRoots) != 1 || policy.WritableRoots[0] != workspace || policy.NetworkAccess || !policy.ExcludeTmpdirEnvVar || !policy.ExcludeSlashTmp || stringField(params, "approvalPolicy") != "never" {
		t.Fatalf("unbounded execution policy: %s", params["sandboxPolicy"])
	}
	if err := m.Interrupt(ctx, fence); !errors.Is(err, ErrUnknown) {
		t.Fatal("interrupted without exact native turn identity")
	}
	p.send(t, resultMessage(start["id"], map[string]any{"turn": map[string]string{"id": "owned-turn"}}))
	event(t, d, p, "turn/started", "selected", "owned-turn", nil)
	interrupted := make(chan error, 1)
	go func() { interrupted <- m.Interrupt(ctx, fence) }()
	stop := p.receive(t)
	if stringField(stop, "method") != "turn/interrupt" || stringField(objectField(stop, "params"), "turnId") != "owned-turn" || stringField(objectField(stop, "params"), "threadId") != "selected" {
		t.Fatal("wrong turn interrupted")
	}
	p.send(t, resultMessage(stop["id"], map[string]any{}))
	if err := <-interrupted; err != nil {
		t.Fatal(err)
	}
	event(t, d, p, "turn/completed", "selected", "owned-turn", nil)
	<-completed
	if err := m.Release(ctx, fence); err != nil {
		t.Fatal(err)
	}
}
