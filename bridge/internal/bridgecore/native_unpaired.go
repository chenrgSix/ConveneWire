package bridgecore

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/ownership"
)

// ValidateUnpairedConfiguration is available only through the native shell's
// installation capability. Missing Device credentials do not authorize adopting
// a previously paired profile or overlooking its retained process ownership.
func (n *NativeNode) ValidateUnpairedConfiguration(cfg config.Config) error {
	if err := n.checkConfiguration(cfg); err != nil {
		return err
	}
	for _, name := range []string{"device-credential.json", authority.ConfigurationFilename, "authorities", "governed-runtime-processes", "core-runtime-processes"} {
		if _, err := os.Lstat(filepath.Join(cfg.DataDir, name)); !errors.Is(err, os.ErrNotExist) {
			return errNativeNode
		}
	}
	return nil
}

// RunUnpaired runs the existing Node core with only its Peer connector family.
// No Device identity, synthetic credential or second execution core is created.
func (n *NativeNode) RunUnpaired(ctx context.Context, cfg config.Config) error {
	if err := n.ValidateUnpairedConfiguration(cfg); err != nil {
		return err
	}
	ctx, release, err := ownership.AcquireContext(ctx, cfg.DataDir)
	if err != nil {
		return err
	}
	defer release()
	if err := n.ValidateUnpairedConfiguration(cfg); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return nil
	}
	ids, err := nativeLocalIdentities(cfg)
	if err != nil {
		return err
	}
	resources, err := openNodeExecutionResources(ctx, n, cfg, ids)
	if err != nil {
		return err
	}
	defer resources.processes.Close()
	return runNativeConnectors(ctx, n, cfg, ids, resources, operations.Observer{}, nil)
}
