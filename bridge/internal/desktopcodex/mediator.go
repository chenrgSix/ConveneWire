package desktopcodex

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

const (
	maxFrame      = 4 << 20
	maxPending    = 128
	maxThreads    = 1024
	maxFences     = 16
	maxOperations = 64
	maxItems      = 128
	maxReply      = 20_000
)

var (
	ErrClosed       = errors.New("desktop connection closed")
	ErrBusy         = errors.New("desktop conversation is busy")
	ErrUnavailable  = errors.New("desktop conversation is not available for control")
	ErrInterference = errors.New("desktop conversation changed outside this control operation")
	ErrUnknown      = errors.New("desktop submission outcome is unknown; do not resubmit")
	ErrProtocol     = errors.New("invalid or oversized desktop protocol message")
	ErrCapacity     = errors.New("desktop mediator capacity exceeded")
	ErrTurnFailed   = errors.New("desktop continuation did not complete successfully")
)

// Mediator is a single native-connection transport, not an adoption authority.
// Its in-process methods must be used behind the owner's review coordinator.
// It does not listen on a socket, read personal storage, or recreate Threads.
type Mediator struct {
	commands chan controlCommand
	done     chan struct{}
	started  atomic.Bool
}

// Fence is an unforgeable in-process handle. A Thread ID alone grants no access.
type Fence struct {
	owner  *Mediator
	number uint64
}

type Continuation struct{ OperationID, Text, Sandbox, Workspace string }
type ContinuationResult struct{ TurnID, Text string }
type FenceState struct {
	Paused, Running, Uncertain bool
	OperationID                string
}

// Streams are owned by Serve: all four are closed on termination so blocked
// readers/writers cannot survive the desktop/provider connection.
type Streams struct {
	DesktopInput   io.ReadCloser
	DesktopOutput  io.WriteCloser
	ProviderInput  io.ReadCloser
	ProviderOutput io.WriteCloser
}

type controlCommand struct {
	kind         string
	thread       string
	fence        Fence
	continuation Continuation
	reply        chan controlReply
}
type controlReply struct {
	fence    Fence
	state    FenceState
	result   ContinuationResult
	metadata json.RawMessage
	views    []ThreadView
	view     ThreadView
	err      error
	settled  bool
}

func NewMediator() *Mediator {
	return &Mediator{commands: make(chan controlCommand), done: make(chan struct{})}
}

func (m *Mediator) command(ctx context.Context, command controlCommand) (controlReply, error) {
	command.reply = make(chan controlReply, 1)
	select {
	case <-ctx.Done():
		return controlReply{}, ctx.Err()
	case <-m.done:
		return controlReply{}, ErrClosed
	case m.commands <- command:
	}
	// Acquiring a fence is an immediate local operation. Once dispatched, return
	// its handle even if the caller's deadline expires, avoiding an orphan fence.
	if command.kind == "hold" {
		select {
		case reply := <-command.reply:
			return reply, reply.err
		case <-m.done:
			return controlReply{}, ErrClosed
		}
	}
	select {
	case reply := <-command.reply:
		return reply, reply.err
	case <-ctx.Done():
		if command.kind == "execute" {
			return controlReply{}, ErrUnknown
		}
		return controlReply{}, ctx.Err()
	case <-m.done:
		if command.kind == "execute" {
			return controlReply{}, ErrUnknown
		}
		return controlReply{}, ErrClosed
	}
}

// Hold provisionally fences desktop writes. It does not certify permissions,
// queues, checkpoints, tools, destination membership, or owner disclosure.
func (m *Mediator) Hold(ctx context.Context, threadID string) (Fence, error) {
	reply, err := m.command(ctx, controlCommand{kind: "hold", thread: threadID})
	return reply.fence, err
}

// ReadMetadata returns only thread/read(includeTurns=false) to local review.
func (m *Mediator) ReadMetadata(ctx context.Context, fence Fence) (json.RawMessage, error) {
	reply, err := m.command(ctx, controlCommand{kind: "read", fence: fence})
	return reply.metadata, err
}

// Execute is deliberately limited to text, read-only sandbox and no automatic
// approval. An authorized caller must still review desktop tool permissions.
// Repeated operation IDs are never sent to the provider a second time in this
// connection; durable recovery across connections belongs to the coordinator.
func (m *Mediator) Execute(ctx context.Context, fence Fence, continuation Continuation) (ContinuationResult, error) {
	reply, err := m.command(ctx, controlCommand{kind: "execute", fence: fence, continuation: continuation})
	return reply.result, err
}

