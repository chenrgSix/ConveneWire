package connection

import (
	"convenewire.dev/bridge/internal/config"
	bridgeruntime "convenewire.dev/bridge/internal/runtime"
	"convenewire.dev/bridge/internal/workspace"
	contracts "convenewire.dev/contracts/generated/go"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

func (c Client) agentPublication(configured config.AgentConfig, agentID string, preparedRuns PreparedRuns) (contracts.AgentPublishMessage, error) {
	runtimeScopeID, err := bridgeruntime.AgentRuntimeScopeID(configured)
	if err != nil {
		return contracts.AgentPublishMessage{}, fmt.Errorf("resolve Agent Runtime scope: %w", err)
	}
	workspaceSnapshot, err := workspace.Inspect(configured.Workspace)
	if err != nil {
		return contracts.AgentPublishMessage{}, fmt.Errorf("resolve Agent Workspace snapshot: %w", err)
	}
	capabilities := contracts.Capabilities{
		InvocationMode:    contracts.Managed,
		SupportsHandoff:   false,
		SupportsInterrupt: true,
		SupportsResume:    c.ResumeAgentNames[configured.Name],
		SupportsStart:     true,
		SupportsStreaming: c.StreamingAgentNames[configured.Name],
	}
	if grants := preparedRuns.GovernedExecutionGrants[configured.Name]; len(grants) != 0 {
		if configured.OwnerPrivateOutput {
			return contracts.AgentPublishMessage{}, errors.New("private output does not support governed execution")
		}
		for _, grant := range grants {
			if grant.AgentID != agentID {
				return contracts.AgentPublishMessage{}, errors.New("Bridge Run preparation returned a governed grant for another Agent")
			}
		}
		capability, err := governedAgentCapability(grants)
		if err != nil {
			return contracts.AgentPublishMessage{}, err
		}
		capabilities.GovernedExecution = &capability
	}
	if offers := preparedRuns.WorkPolicyOffers[configured.Name]; len(offers) != 0 {
		if configured.OwnerPrivateOutput {
			return contracts.AgentPublishMessage{}, errors.New("private output cannot advertise work policies")
		}
		for _, offer := range offers {
			if offer.Spec.AgentID != agentID {
				return contracts.AgentPublishMessage{}, errors.New("work policy belongs to another Agent")
			}
		}
		raw, err := json.Marshal(offers)
		if err != nil || json.Unmarshal(raw, &capabilities.WorkPolicyOffers) != nil {
			return contracts.AgentPublishMessage{}, errors.New("invalid work policy publication")
		}
	}
	supportsRoomContextCoverage :=
		c.RoomContextCoverageAgentNames[configured.Name]
	capabilities.SupportsRoomContextCoverage = &supportsRoomContextCoverage
	supportsWorkspaceLeases := true
	capabilities.SupportsWorkspaceLeases = &supportsWorkspaceLeases
	supportsArtifactPublication := !configured.OwnerPrivateOutput
	capabilities.SupportsArtifactPublication = &supportsArtifactPublication
	supportsArtifactMaterialization :=
		c.ArtifactMaterializationAgentNames[configured.Name]
	capabilities.SupportsArtifactMaterialization = &supportsArtifactMaterialization
	supportsDiscussionSupplementalEvidence := !configured.OwnerPrivateOutput
	if configured.OwnerPrivateOutput {
		privateOutput := true
		capabilities.OwnerPrivateOutput = &privateOutput
	}
	capabilities.SupportsDiscussionSupplementalEvidence =
		&supportsDiscussionSupplementalEvidence
	runtimePolicy := publishedRuntimePolicy(configured)
	workspaceAlias := configured.ResolvedWorkspaceAlias()
	publication := contracts.AgentPublishMessage{
		ProtocolVersion: "1.0",
		MessageID:       newID("msg"),
		Timestamp:       time.Now().UTC(),
		Type:            contracts.AgentPublish,
		Payload: contracts.AgentPublishPayload{
			AgentID:             agentID,
			Capabilities:        capabilities,
			DeviceID:            c.Credential.DeviceID,
			Name:                configured.Name,
			OwnerMemberID:       c.Credential.OwnerMemberID,
			Role:                configured.Role,
			RuntimePolicy:       &runtimePolicy,
			ConfiguredModel:     configured.ConfiguredModel(),
			RuntimeScopeID:      &runtimeScopeID,
			WorkspaceAlias:      &workspaceAlias,
			WorkspaceRef:        &workspaceSnapshot.WorkspaceRef,
			WorkspaceGeneration: &workspaceSnapshot.Generation,
			TeamID:              c.Credential.TeamID,
		},
	}
	return publication, nil
}
