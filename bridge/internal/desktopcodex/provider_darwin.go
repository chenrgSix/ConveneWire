package desktopcodex

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// RunProvider keeps the experimental desktop on one original stdio connection.
// A protected local coordinator endpoint shares this connection. The desktop
// owns this mediator, which in turn owns and drains its native process group.
func RunProvider(ctx context.Context, plan Plan, args, environment []string) error {
	if len(args) == 1 && (args[0] == "--version" || args[0] == "-V") {
		return Replace(plan, args, environment)
	}
	if err := ValidateArguments(args); err != nil {
		return err
	}
	processContext, cancel := context.WithCancel(ctx)
	defer cancel()
	command := exec.CommandContext(processContext, plan.Provider.Path, args...)
	command.Env = ProviderEnvironment(environment, plan.Provider.Path)
	command.Stderr = os.Stderr
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.WaitDelay = time.Second
	kill := func() error {
		if command.Process == nil {
			return os.ErrProcessDone
		}
		err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	command.Cancel = kill
	input, err := command.StdinPipe()
	if err != nil {
		return ErrUnavailable
	}
	// Own stdout rather than letting Wait close a pipe still being decoded.
	output, childOutput, err := os.Pipe()
	if err != nil {
		_ = input.Close()
		return ErrUnavailable
	}
	command.Stdout = childOutput
	if err := command.Start(); err != nil {
		_ = input.Close()
		_ = output.Close()
		_ = childOutput.Close()
		return ErrUnavailable
	}
	_ = childOutput.Close()
	finished := make(chan error, 1)
	go func() { finished <- command.Wait() }()
	mediator := NewMediator()
	if planPath := os.Getenv(ConfigEnvironment); planPath != "" {
		profile := os.Getenv("CODEX_HOME")
		if profile == "" {
			home, _ := os.UserHomeDir()
			profile = filepath.Join(home, ".codex")
		}
		control, controlErr := StartControl(ctx, mediator, planPath, plan, profile)
		if controlErr != nil {
			cancel()
			_ = input.Close()
			_ = output.Close()
			<-finished
			return controlErr
		}
		defer control.Close()
	}
	err = mediator.Serve(ctx, Streams{DesktopInput: os.Stdin, DesktopOutput: os.Stdout, ProviderInput: output, ProviderOutput: input})
	// Serve has closed the pipes. Allow normal EOF shutdown to persist native
	// state, then drain any remaining owned descendants within a fixed bound.
	var exitErr error
	select {
	case exitErr = <-finished:
	case <-time.After(500 * time.Millisecond):
		cancel()
		exitErr = <-finished
	}
	_ = kill()
	// Wait also reaps the provider leader. Descendants may finish slightly later;
	// do not report completed cleanup while that owned group still exists.
	drained := false
	for deadline := time.Now().Add(2 * time.Second); time.Now().Before(deadline); {
		if errors.Is(syscall.Kill(-command.Process.Pid, 0), syscall.ESRCH) {
			drained = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !drained {
		return ErrClosed
	}
	if ctx.Err() != nil {
		return nil
	}
	if !errors.Is(err, ErrClosed) {
		return err
	}
	if exitErr != nil {
		return ErrClosed
	}
	return nil
}