func (m *Mediator) State(ctx context.Context, fence Fence) (FenceState, error) {
	reply, err := m.command(ctx, controlCommand{kind: "state", fence: fence})
	return reply.state, err
}

func (m *Mediator) Release(ctx context.Context, fence Fence) error {
	_, err := m.command(ctx, controlCommand{kind: "release", fence: fence})
	return err
}

type packet struct {
	desktop bool
	data    []byte
}
type envelope map[string]json.RawMessage

func parseEnvelope(data []byte) (envelope, error) {
	var message envelope
	if len(data) > maxFrame || !utf8.Valid(data) || json.Unmarshal(data, &message) != nil || message == nil {
		return nil, ErrProtocol
	}
	if id, ok := message["id"]; ok {
		if len(id) > 256 {
			return nil, ErrProtocol
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(id))
		decoder.UseNumber()
		if decoder.Decode(&value) != nil {
			return nil, ErrProtocol
		}
		switch value.(type) {
		case string, json.Number:
		default:
			return nil, ErrProtocol
		}
	}
	var method string
	if raw, ok := message["method"]; ok {
		if json.Unmarshal(raw, &method) != nil || method == "" || len(method) > 256 || message["result"] != nil || message["error"] != nil {
			return nil, ErrProtocol
		}
	} else if message["id"] == nil || (message["result"] == nil) == (message["error"] == nil) {
		return nil, ErrProtocol
	}
	return message, nil
}

func stringField(object envelope, key string) string {
	var value string
	_ = json.Unmarshal(object[key], &value)
	return value
}
func objectField(object envelope, key string) envelope {
	var value envelope
	_ = json.Unmarshal(object[key], &value)
	return value
}
func idKey(id json.RawMessage) string {
	var value string
	if json.Unmarshal(id, &value) == nil {
		return "s:" + value
	}
	return "n:" + string(id)
}
func raw(value any) json.RawMessage { data, _ := json.Marshal(value); return data }

type pendingRequest struct {
	originalID     json.RawMessage
	method, thread string
	params         envelope
	reply          chan controlReply
	fence          *heldThread
	run            *operation
}
type observedThread struct {
	loaded    bool
	active    string
	completed string
	view      ThreadView
}
type operation struct {
	input                 Continuation
	reply                 chan controlReply
	turn                  string
	acknowledged, settled bool
	result                ContinuationResult
	err                   error
	early                 []envelope
	earlyBytes            int
	items                 map[string]string
}
type heldThread struct {
	thread     string
	number     uint64
	paused     bool
	uncertain  bool
	running    *operation
	operations map[string]*operation
}
type mediatorLoop struct {
	ctx                context.Context
	owner              *Mediator
	sequence           uint64
	ready, initialized bool
	pending            map[string]pendingRequest
	sourceIDs          map[string]bool
	callbacks          map[string]bool
	threads            map[string]*observedThread
	held               map[string]*heldThread
	desktop, provider  chan []byte
}

