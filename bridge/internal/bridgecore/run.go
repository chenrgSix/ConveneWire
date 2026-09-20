package bridgecore

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"convenewire.dev/bridge/internal/admission"
	bridgeartifact "convenewire.dev/bridge/internal/artifact"
	"convenewire.dev/bridge/internal/authority"
	"convenewire.dev/bridge/internal/config"
	"convenewire.dev/bridge/internal/connection"
	"convenewire.dev/bridge/internal/delivery"
	"convenewire.dev/bridge/internal/identity"
	"convenewire.dev/bridge/internal/operations"
	"convenewire.dev/bridge/internal/ownership"
	"convenewire.dev/bridge/internal/pairing"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	contracts "convenewire.dev/contracts/generated/go"
	execution "convenewire.dev/contracts/generated/go/execution"
)

type governedAgentReadiness struct {
	mu     sync.RWMutex
	agents map[string]bool
}

func (r *governedAgentReadiness) replace(agents map[string]bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.agents = make(map[string]bool, len(agents))
	for agentID, ready := range agents {
		if ready {
			r.agents[agentID] = true
		}
	}
}

func (r *governedAgentReadiness) allows(agentID string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.agents[agentID]
}

// Run starts one managed Bridge connection and blocks until the context ends.
// Both CLI and desktop shells call this function so delivery and Runtime
// semantics cannot drift between launch modes.
func Run(
	ctx context.Context,
	loaded config.Config,
	credential pairing.Credential,
	bridgeVersion string,
) error {
	return RunObserved(ctx, loaded, credential, bridgeVersion, operations.Observer{})
}

// RunObserved starts one managed Bridge connection and reports local-only
// connection and Runtime lifecycle events to the supplied observer.
func RunObserved(
	ctx context.Context,
	loaded config.Config,
	credential pairing.Credential,
	bridgeVersion string,
	observer operations.Observer,
) error {
	return RunObservedWithProvisioning(
		ctx, loaded, credential, bridgeVersion, observer, nil,
	)
}

// RunObservedWithProvisioning keeps central requests behind a handler owned by
// the local Console. The connection layer can transport a request but cannot
// mutate Runtime configuration by itself.
func RunObservedWithProvisioning(
	ctx context.Context,
	loaded config.Config,
	credential pairing.Credential,
	bridgeVersion string,
	observer operations.Observer,
	handleProvision connection.ProvisionHandler,
) error {
	ownedContext, releaseOwner, err := ownership.AcquireContext(ctx, loaded.DataDir)
	if err != nil {
		return err
	}
	defer releaseOwner()
	ctx = ownedContext
	if ctx.Err() != nil {
		return nil
	}
	connections, err := authority.ReadConfiguration(loaded.DataDir)
	if err != nil {
		return err
	}
	var identities map[string]string
	if connections != nil {
		identities, err = authority.ReadLocalIdentities(loaded.DataDir, loaded.Agents)
	} else {
		identities, err = identity.LoadOrCreate(loaded.DataDir, loaded.Agents)
	}
	if err != nil {
		return err
	}
	var native *nativeResources
	if node := nativeNodeFromContext(ctx); node != nil {
		native, err = openNativeResources(ctx, node, loaded, credential, identities)
		if err != nil {
			return err
		}
		defer native.processes.Close()
	}
	if native != nil {
		return runNativeConnectors(ctx, nativeNodeFromContext(ctx), loaded, identities, native, observer, func(ctx context.Context) error {
			if connections != nil {
				return runAuthorities(ctx, loaded, credential, bridgeVersion, observer, identities, *connections, native)
			}
			return runConnector(ctx, loaded, credential, bridgeVersion, observer, handleProvision, identities, native.primary, nil, native.processes, loaded.LocalNodeID)
		})
	}
	if connections != nil {
		return runAuthorities(ctx, loaded, credential, bridgeVersion, observer, identities, *connections, nil)
	}
	return runConnector(ctx, loaded, credential, bridgeVersion, observer, handleProvision, identities, delivery.NewAgentExecutionGate(), nil, nil, "")
}

