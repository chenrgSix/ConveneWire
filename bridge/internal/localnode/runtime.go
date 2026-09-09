package localnode

import (
	"context"
	"errors"

	"convenewire.dev/bridge/internal/bridgecore"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/console"
	"convenewire.dev/bridge/internal/enrollment"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/updatecheck"
)

func RuntimeDependencies(version string) console.Dependencies {
	return console.Dependencies{
		Enroll: func(context.Context, config.Config, func(enrollment.Challenge)) (pairing.Credential, error) {
			return pairing.Credential{}, errors.New("Local Node pairing is managed by its desktop")
		},
		SaveConfig: config.Save, ReplaceConfig: config.Replace, SaveCredential: pairing.Save,
		ProbeRuntime: console.ProbeRuntime, UpdateChecker: updatecheck.New(),
		RunBridge: func(ctx context.Context, loaded config.Config, credential pairing.Credential, observer operations.Observer) error {
			return bridgecore.RunObserved(ctx, loaded, credential, version, observer)
		},
		RunBridgeWithProvisioning: func(ctx context.Context, loaded config.Config, credential pairing.Credential, observer operations.Observer, handler connection.ProvisionHandler) error {
			return bridgecore.RunObservedWithProvisioning(ctx, loaded, credential, version, observer, handler)
		},
	}
}
