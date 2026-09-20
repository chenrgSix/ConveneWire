package localnode

import (
	"bufio"
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	contracts "convenewire.dev/contracts/generated/go/localnode"
)

type Supervisor struct {
	Data         *Data
	cmd          *exec.Cmd
	input        io.WriteCloser
	done         chan struct{}
	controlToken string
	client       *http.Client
	closeOnce    sync.Once
	closeErr     error
}

// Start verifies the native bundle and waits for child-channel readiness.
// The caller owns Close and must stop its Bridge before releasing this Hub.
func Start(ctx context.Context, bundle, root string) (*Supervisor, error) {
	bundle, err := filepath.Abs(bundle)
	if err != nil {
		return nil, err
	}
	if _, err := VerifyBundle(bundle); err != nil {
		return nil, err
	}
	data, err := OpenData(root)
	if err != nil {
		return nil, err
	}
	token, err := randomSecret()
	if err != nil {
		data.Close()
		return nil, err
	}
	command := exec.Command(filepath.Join(bundle, filepath.FromSlash(nodeExecutable())), filepath.Join(bundle, "apps/server/dist/local-node.js"), data.Root)
	command.Dir = bundle
	command.Env = []string{"PATH=", "NODE_ENV=production"}
	if runtime.GOOS == "windows" {
		command.Env = append(command.Env, "SystemRoot="+os.Getenv("SystemRoot"))
	}
	input, err := command.StdinPipe()
	if err != nil {
		data.Close()
		return nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		data.Close()
		return nil, err
	}
	// The Hub deliberately emits only a generic failure on stderr. Discarding it
	// also prevents a damaged bundle from exposing private launch data in logs.
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		input.Close()
		output.Close()
		data.Close()
		return nil, fmt.Errorf("start bundled Node: %w", err)
	}
	transport := &http.Transport{Proxy: nil}
	supervisor := &Supervisor{Data: data, cmd: command, input: input, done: make(chan struct{}), controlToken: token,
		client: &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Local Hub redirect denied") }}}
	go func() { _ = command.Wait(); close(supervisor.done) }()
	success := false
	defer func() {
		if !success {
			supervisor.Close()
		}
	}()
	launch := contracts.LocalNodeLaunch{SchemaVersion: 1, Identity: contracts.Identity(data.Identity), ControlToken: token}
	encoded, err := json.Marshal(launch)
	if err != nil {
		return nil, err
	}
	if _, err := input.Write(append(encoded, '\n')); err != nil {
		return nil, errors.New("Local Hub launch channel closed")
	}
	ready := make(chan []byte, 1)
	go func() {
		reader := bufio.NewScanner(output)
		reader.Buffer(make([]byte, 4096), 4096)
		if reader.Scan() {
			ready <- append([]byte(nil), reader.Bytes()...)
		} else {
			ready <- nil
		}
		_, _ = io.Copy(io.Discard, output)
	}()
	timeout := time.NewTimer(20 * time.Second)
	defer timeout.Stop()
	select {
	case source := <-ready:
		var message contracts.LocalNodeReady
		if err := contracts.Decode("LocalNodeReady", source, &message); err != nil || message.NodeID != data.Identity.NodeID || message.Origin != data.Origin() ||
			subtle.ConstantTimeCompare([]byte(message.LaunchProof), []byte(token)) != 1 {
			return nil, errors.New("Local Hub failed authenticated readiness; check the bundle, identity and saved port")
		}
	case <-supervisor.done:
		return nil, errors.New("Local Hub exited before readiness; check the bundle, identity and saved port")
	case <-timeout.C:
		return nil, errors.New("Local Hub startup timed out")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if err := data.MarkInitialized(); err != nil {
		return nil, err
	}
	success = true
	return supervisor, nil
}

func (supervisor *Supervisor) Done() <-chan struct{} { return supervisor.done }

func (supervisor *Supervisor) Close() error {
	supervisor.closeOnce.Do(func() {
		_ = supervisor.input.Close()
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		select {
		case <-supervisor.done:
		case <-timer.C:
			_ = supervisor.cmd.Process.Kill()
			<-supervisor.done
		}
		supervisor.client.CloseIdleConnections()
		supervisor.closeErr = supervisor.Data.Close()
	})
	return supervisor.closeErr
}

func (supervisor *Supervisor) control(ctx context.Context, method, endpoint string, output any) error {
	return supervisor.controlInput(ctx, method, endpoint, nil, output)
}
func (supervisor *Supervisor) controlInput(ctx context.Context, method, endpoint string, input any, output any) error {
	select {
	case <-supervisor.done:
		return errors.New("Local Hub has exited")
	default:
	}
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, supervisor.Data.Origin()+endpoint, body)
	if err != nil {
		return err
	}
	request.Header.Set("X-ConveneWire-Node-Control", supervisor.controlToken)
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := supervisor.client.Do(request)
	if err != nil {
		return errors.New("Local Hub control connection failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("Local Hub control was refused (%d)", response.StatusCode)
	}
	source, err := io.ReadAll(io.LimitReader(response.Body, 128<<10))
	if err != nil || len(source) >= 128<<10 {
		return errors.New("invalid Local Hub control response")
	}
	select {
	case <-supervisor.done:
		return errors.New("Local Hub exited during the control request")
	default:
	}
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return errors.New("invalid Local Hub control response")
	}
	return nil
}