// Serve serializes both directions and control operations. Sustained
// backpressure or an invalid frame closes rather than dropping/replaying data.
func (m *Mediator) Serve(ctx context.Context, streams Streams) error {
	if !m.started.CompareAndSwap(false, true) {
		return ErrUnavailable
	}
	defer close(m.done)
	if streams.DesktopInput == nil || streams.DesktopOutput == nil || streams.ProviderInput == nil || streams.ProviderOutput == nil {
		return ErrUnavailable
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	packets := make(chan packet, 2)
	failures := make(chan error, 4)
	desktop, provider := make(chan []byte, 4), make(chan []byte, 4)
	var workers sync.WaitGroup
	defer func() {
		cancel()
		for _, closer := range []io.Closer{streams.DesktopInput, streams.DesktopOutput, streams.ProviderInput, streams.ProviderOutput} {
			_ = closer.Close()
		}
		workers.Wait()
	}()
	report := func(err error) {
		select {
		case failures <- err:
		case <-ctx.Done():
		}
	}
	read := func(reader io.Reader, source bool) {
		defer workers.Done()
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64*1024), maxFrame+1)
		for scanner.Scan() {
			if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
				continue
			}
			data := bytes.Clone(scanner.Bytes())
			select {
			case packets <- packet{desktop: source, data: data}:
			case <-ctx.Done():
				return
			}
		}
		if scanner.Err() != nil {
			report(ErrProtocol)
		} else {
			report(ErrClosed)
		}
	}
	write := func(writer io.Writer, queue <-chan []byte) {
		defer workers.Done()
		for {
			select {
			case <-ctx.Done():
				return
			case data := <-queue:
				if _, err := io.Copy(writer, bytes.NewReader(append(data, '\n'))); err != nil {
					report(ErrClosed)
					return
				}
			}
		}
	}
	workers.Add(4)
	go read(streams.DesktopInput, true)
	go read(streams.ProviderInput, false)
	go write(streams.DesktopOutput, desktop)
	go write(streams.ProviderOutput, provider)
	loop := mediatorLoop{ctx: ctx, owner: m, pending: map[string]pendingRequest{}, sourceIDs: map[string]bool{}, callbacks: map[string]bool{},
		threads: map[string]*observedThread{}, held: map[string]*heldThread{}, desktop: desktop, provider: provider}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-failures:
			return err
		case packet := <-packets:
			message, err := parseEnvelope(packet.data)
			if err != nil {
				return err
			}
			if packet.desktop {
				err = loop.fromDesktop(message)
			} else {
				err = loop.fromProvider(message)
			}
			if err != nil {
				return err
			}
		case command := <-m.commands:
			if err := loop.control(command); err != nil {
				return err
			}
		}
	}
}

func (l *mediatorLoop) send(queue chan []byte, message envelope) error {
	data, err := json.Marshal(message)
	if err != nil || len(data) > maxFrame {
		return ErrProtocol
	}
	select {
	case queue <- data:
		return nil
	default:
	}
	// Propagate brief downstream stalls to the native pipe. A burst of token
	// events must not tear down a healthy desktop just because its UI is slower.
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	select {
	case queue <- data:
		return nil
	case <-l.ctx.Done():
		return l.ctx.Err()
	case <-deadline.C:
		return ErrCapacity
	}
}

func (l *mediatorLoop) request(message envelope, request pendingRequest) error {
	if len(l.pending) >= maxPending {
		return ErrCapacity
	}
	l.sequence++
	id := "convenewire:" + strconv.FormatUint(l.sequence, 10)
	message["id"] = raw(id)
	l.pending[idKey(message["id"])] = request
	return l.send(l.provider, message)
}

// Unknown mutations fail closed while a fence exists. Thread reads continue;
// replies to original server callbacks never enter this request filter.
func (l *mediatorLoop) sourceAllowed(method, thread string) bool {
	if len(l.held) == 0 {
		return true
	}
	if (strings.HasPrefix(method, "thread/") || strings.HasPrefix(method, "turn/")) && thread != "" && l.held[thread] == nil {
		return true
	}
	switch method {
	case "thread/start", "thread/list", "thread/loaded/list", "thread/read", "thread/turns/list", "thread/items/list", "thread/queue/list",
		"thread/goal/get", "thread/attachment/list", "thread/backgroundTerminals/list", "thread/timeline/list",
		"config/read", "configRequirements/read", "account/read", "account/rateLimits/read", "model/list", "skills/list", "mcpServerStatus/list":
		return true
	default:
		return false
	}
}

func (l *mediatorLoop) fromDesktop(message envelope) error {
	method := stringField(message, "method")
	id := message["id"]
	if method == "" {
		key := idKey(id)
		if !l.callbacks[key] {
			return ErrProtocol
		}
		delete(l.callbacks, key)
		return l.send(l.provider, message)
	}
	if id == nil {
		if method == "initialized" {
			l.initialized = true
		} else if len(l.held) != 0 {
			return ErrProtocol
		}
		return l.send(l.provider, message)
	}
	key := idKey(id)
	if l.sourceIDs[key] {
		return ErrProtocol
	}
	thread := stringField(objectField(message, "params"), "threadId")
	if len(thread) > 256 {
		return ErrProtocol
	}
	if !l.sourceAllowed(method, thread) {
		return l.send(l.desktop, envelope{"id": id, "error": raw(map[string]any{"code": -32001, "message": "ConveneWire holds this conversation; return control before editing it."})})
	}
	l.sourceIDs[key] = true
	return l.request(message, pendingRequest{originalID: id, method: method, thread: thread, params: objectField(message, "params")})
}

