package bridgecore

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/admission"
	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/pairing"
	"convenewire.dev/bridge/internal/privatefs"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	wire "convenewire.dev/contracts/generated/go/authority"
)

type authorityConnector struct {
	config     config.Config
	credential pairing.Credential
	verifier   *authority.Verifier
	identities map[string]string
	localIDs   map[string]string
	localNames map[string]string
	gate       *delivery.MappedExecutionGate
	pin        wire.AuthorityPin
	primary    bool
}

func runAuthorities(ctx context.Context, loaded config.Config, credential pairing.Credential, version string,
	observer operations.Observer, identities map[string]string, configuration wire.AuthorityConnectionsConfig, native *nativeResources) error {
	shared := &delivery.ResourceGate{}
	if native != nil {
		shared = native.shared
	}
	connectors, err := configureAuthorities(loaded, credential, identities, configuration, shared)
	if err != nil {
		return err
	}
	known, err := connectors[0].verifier.KnownPrimary(loaded.DataDir, identities)
	if err != nil {
		return err
	}
	if !known {
		verified, err := connectors[0].verifier.Current(ctx)
		if err != nil {
			return err
		}
		if err := authority.AdoptPrimary(loaded.DataDir, verified, identities); err != nil {
			return err
		}
	}
	var processes *admission.GovernedProcessStore
	if native != nil {
		processes = native.processes
	} else {
		partitions, err := authority.OwnedPartitions(loaded.DataDir)
		if err != nil {
			return err
		}
		for _, partition := range partitions {
			b := partition.Binding
			if err := fenceDeviceProcesses(ctx, partition.DataDir, admission.Owner{ServerURL: b.Pin.ServerOrigin, TeamID: b.TeamID, DeviceID: b.DeviceID, OwnerMemberID: b.OwnerMemberID}); err != nil {
				return err
			}
		}
		processRoot := filepath.Join(loaded.DataDir, "core-runtime-processes")
		if err := privatefs.EnsureDirectory(processRoot); err != nil {
			return err
		}
		processes, err = admission.OpenGovernedProcessStore(ctx, processRoot, admission.Owner{ServerURL: credential.ServerURL, TeamID: credential.TeamID, DeviceID: credential.DeviceID, OwnerMemberID: credential.OwnerMemberID})
		if err != nil {
			return err
		}
		defer processes.Close()
		if err := processes.FenceAll(ctx); err != nil {
			return err
		}
	}
	spaces, err := authority.NewSpaceDirectory(loaded.DataDir)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var workers sync.WaitGroup
	failures := make(chan error, len(connectors))
	for _, connector := range connectors {
		workers.Add(1)
		go func(c authorityConnector) {
			defer workers.Done()
			scoped := observer
			scoped.OnConnection = func(event operations.ConnectionEvent) {
				event.AuthorityNodeID = c.pin.AuthorityNodeID
				event.PrimaryAuthority = c.primary
				observer.Connection(event)
			}
			scoped.OnRuntime = func(event operations.RuntimeEvent) {
				event.AuthorityNodeID = c.pin.AuthorityNodeID
				event.AgentName = c.localNames[event.AgentID]
				event.AgentID = c.localIDs[event.AgentID]
				observer.Runtime(event)
			}
			attempt := 0
			for ctx.Err() == nil {
				attempt++
				err := runAuthenticatedConnector(ctx, loaded.DataDir, c, version, scoped, processes, spaces, loaded.LocalNodeID)
				if errors.Is(err, connection.ErrConfigurationChanged) {
					failures <- err
					return
				}
				if ctx.Err() != nil {
					return
				}
				message := "Authority connector unavailable"
				if err != nil {
					message = err.Error()
				}
				scoped.Connection(operations.ConnectionEvent{At: time.Now().UTC(), State: operations.ConnectionRetrying, Attempt: attempt, Error: message})
				timer := time.NewTimer(time.Second)
				select {
				case <-ctx.Done():
					timer.Stop()
					return
				case <-timer.C:
				}
			}
		}(connector)
	}
	var result error
	select {
	case <-ctx.Done():
	case result = <-failures:
		cancel()
	}
	workers.Wait()
	return result
}

