package desktopcodex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/privatefs"
	localwire "convenewire.dev/contracts/generated/go/localnode"
)

type HubControl func(context.Context, localwire.DesktopHandoffRequest) (localwire.DesktopHandoffScope, error)
type AgentResolver func(string) (config.AgentConfig, error)
type Receipt struct {
	Hash   string             `json:"hash"`
	State  string             `json:"state"`
	Result ContinuationResult `json:"result"`
}
type Adoption struct {
	ID           string                        `json:"id"`
	ReviewID     string                        `json:"reviewId"`
	Scope        localwire.DesktopHandoffScope `json:"scope"`
	Review       Review                        `json:"review"`
	Epoch        string                        `json:"epoch"`
	Provider     string                        `json:"provider"`
	Profile      string                        `json:"profile"`
	Key          string                        `json:"key"`
	ConfigDigest string                        `json:"configDigest"`
	Sandbox      string                        `json:"sandbox"`
	State        string                        `json:"state"`
	ReviewedAt   time.Time                     `json:"reviewedAt"`
	Operations   map[string]Receipt            `json:"operations"`
}
type Coordinator struct {
	mu                                    sync.Mutex
	root, nodeID, descriptor, pendingTask string
	records                               map[string]*Adoption
	hub                                   HubControl
	agent                                 AgentResolver
}

func NewCoordinator(root, nodeID, descriptor string, hub HubControl, agent AgentResolver) (*Coordinator, error) {
	if !filepath.IsAbs(root) || !filepath.IsAbs(descriptor) || hub == nil || agent == nil {
		return nil, ErrUnavailable
	}
	if err := privatefs.EnsureDirectory(root); err != nil {
		return nil, err
	}
	c := &Coordinator{root: root, nodeID: nodeID, descriptor: descriptor, records: map[string]*Adoption{}, hub: hub, agent: agent}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	if len(entries) > 128 {
		return nil, ErrCapacity
	}
	for _, entry := range entries {
		if filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, e := privatefs.ReadFile(filepath.Join(root, entry.Name()), 2<<20)
		if e != nil {
			return nil, e
		}
		var record Adoption
		if json.Unmarshal(data, &record) != nil || record.Scope.NodeID != nodeID || entry.Name() != digest(record.Scope.TaskID)+".json" || record.Operations == nil {
			return nil, ErrUnavailable
		}
		// Any persisted nonterminal owner is paused until explicitly reviewed again.
		if record.State != "released" && record.State != "releasing" {
			record.State = "paused"
		}
		c.records[record.Scope.TaskID] = &record
		if e = c.save(&record); e != nil {
			return nil, e
		}
	}
	return c, nil
}
func (c *Coordinator) save(record *Adoption) error {
	if len(raw(record)) >= 2<<20 {
		return ErrCapacity
	}
	return ReplacePrivate(filepath.Join(c.root, digest(record.Scope.TaskID)+".json"), record)
}
func (c *Coordinator) SetPending(task string) { c.mu.Lock(); defer c.mu.Unlock(); c.pendingTask = task }

type CoordinatorView struct {
	Supported bool                           `json:"supported"`
	Bindings  []AdoptionView                 `json:"bindings"`
	TaskID    string                         `json:"taskId"`
	Scope     *localwire.DesktopHandoffScope `json:"scope,omitempty"`
	Connected bool                           `json:"connected"`
	Threads   []ThreadView                   `json:"threads"`
	Adoption  *AdoptionView                  `json:"adoption,omitempty"`
}
type AdoptionView struct {
	Scope     localwire.DesktopHandoffScope `json:"scope"`
	ID        string                        `json:"id"`
	ReviewID  string                        `json:"reviewId"`
	Review    Review                        `json:"review"`
	State     string                        `json:"state"`
	Sandbox   string                        `json:"sandbox"`
	Unsettled bool                          `json:"unsettled"`
}