func (supervisor *Supervisor) Entry(ctx context.Context) (string, error) {
	var response struct {
		URL string `json:"url"`
	}
	if err := supervisor.control(ctx, http.MethodPost, "/api/local-node/control/entry", &response); err != nil {
		return "", err
	}
	prefix := supervisor.Data.Origin() + "/#/local-node/"
	if len(response.URL) != len(prefix)+43 || response.URL[:len(prefix)] != prefix {
		return "", errors.New("invalid Local Hub entry URL")
	}
	return response.URL, nil
}

func (supervisor *Supervisor) Binding(ctx context.Context) (*contracts.LocalNodeBinding, error) {
	var response struct {
		Binding json.RawMessage `json:"binding"`
	}
	if err := supervisor.control(ctx, http.MethodGet, "/api/local-node/control/binding", &response); err != nil {
		return nil, err
	}
	if bytes.Equal(response.Binding, []byte("null")) {
		return nil, nil
	}
	var binding contracts.LocalNodeBinding
	if err := contracts.Decode("LocalNodeBinding", response.Binding, &binding); err != nil {
		return nil, err
	}
	if binding.ServerURL != supervisor.Data.Origin() {
		return nil, errors.New("Local Hub binding has a foreign origin")
	}
	return &binding, nil
}

func (supervisor *Supervisor) ControlState(ctx context.Context) (contracts.LocalNodeControlState, error) {
	var raw json.RawMessage
	var state contracts.LocalNodeControlState
	if err := supervisor.control(ctx, http.MethodGet, "/api/local-node/control/state", &raw); err != nil {
		return state, err
	}
	if err := contracts.Decode("LocalNodeControlState", raw, &state); err != nil {
		return state, err
	}
	if state.Binding != nil && state.Binding.ServerURL != supervisor.Data.Origin() {
		return state, errors.New("Local Hub binding has a foreign origin")
	}
	return state, nil
}

func (supervisor *Supervisor) Handoff(ctx context.Context, input contracts.DesktopHandoffRequest) (contracts.DesktopHandoffScope, error) {
	var raw json.RawMessage
	var scope contracts.DesktopHandoffScope
	if err := supervisor.controlInput(ctx, http.MethodPost, "/api/local-node/control/handoff", input, &raw); err != nil {
		return scope, err
	}
	if err := contracts.Decode("DesktopHandoffScope", raw, &scope); err != nil {
		return scope, err
	}
	if scope.NodeID != supervisor.Data.Identity.NodeID {
		return scope, errors.New("foreign handoff scope")
	}
	return scope, nil
}