func (l *mediatorLoop) fromProvider(message envelope) error {
	method := stringField(message, "method")
	id := message["id"]
	if method != "" {
		if id != nil {
			key := idKey(id)
			if l.callbacks[key] || len(l.callbacks) >= maxPending {
				return ErrProtocol
			}
			l.callbacks[key] = true
		} else if err := l.notification(message); err != nil {
			return err
		}
		return l.send(l.desktop, message)
	}
	key := idKey(id)
	request, exists := l.pending[key]
	if !exists {
		return ErrProtocol
	}
	delete(l.pending, key)
	if request.originalID != nil {
		delete(l.sourceIDs, idKey(request.originalID))
		if message["error"] == nil {
			if err := l.observeReply(request, objectField(message, "result")); err != nil {
				return err
			}
		}
		message["id"] = request.originalID
		return l.send(l.desktop, message)
	}
	if request.run == nil {
		if message["error"] != nil {
			request.reply <- controlReply{err: ErrUnavailable}
		} else {
			request.reply <- controlReply{metadata: message["result"]}
		}
		return nil
	}
	run, fence := request.run, request.fence
	run.acknowledged = true
	if message["error"] != nil {
		for _, event := range run.early {
			if stringField(event, "method") == "turn/started" {
				fence.paused, fence.uncertain = true, true
			}
		}
		if fence.uncertain {
			l.settle(fence, run, ErrUnknown)
		} else {
			l.settle(fence, run, ErrTurnFailed)
		}
		return nil
	}
	run.turn = stringField(objectField(objectField(message, "result"), "turn"), "id")
	if run.turn == "" || len(run.turn) > 256 {
		fence.paused, fence.uncertain = true, true
		l.settle(fence, run, ErrUnknown)
		return nil
	}
	for _, event := range run.early {
		if err := l.runEvent(fence, run, event); err != nil {
			return err
		}
	}
	run.early = nil
	return nil
}

func (l *mediatorLoop) observeReply(request pendingRequest, result envelope) error {
	if request.method == "initialize" {
		l.ready = true
	}
	switch request.method {
	case "thread/start", "thread/resume":
		thread := objectField(result, "thread")
		id := stringField(thread, "id")
		if id == "" || len(id) > 256 {
			return ErrProtocol
		}
		if l.threads[id] == nil && len(l.threads) >= maxThreads {
			return ErrCapacity
		}
		state := l.threads[id]
		if state == nil {
			state = &observedThread{}
			l.threads[id] = state
		}
		state.loaded = true
		state.view = makeThreadView(id, thread, result, request.params, state.view.Revision+1)
		status := stringField(objectField(thread, "status"), "type")
		if status != "idle" && state.active == "" {
			state.active = "unknown"
		}
	case "thread/unsubscribe", "thread/archive", "thread/delete":
		if state := l.threads[request.thread]; state != nil {
			state.loaded = false
		}
	case "turn/start":
		if state := l.threads[request.thread]; state != nil {
			if model := stringField(request.params, "model"); model != "" {
				state.view.Model = model
			}
			if cwd := stringField(request.params, "cwd"); cwd != "" {
				state.view.Workspace = cwd
			}
			if sandbox := stringField(objectField(request.params, "sandboxPolicy"), "type"); sandbox != "" {
				state.view.Sandbox = sandbox
			}
			state.view.Configuration = digest([]any{state.view.Configuration, request.params})
			state.view.Revision++
		}
		turn := objectField(result, "turn")
		id := stringField(turn, "id")
		if state := l.threads[request.thread]; state != nil && id != state.completed {
			state.active = id
		}
	}
	return nil
}