func configureAuthorities(loaded config.Config, credential pairing.Credential, identities map[string]string,
	configuration wire.AuthorityConnectionsConfig, shared *delivery.ResourceGate) ([]authorityConnector, error) {
	pin := wire.AuthorityPin(configuration.Primary)
	loaded.AuthorityBound = true
	primaryVerifier, err := authority.NewVerifier(loaded, credential, pin)
	if err != nil {
		return nil, err
	}
	primary := authorityConnector{config: loaded, credential: credential, verifier: primaryVerifier, identities: identities,
		pin: pin, primary: true, localIDs: map[string]string{}, localNames: map[string]string{}}
	primary.gate = &delivery.MappedExecutionGate{Shared: shared, Resources: map[string]delivery.LocalResource{}, Paths: map[string]string{}}
	local := map[string]config.AgentConfig{}
	for _, agent := range loaded.Agents {
		id := identities[agent.Name]
		if id == "" {
			return nil, authority.ErrPartition
		}
		canonical, err := delivery.CanonicalWorkspace(agent.Workspace)
		if err != nil {
			return nil, err
		}
		local[id] = agent
		primary.localIDs[id] = id
		primary.localNames[id] = agent.Name
		primary.gate.Resources[id] = delivery.LocalResource{AgentID: id, Workspace: canonical}
		primary.gate.Paths[id] = agent.Workspace
	}
	if len(local) == 0 {
		return nil, fmt.Errorf("configure a stable local Agent before Authority connectors")
	}
	result := []authorityConnector{primary}
	seen := map[string]bool{pin.AuthorityNodeID: true}
	for _, entry := range configuration.Connectors {
		p := wire.AuthorityPin(entry.Pin)
		if entry.Mode != "device" || seen[p.AuthorityNodeID] || !filepath.IsAbs(entry.CredentialDir) {
			return nil, authority.ErrPartition
		}
		seen[p.AuthorityNodeID] = true
		if _, err := privatefs.ReadFile(filepath.Join(entry.CredentialDir, "device-credential.json"), 1<<20); err != nil {
			return nil, authority.ErrPartition
		}
		cred, err := pairing.Load(entry.CredentialDir)
		if err != nil {
			return nil, authority.ErrPartition
		}
		if cred.TeamID != entry.TeamID || cred.DeviceID != entry.DeviceID || cred.OwnerMemberID != entry.OwnerMemberID {
			return nil, authority.ErrIdentity
		}
		// Only explicit projections inherit the local executable/workspace. Each
		// additional connector starts with no full trust or approval/disclosure
		// consent. An Agent's owner-private output floor must never be downgraded.
		cfg := config.Config{SchemaVersion: loaded.SchemaVersion, AuthorityBound: true, ServerURL: p.ServerOrigin,
			DeviceName: entry.Label, DataDir: filepath.Join(loaded.DataDir, "authorities", p.AuthorityNodeID)}
		c := authorityConnector{config: cfg, credential: cred, pin: p, identities: map[string]string{}, localIDs: map[string]string{}, localNames: map[string]string{},
			gate: &delivery.MappedExecutionGate{Shared: shared, Resources: map[string]delivery.LocalResource{}, Paths: map[string]string{}}}
		for _, mapping := range entry.Projections {
			original, ok := local[mapping.LocalAgentID]
			if !ok || c.identities[mapping.Name] != "" || c.localIDs[mapping.ProjectionAgentID] != "" {
				return nil, authority.ErrPartition
			}
			a := original
			a.Name = mapping.Name
			a.AuthorityNodeID = p.AuthorityNodeID
			a.TrustedExecutionRevision = 0
			a.CentralApprovalRevision = 0
			c.config.Agents = append(c.config.Agents, a)
			c.identities[a.Name] = mapping.ProjectionAgentID
			c.localIDs[mapping.ProjectionAgentID] = mapping.LocalAgentID
			c.localNames[mapping.ProjectionAgentID] = original.Name
			c.gate.Resources[mapping.ProjectionAgentID] = primary.gate.Resources[mapping.LocalAgentID]
			c.gate.Paths[mapping.ProjectionAgentID] = original.Workspace
		}
		c.verifier, err = authority.NewVerifier(c.config, cred, p)
		if err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, nil
}

func runAuthenticatedConnector(ctx context.Context, root string, c authorityConnector, version string, observer operations.Observer, processes bridgeruntime.GovernedProcessTracker, spaces *authority.SpaceDirectory, localNodeID string) error {
	if _, err := os.Lstat(filepath.Join(c.config.DataDir, "device-credential.json")); err == nil {
		saved, err := pairing.Load(c.config.DataDir)
		if err != nil || saved.Token != c.credential.Token || saved.ServerURL != c.credential.ServerURL || saved.TeamID != c.credential.TeamID || saved.DeviceID != c.credential.DeviceID || saved.OwnerMemberID != c.credential.OwnerMemberID {
			return authority.ErrIdentity
		}
		c.credential = saved
		c.verifier, err = authority.NewVerifier(c.config, saved, c.pin)
		if err != nil {
			return err
		}
	}
	verified, err := c.verifier.Current(ctx)
	if err != nil {
		return err
	}
	if c.primary {
		if err := authority.AdoptPrimary(root, verified, c.identities); err != nil {
			return err
		}
	} else {
		partition, err := authority.OpenPartition(root, verified)
		if err != nil {
			return err
		}
		if partition != c.config.DataDir {
			return authority.ErrPartition
		}
		if err := authority.BindProjections(partition, verified, c.localIDs); err != nil {
			return err
		}
		// This is the separately issued credential only; no external profile state
		// or local trust is imported. Existing transport rotation receipts survive.
		if _, err := os.Lstat(filepath.Join(partition, "device-credential.json")); os.IsNotExist(err) {
			if err := pairing.Save(partition, c.credential); err != nil {
				return err
			}
		}
	}
	if err := spaces.Observe(verified, c.config.DeviceName, c.pin.AuthorityNodeID == localNodeID); err != nil {
		return err
	}
	proof := func(ctx context.Context) error {
		current, err := pairing.Load(c.config.DataDir)
		if err != nil {
			return authority.ErrIdentity
		}
		if current.Token != c.credential.Token || current.ServerURL != c.credential.ServerURL || current.TeamID != c.credential.TeamID ||
			current.DeviceID != c.credential.DeviceID || current.OwnerMemberID != c.credential.OwnerMemberID {
			return authority.ErrIdentity
		}
		verifier, err := authority.NewVerifier(c.config, current, c.pin)
		if err != nil {
			return err
		}
		_, err = verifier.Current(ctx)
		return err
	}
	// Remote provisioning is unavailable during B. Local Console replacements
	// drain this entire core and rebuild every resource mapping together.
	return runConnector(ctx, c.config, c.credential, version, observer, nil, c.identities, c.gate, proof, processes, c.pin.AuthorityNodeID)
}
