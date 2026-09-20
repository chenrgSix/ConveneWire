package desktopcodex

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/durablefs"
	"convenewire.dev/bridge/internal/ownership"
	"convenewire.dev/bridge/internal/privatefs"
	wire "convenewire.dev/contracts/generated/go/peer"
)

func opaque() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// ReplacePrivate installs a synced owner-only value atomically. Existing paths
// must be protected regular files; symlinks and foreign ownership are rejected.
func ReplacePrivate(path string, value any) error {
	if err := privatefs.EnsureDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	if _, err := os.Lstat(path); err == nil {
		if _, err = privatefs.ReadFile(path, 4<<20); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	temp := path + "." + opaque()
	if err := privatefs.WriteFile(temp, raw(value)); err != nil {
		return err
	}
	defer os.Remove(temp)
	if err := os.Rename(temp, path); err != nil {
		return err
	}
	return durablefs.SyncParent(path)
}

type Descriptor struct {
	Version  int    `json:"version"`
	Socket   string `json:"socket"`
	Token    string `json:"token"`
	Epoch    string `json:"epoch"`
	Provider string `json:"provider"`
	Profile  string `json:"profile"`
}
type ControlRequest struct {
	Action      string `json:"action"`
	Key         string `json:"key,omitempty"`
	ThreadID    string `json:"threadId,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	OperationID string `json:"operationId,omitempty"`
	Text        string `json:"text,omitempty"`
	Sandbox     string `json:"sandbox,omitempty"`
	Workspace   string `json:"workspace,omitempty"`
}
type ControlResponse struct {
	Error   string              `json:"error,omitempty"`
	Key     string              `json:"key,omitempty"`
	Review  *Review             `json:"review,omitempty"`
	Threads []ThreadView        `json:"threads,omitempty"`
	Result  *ContinuationResult `json:"result,omitempty"`
	State   *FenceState         `json:"state,omitempty"`
	Settled bool                `json:"settled,omitempty"`
}
type Control struct {
	mediator   *Mediator
	descriptor Descriptor
	path       string
	listener   net.Listener
	server     *http.Server
	mu         sync.Mutex
	closeOnce  sync.Once
	fences     map[string]Fence
	lease      *ownership.Lock
}

func StartControl(ctx context.Context, m *Mediator, planPath string, plan Plan, profile string) (*Control, error) {
	if !filepath.IsAbs(planPath) || !filepath.IsAbs(profile) {
		return nil, ErrUnavailable
	}
	if err := privatefs.EnsureDirectory(filepath.Dir(planPath)); err != nil {
		return nil, err
	}
	lease, err := ownership.Acquire(filepath.Dir(planPath))
	if err != nil {
		return nil, ErrBusy
	}
	successful := false
	defer func() {
		if !successful {
			_ = lease.Release()
		}
	}()
	path := filepath.Join(filepath.Dir(planPath), "connection.json")
	if old, err := Connect(path); err == nil {
		call, cancel := context.WithTimeout(ctx, time.Second)
		_, alive := old.Call(call, ControlRequest{Action: "list"})
		cancel()
		if alive == nil {
			return nil, ErrBusy
		}
		// The plan lease is ours and this protected descriptor is no longer
		// reachable. Remove only its socket and empty directory, never other files.
		if info, e := os.Lstat(old.Descriptor.Socket); e == nil && info.Mode()&os.ModeSocket != 0 {
			_ = os.Remove(old.Descriptor.Socket)
		}
		_ = os.Remove(filepath.Dir(old.Descriptor.Socket))
	}
	directory, err := os.MkdirTemp("/tmp", "cw-codex-")
	if err != nil {
		return nil, err
	}
	socket := filepath.Join(directory, "control.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		os.RemoveAll(directory)
		return nil, err
	}
	c := &Control{mediator: m, path: path, listener: listener, fences: map[string]Fence{}, descriptor: Descriptor{Version: 1, Socket: socket, Token: opaque(), Epoch: opaque(), Provider: digest(plan), Profile: digest(profile)}}
	c.lease = lease
	c.server = &http.Server{Handler: http.HandlerFunc(c.handle), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, MaxHeaderBytes: 4096}
	if err := ReplacePrivate(path, c.descriptor); err != nil {
		listener.Close()
		os.RemoveAll(directory)
		return nil, err
	}
	go func() { _ = c.server.Serve(listener) }()
	successful = true
	return c, nil
}
func (c *Control) Close() {
	c.closeOnce.Do(func() {
		defer c.lease.Release()
		_ = c.server.Close()
		if data, e := privatefs.ReadFile(c.path, 4096); e == nil {
			var d Descriptor
			if json.Unmarshal(data, &d) == nil && d.Epoch == c.descriptor.Epoch {
				_ = os.Remove(c.path)
			}
		}
		_ = os.RemoveAll(filepath.Dir(c.descriptor.Socket))
	})
}

func (c *Control) handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	token := r.Header.Get("X-ConveneWire-Codex")
	if r.Method != "POST" || r.URL.Path != "/control" || r.URL.RawQuery != "" || r.Host != "native.codex" || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Mode") != "" || subtle.ConstantTimeCompare([]byte(token), []byte(c.descriptor.Token)) != 1 {
		http.Error(w, "unavailable", http.StatusForbidden)
		return
	}
	data, e := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	var input ControlRequest
	if e != nil || len(data) >= 64<<10 {
		http.Error(w, "invalid", 400)
		return
	}
	if _, e = wire.CanonicalJSON(data); e != nil {
		http.Error(w, "invalid", 400)
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil {
		http.Error(w, "invalid", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	response, err := c.call(ctx, input)
	if err != nil {
		response.Error = err.Error()
	}
	_ = json.NewEncoder(w).Encode(response)
}
func (c *Control) call(ctx context.Context, input ControlRequest) (ControlResponse, error) {
	if input.Action == "list" {
		list, e := c.mediator.List(ctx)
		return ControlResponse{Threads: list}, e
	}
	if input.Action == "review" {
		f, e := c.mediator.Hold(ctx, input.ThreadID)
		if e != nil {
			return ControlResponse{}, e
		}
		review, e := c.mediator.Review(ctx, f)
		if e != nil {
			_ = c.mediator.Release(context.WithoutCancel(ctx), f)
			return ControlResponse{}, e
		}
		key := opaque()
		c.mu.Lock()
		if len(c.fences) >= 256 {
			c.mu.Unlock()
			_ = c.mediator.Release(ctx, f)
			return ControlResponse{}, ErrCapacity
		}
		c.fences[key] = f
		c.mu.Unlock()
		return ControlResponse{Key: key, Review: &review}, nil
	}
	c.mu.Lock()
	f, ok := c.fences[input.Key]
	c.mu.Unlock()
	if !ok {
		return ControlResponse{}, ErrUnavailable
	}
	if f.owner == nil {
		if input.Action == "release" {
			return ControlResponse{}, nil
		}
		return ControlResponse{}, ErrUnavailable
	}
	switch input.Action {
	case "inspect":
		review, e := c.mediator.Review(ctx, f)
		return ControlResponse{Review: &review}, e
	case "state":
		state, e := c.mediator.State(ctx, f)
		return ControlResponse{State: &state}, e
	case "result":
		reply, e := c.mediator.command(ctx, controlCommand{kind: "result", fence: f, continuation: Continuation{OperationID: input.OperationID}})
		return ControlResponse{Result: &reply.result, Settled: reply.settled}, e
	case "continue":
		review, e := c.mediator.Review(ctx, f)
		if e != nil {
			return ControlResponse{}, e
		}
		if input.Fingerprint != review.Fingerprint {
			return ControlResponse{}, ErrInterference
		}
		result, e := c.mediator.Execute(ctx, f, Continuation{OperationID: input.OperationID, Text: input.Text, Sandbox: input.Sandbox, Workspace: input.Workspace})
		return ControlResponse{Result: &result, Settled: e == nil}, e
	case "interrupt":
		return ControlResponse{}, c.mediator.Interrupt(ctx, f)
	case "release":
		e := c.mediator.Release(ctx, f)
		if e == nil {
			c.mu.Lock()
			c.fences[input.Key] = Fence{}
			c.mu.Unlock()
		}
		return ControlResponse{}, e
	default:
		return ControlResponse{}, ErrUnavailable
	}
}

type ControlClient struct {
	Descriptor Descriptor
	client     *http.Client
}

func Connect(path string) (*ControlClient, error) {
	data, err := privatefs.ReadFile(path, 4096)
	if err != nil {
		return nil, ErrUnavailable
	}
	var d Descriptor
	if json.Unmarshal(data, &d) != nil || d.Version != 1 || len(d.Token) != 43 || len(d.Epoch) != 43 || filepath.Dir(filepath.Dir(d.Socket)) != "/tmp" || filepath.Base(d.Socket) != "control.sock" || !strings.HasPrefix(filepath.Base(filepath.Dir(d.Socket)), "cw-codex-") {
		return nil, ErrUnavailable
	}
	if _, err = os.Lstat(filepath.Dir(d.Socket)); err != nil {
		return nil, ErrUnavailable
	}
	if err = privatefs.EnsureDirectory(filepath.Dir(d.Socket)); err != nil {
		return nil, err
	}
	transport := &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", d.Socket)
	}}
	return &ControlClient{Descriptor: d, client: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrUnavailable }}}, nil
}
func (c *ControlClient) Call(ctx context.Context, input ControlRequest) (ControlResponse, error) {
	request, err := http.NewRequestWithContext(ctx, "POST", "http://native.codex/control", bytes.NewReader(raw(input)))
	if err != nil {
		return ControlResponse{}, err
	}
	request.Header.Set("X-ConveneWire-Codex", c.Descriptor.Token)
	response, err := c.client.Do(request)
	if err != nil {
		return ControlResponse{}, ErrClosed
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return ControlResponse{}, ErrUnavailable
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || len(data) >= 1<<20 {
		return ControlResponse{}, ErrProtocol
	}
	var result ControlResponse
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&result) != nil {
		return result, ErrProtocol
	}
	if result.Error != "" {
		return result, errors.New(result.Error)
	}
	return result, nil
}
