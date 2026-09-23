package localnode

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func configureHubCommand(command *exec.Cmd) {
	// The GUI subsystem applies only to the desktop executable. The bundled
	// console Node executable needs its own windowless launch even with pipes.
	command.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
}
