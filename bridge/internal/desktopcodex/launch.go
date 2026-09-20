package desktopcodex

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var ErrDesktopRunning = errors.New("quit the selected Codex desktop before launching; a second instance will not be opened")

func LaunchArguments(plan Plan, planPath, proxy string, environment []string, running bool) ([]string, error) {
	if running {
		return nil, ErrDesktopRunning
	}
	if err := plan.validate(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(planPath) || !filepath.IsAbs(proxy) {
		return nil, errors.New("explicit absolute launch paths are required")
	}
	for _, entry := range environment {
		key, value, _ := strings.Cut(entry, "=")
		if (key == "CODEX_APP_SERVER_WS_URL" && value != "") ||
			(key == "CODEX_CLI_PATH" && value != "" && value != proxy && value != plan.Provider.Path) {
			return nil, errors.New("an existing Codex transport override requires reconciliation before launch")
		}
	}
	return []string{"-a", plan.Bundle(), "--env", "CODEX_CLI_PATH=" + proxy,
		"--env", ConfigEnvironment + "=" + planPath}, nil
}

// Launch does not stop any desktop or alter persistent OS/application settings.
func Launch(planPath, proxy string) error {
	plan, err := LoadVerified(planPath, proxy)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// Query only the selected executable, rather than matching other apps by name.
	output, err := exec.CommandContext(ctx, "/usr/bin/pgrep", "-f", "^"+regexp.QuoteMeta(plan.Desktop.Path)+"( |$)").CombinedOutput()
	running := err == nil
	if err != nil {
		var status *exec.ExitError
		if !errors.As(err, &status) || status.ExitCode() != 1 || len(output) != 0 || ctx.Err() != nil {
			return errors.New("cannot establish whether the selected desktop is running")
		}
	}
	args, err := LaunchArguments(plan, planPath, proxy, os.Environ(), running)
	if err != nil {
		return err
	}
	// Do not pass -n: LaunchServices must not create another instance if another
	// actor launches the app between the running check and this request.
	if err := exec.CommandContext(ctx, "/usr/bin/open", args...).Run(); err != nil {
		return errors.New("desktop launch failed; ordinary app launch remains available")
	}
	return nil
}