func adoptionView(r *Adoption) *AdoptionView {
	if r == nil {
		return nil
	}
	v := &AdoptionView{Scope: r.Scope, ID: r.ID, ReviewID: r.ReviewID, Review: r.Review, State: r.State, Sandbox: r.Sandbox}
	for _, op := range r.Operations {
		if op.State == "pending" {
			v.Unsettled = true
		}
	}
	return v
}
func (c *Coordinator) View(ctx context.Context) (CoordinatorView, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	view := CoordinatorView{Supported: runtime.GOOS == "darwin", TaskID: c.pendingTask, Threads: []ThreadView{}, Bindings: []AdoptionView{}}
	for _, record := range c.records {
		if record.State != "released" {
			view.Bindings = append(view.Bindings, *adoptionView(record))
		}
	}
	if c.pendingTask != "" {
		scope, err := c.hub(ctx, localwire.DesktopHandoffRequest{Action: localwire.Scope, TaskID: c.pendingTask})
		record := c.records[c.pendingTask]
		if err != nil {
			if record == nil {
				return view, err
			}
			scope = record.Scope
			scope.State = localwire.Paused
		}
		view.Scope = &scope
		view.Adoption = adoptionView(record)
		if (err != nil || scope.State == localwire.Paused) && view.Adoption != nil && view.Adoption.State != "released" && view.Adoption.State != "releasing" && view.Adoption.State != "running" {
			view.Adoption.State = "paused"
		}
	}
	pauseDisconnected := func() {
		if view.Adoption != nil && view.Adoption.State == "attached" {
			view.Adoption.State = "paused"
		}
	}
	client, err := Connect(c.descriptor)
	if err != nil {
		pauseDisconnected()
		return view, nil
	}
	list, err := client.Call(ctx, ControlRequest{Action: "list"})
	if err != nil {
		pauseDisconnected()
		return view, nil
	}
	if record := c.records[c.pendingTask]; record != nil && (record.Epoch != client.Descriptor.Epoch || record.Profile != client.Descriptor.Profile || record.Provider != client.Descriptor.Provider) {
		pauseDisconnected()
	}
	view.Connected = true
	if list.Threads != nil {
		view.Threads = list.Threads
	}
	return view, nil
}
func (c *Coordinator) client(record *Adoption) (*ControlClient, error) {
	client, err := Connect(c.descriptor)
	if err != nil {
		return nil, err
	}
	if client.Descriptor.Epoch != record.Epoch || client.Descriptor.Provider != record.Provider || client.Descriptor.Profile != record.Profile {
		return nil, ErrInterference
	}
	return client, nil
}
func (c *Coordinator) configuration(scope localwire.DesktopHandoffScope) (config.AgentConfig, string, error) {
	if scope.NodeID != c.nodeID {
		return config.AgentConfig{}, "", ErrUnavailable
	}
	cfg, err := c.agent(scope.AgentID)
	if err != nil {
		return cfg, "", err
	}
	cwd, err := filepath.EvalSymlinks(cfg.Workspace)
	if err != nil || !filepath.IsAbs(cwd) || cfg.OwnerPrivateOutput || cfg.AuthorityNodeID != "" || cfg.PeerRuntimeNamespace != "" || cfg.Adapter != "codex" || (cfg.Sandbox != "workspace-write" && cfg.Sandbox != "read-only") {
		return cfg, "", ErrUnavailable
	}
	cfg.Workspace = cwd
	return cfg, digest(cfg), nil
}
func (c *Coordinator) Review(ctx context.Context, task, thread string) (AdoptionView, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if task != c.pendingTask {
		return AdoptionView{}, ErrUnavailable
	}
	scope, err := c.hub(ctx, localwire.DesktopHandoffRequest{Action: localwire.Scope, TaskID: task})
	if err != nil {
		return AdoptionView{}, err
	}
	cfg, configDigest, err := c.configuration(scope)
	if err != nil {
		return AdoptionView{}, err
	}
	client, err := Connect(c.descriptor)
	if err != nil {
		return AdoptionView{}, err
	}
	old := c.records[task]
	for key, existing := range c.records {
		if key != task && existing.State != "released" && existing.Profile == client.Descriptor.Profile && existing.Review.Thread.ThreadID == thread {
			return AdoptionView{}, ErrBusy
		}
	}
	if old != nil && old.State != "released" {
		if old.Review.Thread.ThreadID != thread || old.Profile != client.Descriptor.Profile || old.Provider != client.Descriptor.Provider {
			return AdoptionView{}, ErrInterference
		}
		if old.Epoch == client.Descriptor.Epoch {
			// Recover exact receipts without resubmitting. Pending or uncertain turns
			// prevent a new review; only settled provider operations may move forward.
			for id, op := range old.Operations {
				if op.State == "pending" {
					outcome, e := client.Call(ctx, ControlRequest{Action: "result", Key: old.Key, OperationID: id})
					if !outcome.Settled {
						return AdoptionView{}, ErrUnknown
					}
					op.State = "settled"
					if e != nil {
						op.State = "failed"
					}
					if outcome.Result != nil {
						op.Result = *outcome.Result
					}
					old.Operations[id] = op
				}
			}
			if err = c.save(old); err != nil {
				return AdoptionView{}, err
			}
			if _, err = client.Call(ctx, ControlRequest{Action: "release", Key: old.Key}); err != nil {
				return AdoptionView{}, err
			}
		}
	}
	response, err := client.Call(ctx, ControlRequest{Action: "review", ThreadID: thread})
	if err != nil || response.Review == nil {
		return AdoptionView{}, ErrUnavailable
	}
	release := func() {
		call, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		_, _ = client.Call(call, ControlRequest{Action: "release", Key: response.Key})
	}
	if response.Review.Thread.Workspace != cfg.Workspace {
		release()
		return AdoptionView{}, errors.New("Codex 会话的工作区与此 Agent 不一致，请先选择相同工作区的 Agent")
	}
	if len(c.records) >= 128 && old == nil {
		release()
		return AdoptionView{}, ErrCapacity
	}
	id := opaque()
	operations := map[string]Receipt{}
	if scope.AdoptionID != "" {
		id = scope.AdoptionID
		if old == nil || old.ID != id || old.State == "released" {
			release()
			return AdoptionView{}, ErrUnavailable
		}
		operations = old.Operations
	}
	record := &Adoption{ID: id, ReviewID: opaque(), Scope: scope, Review: *response.Review, Epoch: client.Descriptor.Epoch, Provider: client.Descriptor.Provider, Profile: client.Descriptor.Profile, Key: response.Key, ConfigDigest: configDigest, Sandbox: cfg.Sandbox, State: "reviewed", ReviewedAt: time.Now(), Operations: operations}
	if err = c.save(record); err != nil {
		release()
		return AdoptionView{}, err
	}
	c.records[task] = record
	return *adoptionView(record), nil
}
func (c *Coordinator) Confirm(ctx context.Context, task, reviewID string, disclose bool) (AdoptionView, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	record := c.records[task]
	if record == nil || record.State != "reviewed" || record.ReviewID != reviewID || !disclose || time.Since(record.ReviewedAt) > 10*time.Minute {
		return AdoptionView{}, ErrUnavailable
	}
	scope, err := c.hub(ctx, localwire.DesktopHandoffRequest{Action: localwire.Scope, TaskID: task})
	if err != nil || scope.AudienceDigest != record.Scope.AudienceDigest {
		return AdoptionView{}, fmt.Errorf("%w: destination review changed", ErrInterference)
	}
	_, pin, err := c.configuration(scope)
	if err != nil || pin != record.ConfigDigest {
		return AdoptionView{}, fmt.Errorf("%w: configured Agent changed", ErrInterference)
	}
	client, err := c.client(record)
	if err != nil {
		return AdoptionView{}, err
	}
	current, err := client.Call(ctx, ControlRequest{Action: "inspect", Key: record.Key})
	if err != nil || current.Review == nil || current.Review.Fingerprint != record.Review.Fingerprint {
		return AdoptionView{}, fmt.Errorf("%w: native review changed (%v)", ErrInterference, err)
	}
	// Save intent before the cross-process commit. A lost response pauses on
	// restart and leaves the same opaque adoption ID available for reconciliation.
	record.State = "confirming"
	if err = c.save(record); err != nil {
		return AdoptionView{}, err
	}
	scope, err = c.hub(ctx, localwire.DesktopHandoffRequest{Action: localwire.Confirm, TaskID: task, AdoptionID: &record.ID, AudienceDigest: &record.Scope.AudienceDigest})
	if err != nil {
		record.State = "paused"
		_ = c.save(record)
		return AdoptionView{}, err
	}
	record.Scope = scope
	for id, op := range record.Operations {
		if op.State == "pending" {
			op.State = "unknown"
			record.Operations[id] = op
		}
	}
	record.State = "attached"
	if err = c.save(record); err != nil {
		return AdoptionView{}, err
	}
	return *adoptionView(record), nil
}
func (c *Coordinator) Release(ctx context.Context, task string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	record := c.records[task]
	if record == nil {
		return ErrUnavailable
	}
	if record.State == "running" {
		return ErrBusy
	}
	if record.State == "released" {
		return nil
	}
	if record.State != "releasing" {
		client, err := c.client(record)
		if err == nil {
			_, err = client.Call(ctx, ControlRequest{Action: "release", Key: record.Key})
		}
		if err != nil {
			// A dead mediator has no fence. Verify the SAME source is now idle via a
			// fresh original connection; never infer settlement from mere disconnection.
			current, e := Connect(c.descriptor)
			if e != nil || current.Descriptor.Epoch == record.Epoch || current.Descriptor.Profile != record.Profile || current.Descriptor.Provider != record.Provider {
				return ErrUnknown
			}
			review, e := current.Call(ctx, ControlRequest{Action: "review", ThreadID: record.Review.Thread.ThreadID})
			if e != nil {
				return e
			}
			if _, e = current.Call(ctx, ControlRequest{Action: "release", Key: review.Key}); e != nil {
				return e
			}
		}
		record.State = "releasing"
		if err = c.save(record); err != nil {
			return err
		}
	}
	// Resolve the same ID even when the confirmation acknowledgment was lost.
	// Keep a retryable local record until the Hub has acknowledged return.
	scope, err := c.hub(ctx, localwire.DesktopHandoffRequest{Action: localwire.Release, TaskID: task, AdoptionID: &record.ID})
	if err != nil {
		return err
	}
	if scope.AdoptionID == "" {
		path := filepath.Join(c.root, digest(task)+".json")
		if err = os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err = durablefs.SyncParent(path); err != nil {
			return err
		}
		delete(c.records, task)
		return nil
	}
	record.Scope, record.State = scope, "released"
	return c.save(record)
}

