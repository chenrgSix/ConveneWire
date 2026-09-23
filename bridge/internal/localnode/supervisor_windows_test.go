package localnode

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

	"golang.org/x/sys/windows"
)

// The fixture is a real console-subsystem executable. Observe its actual
// console inside the child, before TestMain serves the normal Hub protocol.
func init() {
	if len(os.Args) != 3 || !strings.HasSuffix(os.Args[1], "local-node.js") {
		return
	}
	if _, err := os.Stat(filepath.Join(os.Args[2], "fixture-console-probe")); err != nil {
		return
	}
	getConsoleWindow := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetConsoleWindow")
	if err := getConsoleWindow.Find(); err != nil {
		os.Exit(90)
	}
	handle, _, _ := getConsoleWindow.Call()
	if err := os.WriteFile(filepath.Join(os.Args[2], "fixture-console-handle"),
		[]byte(strconv.FormatUint(uint64(handle), 16)), 0600); err != nil {
		os.Exit(91)
	}
}

func TestWindowsHubHasNoConsoleAndPreservesReadinessAndShutdown(t *testing.T) {
	bundle := testChildBundle(t)
	root := windowsConsoleProbeRoot(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	supervisor, err := Start(ctx, bundle, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = supervisor.Close() })
	if handle := windowsFixtureConsoleHandle(t, root); handle != 0 {
		t.Fatal("background Hub allocated or inherited a console")
	}
	if err := supervisor.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-supervisor.Done():
	default:
		t.Fatal("Hub shutdown did not observe child exit")
	}
	if !supervisor.cmd.ProcessState.Success() {
		t.Fatal("Hub did not exit normally when its launch pipe closed")
	}
	data, err := OpenData(root)
	if err != nil {
		t.Fatal("Hub shutdown retained its owner lease", err)
	}
	if err := data.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsHubConsoleProbeDetectsHiddenConsole(t *testing.T) {
	// A hidden console is still a console. This control proves the child probe
	// distinguishes CREATE_NO_WINDOW from merely hiding a startup window.
	bundle := testChildBundle(t)
	root := windowsConsoleProbeRoot(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, filepath.Join(bundle, filepath.FromSlash(nodeExecutable())),
		filepath.Join(bundle, "apps/server/dist/local-node.js"), root)
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true, CreationFlags: windows.CREATE_NEW_CONSOLE,
	}
	// Empty stdin makes the normal fixture exit after recording its console.
	var exited *exec.ExitError
	if err := command.Run(); !errors.As(err, &exited) || exited.ExitCode() != 2 {
		t.Fatalf("expected fixture to reject empty startup input, got %v", err)
	}
	if handle := windowsFixtureConsoleHandle(t, root); handle == 0 {
		t.Fatal("console probe failed to detect the allocated hidden console")
	}
}

func windowsConsoleProbeRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "node")
	data, err := OpenData(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := data.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fixture-console-probe"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func windowsFixtureConsoleHandle(t *testing.T, root string) uint64 {
	t.Helper()
	value, err := os.ReadFile(filepath.Join(root, "fixture-console-handle"))
	if err != nil {
		t.Fatal(err)
	}
	handle, err := strconv.ParseUint(string(value), 16, 64)
	if err != nil {
		t.Fatal(err)
	}
	return handle
}
