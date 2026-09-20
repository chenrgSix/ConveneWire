package desktopcodex

import (
	"os"
	"path/filepath"
	"runtime"
)

func DefaultPlanPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "Application Support", "ConveneWire", "codex-desktop", "launch-plan.json"), nil
}

// Setup is an explicit native Owner action. It does not launch or stop Codex.
func Setup() (string, error) {
	if runtime.GOOS != "darwin" {
		return "", ErrUnavailable
	}
	target, err := DefaultPlanPath()
	if err != nil {
		return "", err
	}
	for _, candidate := range []string{"/Applications/Codex.app/Contents/MacOS/Codex", "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT"} {
		if _, err = os.Stat(filepath.Join(filepath.Dir(filepath.Dir(candidate)), "Resources", "codex")); err != nil {
			continue
		}
		pending := target + "." + opaque()
		plan, err := Prepare(candidate, pending)
		if err != nil {
			return "", err
		}
		defer os.Remove(pending)
		if err = ReplacePrivate(target, plan); err != nil {
			return "", err
		}
		return target, nil
	}
	return "", ErrUnavailable
}
func LaunchPrepared() error {
	target, err := DefaultPlanPath()
	if err != nil {
		return err
	}
	current, err := os.Executable()
	if err != nil {
		return err
	}
	for _, proxy := range []string{filepath.Join(filepath.Dir(current), "convenewire-codex-desktop"), filepath.Join(filepath.Dir(filepath.Dir(current)), "Resources", "bin", "convenewire-codex-desktop")} {
		if info, e := os.Stat(proxy); e == nil && info.Mode().IsRegular() && info.Mode()&0111 != 0 {
			return Launch(target, proxy)
		}
	}
	return ErrUnavailable
}