// Connector composition borrows one core owner and scheduler. It only owns its
// authenticated transport and partitioned delivery, Session and policy state.
func runConnector(ctx context.Context, loaded config.Config, credential pairing.Credential, bridgeVersion string,
	observer operations.Observer, handleProvision connection.ProvisionHandler, identities map[string]string,
	gate delivery.ExecutionGate, proof func(context.Context) error, processes bridgeruntime.GovernedProcessTracker, authorityID string) error {
	if node := nativeNodeFromContext(ctx); node != nil {
		connectorProof := proof
		proof = func(ctx context.Context) error {
			if err := node.check(); err != nil {
				return err
			}
			if connectorProof != nil {
				return connectorProof(ctx)
			}
			return nil
		}
	}
	beforeStart := func(ctx context.Context) error {
		if proof != nil {
			if err := proof(ctx); err != nil {
				return err
			}
		}
		if node := nativeNodeFromContext(ctx); node != nil {
			if desktop, err := node.DesktopHandoff(); err == nil {
				return desktop.WorkReady()
			}
		}
		return nil
	}
	loaded = loaded.WithDeviceExecutionTrust(credential.ServerURL, credential.DeviceID, credential.OwnerMemberID)
	inbox, err := delivery.Open(filepath.Join(loaded.DataDir, "inbox"))
	if err != nil {
		return err
	}
	adapters := make(map[string]bridgeruntime.Adapter, len(loaded.Agents))
	agentNames := make(map[string]string, len(loaded.Agents))
	resumeAgentNames := make(map[string]bool, len(loaded.Agents))
	streamingAgentNames := make(map[string]bool, len(loaded.Agents))
	roomContextCoverageAgentNames := make(map[string]bool, len(loaded.Agents))
	artifactMaterializationAgentNames := make(map[string]bool, len(loaded.Agents))
	sessions := bridgeruntime.NewFileRuntimeSessionStore(loaded.DataDir)
	for _, configured := range loaded.Agents {
		agentID := identities[configured.Name]
		agentNames[agentID] = configured.Name
		if configured.RuntimeKind == "pi" {
			adapters[agentID] = bridgeruntime.PiAdapter{
				Config: configured, Sessions: sessions,
			}
		} else {
			switch configured.Adapter {
			case "generic":
				adapters[agentID] = bridgeruntime.GenericAdapter{Config: configured}
			case "codex":
				adapter := bridgeruntime.CodexAdapter{
					Config: configured, Sessions: sessions, Approve: connection.AwaitCentralApproval(loaded, credential),
				}
				if node := nativeNodeFromContext(ctx); node != nil && node.checkConfiguration(loaded) == nil {
					if desktop, err := node.DesktopHandoff(); err == nil {
						adapter.Desktop = desktop
					}
				}
				adapters[agentID] = adapter
			}
		}
		if adapters[agentID] != nil {
			if processes != nil {
				adapters[agentID] = bridgeruntime.AuthorityProcessAdapter{Adapter: adapters[agentID], Tracker: processes, AuthorityNodeID: authorityID}
			}
			if configured.OwnerPrivateOutput {
				adapters[agentID] = bridgeruntime.PrivateOutputAdapter{Inner: adapters[agentID], DataDir: loaded.DataDir}
			}
			resumeAgentNames[configured.Name] = adapters[agentID].Capabilities().SupportsResume
			streamingAgentNames[configured.Name] = adapters[agentID].Capabilities().SupportsStreaming
			roomContextCoverageAgentNames[configured.Name] =
				adapters[agentID].Capabilities().SupportsRoomContextCoverage
			artifactMaterializationAgentNames[configured.Name] = true
		}
	}
	materializer := bridgeartifact.NewMaterializer(loaded, credential, identities)
	runtimeObserver := observer
	runtimeObserver.OnRuntime = func(event operations.RuntimeEvent) {
		event.AgentName = agentNames[event.AgentID]
		observer.Runtime(event)
	}
	executor := &delivery.RuntimeExecutor{
		Inbox: inbox, Adapters: adapters, Observer: runtimeObserver,
		ShareReasoningSummaries: loaded.ShareReasoningSummaries,
		Prepare:                 materializer.Materialize,
		ResolveArtifacts:        materializer.RuntimeArtifacts,
		IsPrepareRetryable:      bridgeartifact.IsRetryableMaterialization,
	}
	runHandler := delivery.Handler{
		Inbox: inbox, Gate: gate, BeforeStart: beforeStart,
		OnNew: executor.Execute, OnDuplicate: executor.Replay,
		OnQueuedCanceled:   executor.CancelQueued,
		Prepare:            materializer.Materialize,
		OnPrepareFailed:    executor.FailMaterialization,
		IsPrepareRetryable: bridgeartifact.IsRetryableMaterialization,
		IsExplicitCancel: func(ctx context.Context) bool {
			return errors.Is(context.Cause(ctx), connection.ErrRunCancelRequested)
		},
	}
	gitExecutable := ""
	if candidate, lookupErr := exec.LookPath("git"); lookupErr == nil {
		if absolute, absoluteErr := filepath.Abs(candidate); absoluteErr == nil {
			gitExecutable = absolute
		}
	}
	governedResources, err := admission.OpenGovernedAdmissionResources(ctx, loaded, credential,
		gitExecutable, configuredAgentsByID(loaded.Agents, identities))
	if err != nil {
		return err
	}
	defer governedResources.Close()
	governedRecovery := &delivery.GovernedRecovery{Inbox: inbox, Fence: governedResources.RecoveryFence(),
		Processes: governedResources.ProcessFencer(), Executor: executor}
	readiness := &governedAgentReadiness{}
	if coordinator := governedResources.Coordinator(); coordinator != nil {
		capture := governedResources.CaptureCoordinator()
		if capture == nil {
			return admission.ErrAdmissionInvalid
		}
		runner, runnerErr := admission.NewGovernedRuntimeRunner(coordinator,
			configuredAgentsByID(loaded.Agents, identities), governedResources.ProcessTracker(), capture)
		if runnerErr != nil {
			return runnerErr
		}
		if verifier := governedResources.VerificationCoordinator(); verifier != nil {
			if runnerErr := runner.UseVerification(verifier); runnerErr != nil {
				return runnerErr
			}
		}
		runHandler.Governed = &delivery.GovernedHandler{Inbox: inbox, Gate: runHandler.Gate, BeforeStart: beforeStart,
			Admission: coordinator, Runner: runner, Executor: executor, AllowsAgent: readiness.allows,
			IsExplicitCancel: runHandler.IsExplicitCancel}
	}
	observeReadiness := func(ctx context.Context) (connection.PreparedRuns, error) {
		readyGrants, err := governedResources.ReadyAgentGrants(ctx, time.Now().UTC())
		if err != nil {
			return connection.PreparedRuns{}, err
		}
		readyIDs := make(map[string]bool, len(readyGrants))
		readyNames := make(map[string][]execution.ExecutionGrantSummary, len(readyGrants))
		for agentID, grants := range readyGrants {
			readyIDs[agentID] = true
			if name := agentNames[agentID]; name != "" {
				readyNames[name] = append([]execution.ExecutionGrantSummary{}, grants...)
			}
		}
		readiness.replace(readyIDs)
		offers, err := governedResources.ReadyWorkPolicies(ctx, time.Now().UTC())
		if err != nil {
			return connection.PreparedRuns{}, err
		}
		readyOffers := make(map[string][]execution.WorkPolicyOffer, len(offers))
		for agentID, policies := range offers {
			if name := agentNames[agentID]; name != "" {
				readyOffers[name] = policies
			}
		}
		return connection.PreparedRuns{GovernedExecutionGrants: readyNames, WorkPolicyOffers: readyOffers}, nil
	}
	return (connection.Client{
		Config: loaded, Credential: credential, BridgeVersion: bridgeVersion, Observer: observer,
		AgentIdentities: identities, BeforeConnect: proof,
		HandleWorkAuthorization: func(ctx context.Context, request execution.WorkAuthorization) (execution.WorkAuthorizationReceipt, connection.PreparedRuns, error) {
			receipt, err := governedResources.AuthorizeWork(ctx, request, time.Now().UTC())
			if err != nil {
				return receipt, connection.PreparedRuns{}, err
			}
			prepared, err := observeReadiness(ctx)
			return receipt, prepared, err
		},
		HandleProvision:  handleProvision,
		ResumeAgentNames: resumeAgentNames, StreamingAgentNames: streamingAgentNames,
		RoomContextCoverageAgentNames:     roomContextCoverageAgentNames,
		ArtifactMaterializationAgentNames: artifactMaterializationAgentNames,
		PrepareRuns: func(ctx context.Context) (connection.PreparedRuns, error) {
			readiness.replace(nil)
			messages := []any{}
			if err := governedRecovery.RecoverAll(ctx, func(_ context.Context, value any) error {
				messages = append(messages, value)
				return nil
			}); err != nil {
				return connection.PreparedRuns{}, err
			}
			prepared, err := observeReadiness(ctx)
			if err != nil {
				return connection.PreparedRuns{}, err
			}
			prepared.ReplayMessages = messages
			return prepared, nil
		},
		ReplayCanceledRun: func(
			ctx context.Context,
			message contracts.RunCancelRequestedMessage,
			send func(context.Context, any) error,
		) error {
			return executor.ReplayCanceledRun(ctx, message, delivery.Sender(send))
		},
		FenceCanceledRun: func(message contracts.RunCancelRequestedMessage) error {
			return executor.StageCancellation(message)
		},
		HandleRun: func(ctx context.Context, message contracts.RunRequestedMessage, send func(context.Context, any) error) error {
			return runHandler.Handle(ctx, message, delivery.Sender(send))
		},
	}).Run(ctx)
}

func configuredAgentsByID(agents []config.AgentConfig, identities map[string]string) map[string]config.AgentConfig {
	configured := make(map[string]config.AgentConfig, len(agents))
	for _, agent := range agents {
		if agentID := identities[agent.Name]; agentID != "" {
			configured[agentID] = agent
		}
	}
	return configured
}
