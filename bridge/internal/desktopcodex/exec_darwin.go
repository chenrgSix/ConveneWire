package desktopcodex

import "syscall"

// Replace preserves the desktop-owned PID, streams and process lifetime.
// It does not leave a separate daemon or relay running after desktop exit.
func Replace(plan Plan, arguments, environment []string) error {
	return syscall.Exec(plan.Provider.Path, append([]string{plan.Provider.Path}, arguments...), ProviderEnvironment(environment, plan.Provider.Path))
}
