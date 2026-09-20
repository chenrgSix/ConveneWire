package desktopcodex

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestRunProviderFixture(t *testing.T) {
	if os.Getenv("CONVENE_WIRE_PROVIDER_LIFECYCLE_FIXTURE") != "1" {
		return
	}
	err := RunProvider(context.Background(), Plan{Provider: PinnedFile{Path: os.Getenv("CONVENE_WIRE_PROVIDER_FIXTURE_SCRIPT")}}, []string{"app-server"}, os.Environ())
	// The fixture intentionally refuses EOF, so bounded teardown kills it.
	if err != nil && !errors.Is(err, ErrClosed) {
		os.Exit(2)
	}
	os.Exit(0)
}

func TestRunProviderDrainsOwnedDescendantsOnDesktopExit(t *testing.T) {
	root := t.TempDir()
	script, pidPath := filepath.Join(root, "provider"), filepath.Join(root, "provider.pid")
	source := "#!/bin/sh\numask 077\necho $$ > \"$CONVENE_WIRE_PROVIDER_FIXTURE_PID\"\nsleep 60 &\nwhile IFS= read -r line; do :; done\nwait\n"
	if err := os.WriteFile(script, []byte(source), 0700); err != nil {
		t.Fatal(err)
	}
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, self, "-test.run=^TestRunProviderFixture$")
	command.Env = []string{"PATH=/usr/bin:/bin", "CONVENE_WIRE_PROVIDER_LIFECYCLE_FIXTURE=1", "CONVENE_WIRE_PROVIDER_FIXTURE_SCRIPT=" + script, "CONVENE_WIRE_PROVIDER_FIXTURE_PID=" + pidPath}
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	finished := make(chan error, 1)
	go func() { finished <- command.Wait() }()
	pid := 0
	defer func() {
		if pid > 1 {
			_ = syscall.Kill(-pid, syscall.SIGKILL)
		}
		cancel()
	}()
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
		if data, err := os.ReadFile(pidPath); err == nil {
			pid, _ = strconv.Atoi(strings.TrimSpace(string(data)))
			if pid > 1 {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	if pid <= 1 {
		t.Fatal("owned provider did not start")
	}
	if group, err := syscall.Getpgid(pid); err != nil || group != pid {
		t.Fatal("provider must own a separate process group")
	}
	if err := stdin.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("mediator survived desktop EOF")
	}
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); {
		if errors.Is(syscall.Kill(-pid, 0), syscall.ESRCH) {
			pid = 0
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("owned provider descendants survived desktop exit")
}
