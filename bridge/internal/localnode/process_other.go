//go:build !windows

package localnode

import "os/exec"

func configureHubCommand(_ *exec.Cmd) {}