func (l *mediatorLoop) notification(message envelope) error {
	params := objectField(message, "params")
	thread := stringField(params, "threadId")
	state := l.threads[thread]
	if state == nil {
		return nil
	}
	method := stringField(message, "method")
	turnID := stringField(objectField(params, "turn"), "id")
	if len(turnID) > 256 {
		return ErrProtocol
	}
	switch method {
	case "turn/started":
		if turnID == "" {
			return ErrProtocol
		}
		state.view.Revision++
		state.active = turnID
	case "turn/completed":
		if turnID == "" {
			return ErrProtocol
		}
		state.view.Revision++
		state.completed = turnID
		if state.active == turnID {
			state.active = ""
		}
	case "thread/closed":
		state.loaded = false
	}
	fence := l.held[thread]
	if fence == nil {
		return nil
	}
	if method == "thread/closed" {
		fence.paused = true
	}
	run := fence.running
	if run == nil {
		if method == "turn/started" {
			fence.paused = true
		}
		return nil
	}
	if !run.acknowledged {
		data, _ := json.Marshal(message)
		run.earlyBytes += len(data)
		if len(run.early) >= 128 || run.earlyBytes > maxFrame {
			return ErrCapacity
		}
		run.early = append(run.early, message)
		return nil
	}
	return l.runEvent(fence, run, message)
}

func (l *mediatorLoop) runEvent(fence *heldThread, run *operation, message envelope) error {
	method := stringField(message, "method")
	params := objectField(message, "params")
	turnID := stringField(params, "turnId")
	if method == "turn/started" || method == "turn/completed" {
		turnID = stringField(objectField(params, "turn"), "id")
	}
	if method == "turn/started" && turnID != run.turn {
		fence.paused = true
	}
	if turnID != run.turn {
		return nil
	}
	if method == "item/completed" {
		item := objectField(params, "item")
		if stringField(item, "type") == "agentMessage" {
			id, text := stringField(item, "id"), stringField(item, "text")
			if id == "" || len(id) > 256 {
				return ErrProtocol
			}
			if previous, exists := run.items[id]; exists {
				if previous != text {
					return ErrProtocol
				}
				return nil
			}
			if len(run.items) >= maxItems {
				return ErrCapacity
			}
			run.items[id] = text
			if stringField(item, "phase") == "commentary" {
				return nil
			}
			// Native item completion order is output order; duplicate completions
			// cannot append the same text twice.
			if run.result.Text != "" {
				run.result.Text += "\n"
			}
			run.result.Text += text
			if len(run.result.Text) > maxReply {
				return ErrCapacity
			}
		}
	}
	if method == "turn/completed" {
		if fence.paused {
			l.settle(fence, run, ErrInterference)
		} else if stringField(objectField(params, "turn"), "status") != "completed" || strings.TrimSpace(run.result.Text) == "" {
			l.settle(fence, run, ErrTurnFailed)
		} else {
			l.settle(fence, run, nil)
		}
	}
	return nil
}

func (l *mediatorLoop) settle(fence *heldThread, run *operation, err error) {
	if run.settled {
		return
	}
	run.settled, run.err, run.result.TurnID = true, err, run.turn
	if err != nil {
		run.result.Text = ""
	}
	if fence.running == run {
		fence.running = nil
	}
	run.reply <- controlReply{result: run.result, err: err}
}