// Execute keeps exact operation identity durable before touching the provider.
// Existing receipts are queried, never sent a second time after ambiguity.
func (c *Coordinator) Execute(ctx context.Context, task, agent, room, adoption, audience, runID, text string) (ContinuationResult, error) {
	c.mu.Lock()
	record := c.records[task]
	if record == nil || record.ID != adoption || record.Scope.AgentID != agent || record.Scope.RoomID != room || record.Scope.AudienceDigest != audience || record.State != "attached" {
		c.mu.Unlock()
		return ContinuationResult{}, ErrUnavailable
	}
	_, pin, err := c.configuration(record.Scope)
	if err != nil || pin != record.ConfigDigest {
		c.mu.Unlock()
		return ContinuationResult{}, ErrInterference
	}
	request := localwire.DesktopHandoffRequest{Action: localwire.Validate, TaskID: task, AdoptionID: &record.ID, AudienceDigest: &record.Scope.AudienceDigest, RunID: &runID}
	if _, err = c.hub(ctx, request); err != nil {
		c.mu.Unlock()
		return ContinuationResult{}, err
	}
	client, err := c.client(record)
	if err != nil {
		record.State = "paused"
		_ = c.save(record)
		c.mu.Unlock()
		return ContinuationResult{}, err
	}
	inputHash := digest([]string{runID, text, pin, audience})
	if receipt, exists := record.Operations[runID]; exists {
		c.mu.Unlock()
		if receipt.Hash != inputHash {
			return ContinuationResult{}, ErrInterference
		}
		if receipt.State == "settled" {
			return receipt.Result, nil
		}
		return ContinuationResult{}, ErrUnknown
	}
	if len(record.Operations) >= 64 {
		c.mu.Unlock()
		return ContinuationResult{}, ErrCapacity
	}
	record.Operations[runID] = Receipt{Hash: inputHash, State: "pending"}
	record.State = "running"
	if err = c.save(record); err != nil {
		record.State = "paused"
		c.mu.Unlock()
		return ContinuationResult{}, err
	}
	call := ControlRequest{Action: "continue", Key: record.Key, Fingerprint: record.Review.Fingerprint, OperationID: runID, Text: text, Sandbox: record.Sandbox, Workspace: record.Review.Thread.Workspace}
	c.mu.Unlock()
	result, runErr := client.Call(ctx, call)
	if ctx.Err() != nil {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_, _ = client.Call(cleanup, ControlRequest{Action: "interrupt", Key: call.Key})
		cancel()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	record.State = "paused"
	if runErr != nil {
		_ = c.save(record)
		return ContinuationResult{}, ErrUnknown
	}
	if result.Result == nil {
		_ = c.save(record)
		return ContinuationResult{}, ErrUnknown
	}
	// Recheck both native scope and Hub audience before any text reaches the Run.
	review, err := client.Call(ctx, ControlRequest{Action: "inspect", Key: record.Key})
	if err != nil || review.Review == nil || review.Review.AuthorityDigest != record.Review.AuthorityDigest {
		_ = c.save(record)
		return ContinuationResult{}, ErrInterference
	}
	if _, err = c.hub(ctx, request); err != nil {
		_ = c.save(record)
		return ContinuationResult{}, ErrInterference
	}
	record.Review = *review.Review
	record.Operations[runID] = Receipt{Hash: inputHash, State: "settled", Result: *result.Result}
	record.State = "attached"
	if err = c.save(record); err != nil {
		record.State = "paused"
		return ContinuationResult{}, err
	}
	return *result.Result, nil
}

func (c *Coordinator) HasTask(task string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, found := c.records[task]
	return found
}

// Continue exposes only Room-safe output and settlement to the Runtime adapter.
// Native turn identity remains inside the protected coordinator.
func (c *Coordinator) Continue(ctx context.Context, task, agent, room, adoption, audience, runID, text string) (string, bool, error) {
	result, err := c.Execute(ctx, task, agent, room, adoption, audience, runID, text)
	return result.Text, errors.Is(err, ErrUnknown), err
}

func (c *Coordinator) PendingTask() string { c.mu.Lock(); defer c.mu.Unlock(); return c.pendingTask }

// Unknown native execution retains a conservative Node scheduling fence until
// settlement is reviewed or control is demonstrably returned to an idle source.
func (c *Coordinator) WorkReady() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, r := range c.records {
		if r.State != "released" {
			for _, op := range r.Operations {
				if op.State == "pending" {
					return ErrBusy
				}
			}
		}
	}
	return nil
}