func (l *mediatorLoop) control(command controlCommand) error {
	reply := func(value controlReply) error { command.reply <- value; return nil }
	if command.kind == "list" {
		var views []ThreadView
		for id, state := range l.threads {
			if state.loaded {
				view := state.view
				view.ThreadID = id
				view.Busy = state.active != "" || l.held[id] != nil
				views = append(views, view)
			}
		}
		return reply(controlReply{views: views})
	}
	if command.kind == "hold" {
		state := l.threads[command.thread]
		if !l.ready || !l.initialized || command.thread == "" || state == nil || !state.loaded {
			return reply(controlReply{err: ErrUnavailable})
		}
		if len(l.sourceIDs) != 0 || len(l.callbacks) != 0 || state.active != "" || l.held[command.thread] != nil {
			return reply(controlReply{err: ErrBusy})
		}
		if len(l.held) >= maxFences {
			return reply(controlReply{err: ErrCapacity})
		}
		l.sequence++
		fence := &heldThread{thread: command.thread, number: l.sequence, operations: map[string]*operation{}}
		l.held[command.thread] = fence
		return reply(controlReply{fence: Fence{owner: l.owner, number: fence.number}})
	}
	var fence *heldThread
	if command.fence.owner == l.owner {
		for _, candidate := range l.held {
			if candidate.number == command.fence.number {
				fence = candidate
				break
			}
		}
	}
	if fence == nil {
		return reply(controlReply{err: ErrUnavailable})
	}
	state := l.threads[fence.thread]
	switch command.kind {
	case "result":
		op := fence.operations[command.continuation.OperationID]
		if op == nil {
			return reply(controlReply{err: ErrUnavailable})
		}
		return reply(controlReply{result: op.result, settled: op.settled, err: op.err})
	case "snapshot":
		return reply(controlReply{view: state.view})
	case "queue", "goal", "config", "tools":
		method := map[string]string{"queue": "thread/queue/list", "goal": "thread/goal/get", "config": "config/read", "tools": "mcpServerStatus/list"}[command.kind]
		params := map[string]any{"threadId": fence.thread}
		if command.kind == "config" {
			params = map[string]any{"includeLayers": false, "cwd": state.view.Workspace}
		}
		if command.kind == "tools" {
			params = map[string]any{}
		}
		return l.request(envelope{"method": raw(method), "params": raw(params)}, pendingRequest{reply: command.reply, fence: fence})
	case "interrupt":
		if fence.running == nil {
			return reply(controlReply{})
		}
		if fence.running.turn == "" {
			return reply(controlReply{err: ErrUnknown})
		}
		return l.request(envelope{"method": raw("turn/interrupt"), "params": raw(map[string]string{"threadId": fence.thread, "turnId": fence.running.turn})}, pendingRequest{reply: command.reply, fence: fence})
	case "state":
		value := FenceState{Paused: fence.paused, Running: fence.running != nil || state.active != "", Uncertain: fence.uncertain}
		if fence.running != nil {
			value.OperationID = fence.running.input.OperationID
		}
		return reply(controlReply{state: value})
	case "release":
		if fence.uncertain {
			return reply(controlReply{err: ErrUnknown})
		}
		if fence.running != nil || state.active != "" {
			return reply(controlReply{err: ErrBusy})
		}
		for _, pending := range l.pending {
			if pending.fence == fence {
				return reply(controlReply{err: ErrBusy})
			}
		}
		delete(l.held, fence.thread)
		return reply(controlReply{})
	case "read":
		return l.request(envelope{"method": raw("thread/read"), "params": raw(map[string]any{"threadId": fence.thread, "includeTurns": false})},
			pendingRequest{reply: command.reply, fence: fence})
	case "execute":
		input := command.continuation
		if len(input.OperationID) == 0 || len(input.OperationID) > 128 || strings.TrimSpace(input.Text) == "" || len(input.Text) > maxReply ||
			!utf8.ValidString(input.OperationID) || !utf8.ValidString(input.Text) {
			return reply(controlReply{err: ErrUnavailable})
		}
		if previous := fence.operations[input.OperationID]; previous != nil {
			if previous.input != input {
				return reply(controlReply{err: ErrInterference})
			}
			if !previous.settled {
				return reply(controlReply{err: ErrUnknown})
			}
			return reply(controlReply{result: previous.result, err: previous.err})
		}
		if fence.paused || !state.loaded {
			return reply(controlReply{err: ErrInterference})
		}
		if fence.running != nil || state.active != "" {
			return reply(controlReply{err: ErrBusy})
		}
		if len(fence.operations) >= maxOperations {
			return reply(controlReply{err: ErrCapacity})
		}
		if input.Sandbox != "" && input.Sandbox != "read-only" && input.Sandbox != "workspace-write" {
			return reply(controlReply{err: ErrUnavailable})
		}
		sandbox := map[string]any{"type": "readOnly"}
		if input.Sandbox == "workspace-write" {
			if input.Workspace == "" || input.Workspace != state.view.Workspace {
				return reply(controlReply{err: ErrInterference})
			}
			sandbox = map[string]any{"type": "workspaceWrite", "writableRoots": []string{input.Workspace}, "networkAccess": false, "excludeTmpdirEnvVar": true, "excludeSlashTmp": true}
		}
		run := &operation{input: input, reply: command.reply, items: map[string]string{}}
		fence.running = run
		fence.operations[input.OperationID] = run
		return l.request(envelope{"method": raw("turn/start"), "params": raw(map[string]any{
			"threadId": fence.thread, "clientUserMessageId": input.OperationID,
			"input":          []any{map[string]string{"type": "text", "text": input.Text}},
			"approvalPolicy": "never", "sandboxPolicy": sandbox,
		})}, pendingRequest{reply: command.reply, fence: fence, run: run})
	default:
		return fmt.Errorf("%w: unsupported local operation", ErrUnavailable)
	}
}
