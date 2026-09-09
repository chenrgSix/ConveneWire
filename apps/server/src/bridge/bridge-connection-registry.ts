import {
  assertExecutionCommand,
  canonicalExecutionJSON,
  executionOperationDigest
} from "@convene-wire/contracts/execution-validation";
import type {
  GovernedExecutionCapability,
  GovernedExecutionCapabilityReadyGrant,
  GovernedExecutionManifest,
  WorkAuthorization,
  WorkPolicyOffer
} from "@convene-wire/contracts/execution-plan";

export interface BridgeSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface Connection {
  deviceTrustAgents: Map<string, number>;
  centralApprovalAgents: Map<string, number>;
  deviceId: string;
  epoch: number;
  governedExecutionAgents: Map<string, GovernedExecutionCapability>;
  privateOutputAgents: Set<string>;
  workPolicyAgents: Map<string, WorkPolicyOffer[]>;
  supportsAgentProvisioning: boolean;
  governedExecution?: GovernedExecutionCapability;
  socket: BridgeSocket;
}

export class BridgeConnectionRegistry {
  private readonly connections = new Map<string, Connection>();

  public constructor(private readonly now: () => Date = () => new Date()) {}

  public register(
    deviceId: string,
    epoch: number,
    socket: BridgeSocket,
    capabilities: { supportsAgentProvisioning?: boolean; governedExecution?: unknown } = {}
  ): boolean {
    const existing = this.connections.get(deviceId);
    if (existing && existing.epoch >= epoch) {
      return false;
    }
    if (capabilities.governedExecution !== undefined) {
      assertExecutionCommand("executionCapability", capabilities.governedExecution);
      if ((capabilities.governedExecution as GovernedExecutionCapability).readyGrants !== undefined) {
        throw new Error("Device execution capability cannot publish Agent grants");
      }
    }
    if (existing) {
      existing.socket.close(4_001, "Superseded by a newer connection epoch");
    }
    this.connections.set(deviceId, {
      deviceId,
      epoch,
      supportsAgentProvisioning: capabilities.supportsAgentProvisioning === true,
      ...(capabilities.governedExecution !== undefined ? {
        governedExecution: structuredClone(capabilities.governedExecution) as GovernedExecutionCapability
      } : {}),
      governedExecutionAgents: new Map(),
      privateOutputAgents: new Set(),
      workPolicyAgents: new Map(),
      deviceTrustAgents: new Map(),
      centralApprovalAgents: new Map(),
      socket
    });
    return true;
  }

  public remove(deviceId: string, socket: BridgeSocket): void {
    if (this.connections.get(deviceId)?.socket === socket) {
      this.connections.delete(deviceId);
    }
  }

  public send(deviceId: string, message: unknown): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection) {
      return false;
    }
    const envelope = message as { type?: string; payload?: { targetAgentId?: string; ownerPrivateOutput?: boolean; centralApproval?: {revision: number}; deviceTrust?: {mode: string; revision: number} } };
    if (envelope?.type === "run.requested" && envelope.payload?.centralApproval &&
      connection.centralApprovalAgents.get(envelope.payload.targetAgentId ?? "") !== envelope.payload.centralApproval.revision) return false;
    if (envelope?.type === "run.requested" && envelope.payload?.deviceTrust &&
      (envelope.payload.deviceTrust.mode !== "full" || connection.deviceTrustAgents.get(envelope.payload.targetAgentId ?? "") !== envelope.payload.deviceTrust.revision)) return false;
    if (envelope?.type === "run.requested" && envelope.payload?.ownerPrivateOutput === true &&
      !connection.privateOutputAgents.has(envelope.payload.targetAgentId ?? "")) return false;
    if (hasGovernedExecution(message)) {
      const agentId = governedExecutionAgentId(message);
      const manifest = governedExecutionManifest(message);
      if (
        !agentId ||
        !manifest ||
        !this.supportsGovernedAgentExecution(deviceId, agentId) ||
        !this.hasExactCurrentGrant(deviceId, agentId, manifest)
      ) {
        return false;
      }
    }
    connection.socket.send(JSON.stringify(message));
    return true;
  }

  public recordDeviceTrust(deviceId: string, epoch: number, agentId: string, revision?: number): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection || connection.epoch !== epoch) return false;
    if (revision === undefined) connection.deviceTrustAgents.delete(agentId);
    else if (Number.isSafeInteger(revision) && revision > 0) connection.deviceTrustAgents.set(agentId, revision);
    else return false;
    return true;
  }

  public recordCentralApproval(deviceId: string, epoch: number, agentId: string, revision?: number): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection || connection.epoch !== epoch) return false;
    if (revision === undefined) connection.centralApprovalAgents.delete(agentId);
    else if (Number.isSafeInteger(revision) && revision > 0) connection.centralApprovalAgents.set(agentId, revision);
    else return false;
    return true;
  }

  public centralApprovalRevision(deviceId: string, agentId: string): number | undefined {
    return this.connections.get(deviceId)?.centralApprovalAgents.get(agentId);
  }

  public activeEpoch(deviceId: string): number | undefined {
    return this.connections.get(deviceId)?.epoch;
  }

  public recordWorkPolicyOffers(deviceId: string, epoch: number, agentId: string, value: unknown): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection || connection.epoch !== epoch) return false;
    if (value === undefined) { connection.workPolicyAgents.delete(agentId); return true; }
    if (!Array.isArray(value) || value.length > 64 ||
      connection.privateOutputAgents.has(agentId) || !this.supportsGovernedExecution(deviceId)) return false;
    const seen = new Set<string>();
    for (const offer of value) {
      assertExecutionCommand("workPolicyOffer", offer);
      if (offer.spec.agentId !== agentId || seen.has(offer.spec.policyId)) return false;
      seen.add(offer.spec.policyId);
    }
    connection.workPolicyAgents.set(agentId, structuredClone(value) as WorkPolicyOffer[]);
    return true;
  }

  public workPolicyOffers(deviceId: string, agentId: string): WorkPolicyOffer[] {
    return structuredClone(this.connections.get(deviceId)?.workPolicyAgents.get(agentId) ?? []);
  }

  public requestWorkAuthorization(request: WorkAuthorization): boolean {
    assertExecutionCommand("workAuthorization", request);
    const connection = this.connections.get(request.deviceId);
    if (!connection || !this.workPolicyOffers(request.deviceId, request.spec.agentId).some((offer) =>
      offer.spec.policyId === request.parent.policyId && offer.digest === request.parent.policyDigest)) return false;
    connection.socket.send(JSON.stringify({
      protocolVersion: "1.0", type: "work.authorization.requested",
      messageId: `msg_${executionOperationDigest({ authorization: request.parent.authorizationId, epoch: connection.epoch })}`,
      timestamp: this.now().toISOString(),
      payload: { connectionEpoch: connection.epoch, workAuthorization: request }
    }));
    return true;
  }

  public recordPrivateOutputAgent(deviceId: string, epoch: number, agentId: string, enabled: boolean): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection || connection.epoch !== epoch) return false;
    if (enabled) connection.privateOutputAgents.add(agentId);
    else connection.privateOutputAgents.delete(agentId);
    return true;
  }

  public supportsAgentProvisioning(deviceId: string): boolean {
    return this.connections.get(deviceId)?.supportsAgentProvisioning === true;
  }

  public supportsGovernedExecution(deviceId: string): boolean {
    const capability = this.connections.get(deviceId)?.governedExecution;
    return capability?.operations.includes("prepare") === true &&
      capability.operations.includes("capture");
  }

  public governedExecutionCapability(deviceId: string): GovernedExecutionCapability | undefined {
    const capability = this.connections.get(deviceId)?.governedExecution;
    return capability && structuredClone(capability);
  }

  public supportsGovernedAgentCapability(
    deviceId: string,
    agentId: string,
    agentCapability: GovernedExecutionCapability
  ): boolean {
    const deviceCapability = this.connections.get(deviceId)?.governedExecution;
    return deviceCapability !== undefined &&
      deviceCapability.version === agentCapability.version &&
      deviceCapability.workspaceBoundary === agentCapability.workspaceBoundary &&
      (!agentCapability.preventivePathEnforcement ||
        deviceCapability.preventivePathEnforcement) &&
      agentCapability.operations.every((operation) =>
        deviceCapability.operations.includes(operation)
      ) && readyGrantsBelongToAgent(
        deviceId,
        agentId,
        agentCapability
      );
  }

  public recordGovernedAgentCapability(
    deviceId: string,
    epoch: number,
    agentId: string,
    agentCapability: GovernedExecutionCapability | undefined
  ): boolean {
    const connection = this.connections.get(deviceId);
    if (!connection || connection.epoch !== epoch) {
      return false;
    }
    if (agentCapability === undefined) {
      connection.governedExecutionAgents.delete(agentId);
      return true;
    }
    if (!this.supportsGovernedAgentCapability(deviceId, agentId, agentCapability)) {
      return false;
    }
    connection.governedExecutionAgents.set(
      agentId,
      structuredClone(agentCapability)
    );
    return true;
  }

  public governedAgentExecutionCapability(
    deviceId: string,
    agentId: string
  ): GovernedExecutionCapability | undefined {
    const capability = this.connections
      .get(deviceId)
      ?.governedExecutionAgents.get(agentId);
    return capability && structuredClone(capability);
  }

  public governedAgentReadyGrants(
    deviceId: string,
    agentId: string
  ): GovernedExecutionCapabilityReadyGrant[] {
    const grants = this.connections
      .get(deviceId)
      ?.governedExecutionAgents.get(agentId)
      ?.readyGrants;
    return grants ? structuredClone(grants) : [];
  }

  public supportsGovernedAgentExecution(
    deviceId: string,
    agentId: string
  ): boolean {
    const capability = this.connections
      .get(deviceId)
      ?.governedExecutionAgents.get(agentId);
    return this.supportsGovernedExecution(deviceId) &&
      capability?.operations.includes("prepare") === true &&
      capability.operations.includes("capture");
  }

  public activeCount(): number {
    return this.connections.size;
  }

  public revoke(deviceId: string): void {
    const connection = this.connections.get(deviceId);
    if (!connection) return;
    this.connections.delete(deviceId);
    connection.socket.close(4_004, "Device revoked");
  }

  private hasExactCurrentGrant(
    deviceId: string,
    agentId: string,
    manifest: GovernedExecutionManifest
  ): boolean {
    try {
      assertExecutionCommand("executionManifest", manifest);
    } catch {
      return false;
    }
    const { manifestDigest, ...unsigned } = manifest;
    if (
      executionOperationDigest(unsigned) !== manifestDigest ||
      manifest.scope.deviceId !== deviceId ||
      manifest.scope.agentId !== agentId
    ) {
      return false;
    }
    const nowMs = this.now().getTime();
    if (!Number.isFinite(nowMs)) return false;
    const exact = this.governedAgentReadyGrants(deviceId, agentId).filter(
      (grant) => exactGrantMatchesManifest(grant, manifest, nowMs)
    );
    return exact.length === 1;
  }
}

function readyGrantsBelongToAgent(
  deviceId: string,
  agentId: string,
  capability: GovernedExecutionCapability
): boolean {
  const seen = new Set<string>();
  for (const grant of capability.readyGrants ?? []) {
    const runtimeReady = grant.operations.includes("prepare") &&
      grant.operations.includes("capture") &&
      grant.integrationTargets.length === 0;
    const integrationReady = grant.operations.length === 1 &&
      grant.operations[0] === "integrate" &&
      grant.integrationTargets.length > 0;
    if (
      grant.deviceId !== deviceId ||
      grant.agentId !== agentId ||
      grant.revokedAt !== null ||
      seen.has(grant.grant.grantId) ||
      (!runtimeReady && !integrationReady) ||
      !grant.operations.every((operation) =>
        capability.operations.includes(operation)
      )
    ) {
      return false;
    }
    seen.add(grant.grant.grantId);
  }
  return true;
}

function hasGovernedExecution(message: unknown): boolean {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== "run.requested" ||
    !("payload" in message) || !message.payload || typeof message.payload !== "object") return false;
  const payload = message.payload;
  if (!("contextManifest" in payload) || !payload.contextManifest || typeof payload.contextManifest !== "object") return false;
  return Object.hasOwn(payload.contextManifest, "execution");
}

function governedExecutionAgentId(message: unknown): string | undefined {
  if (!message || typeof message !== "object" || !("payload" in message) ||
    !message.payload || typeof message.payload !== "object" ||
    !("targetAgentId" in message.payload) ||
    typeof message.payload.targetAgentId !== "string") {
    return undefined;
  }
  return message.payload.targetAgentId;
}

function governedExecutionManifest(
  message: unknown
): GovernedExecutionManifest | undefined {
  if (
    !message || typeof message !== "object" || !("payload" in message) ||
    !message.payload || typeof message.payload !== "object" ||
    !("contextManifest" in message.payload) ||
    !message.payload.contextManifest ||
    typeof message.payload.contextManifest !== "object" ||
    !("execution" in message.payload.contextManifest) ||
    !message.payload.contextManifest.execution ||
    typeof message.payload.contextManifest.execution !== "object"
  ) {
    return undefined;
  }
  return message.payload.contextManifest.execution as GovernedExecutionManifest;
}

function exactGrantMatchesManifest(
  grant: GovernedExecutionCapabilityReadyGrant,
  manifest: GovernedExecutionManifest,
  nowMs: number
): boolean {
  const issuedAt = Date.parse(grant.issuedAt);
  const expiresAt = Date.parse(grant.grant.expiresAt);
  const verifierPins = manifest.verificationProfiles.map((profile) => ({
    profileId: profile.profileId,
    revision: profile.revision,
    digest: profile.digest
  }));
  const expectedOperations = manifest.verificationProfiles.some(
    (profile) => profile.required
  )
    ? ["prepare", "capture", "verify"] as const
    : ["prepare", "capture"] as const;
  return grant.deviceId === manifest.scope.deviceId &&
    grant.agentId === manifest.scope.agentId &&
    grant.planId === manifest.scope.planId &&
    grant.nodeKey === manifest.scope.nodeKey &&
    grant.repositoryId === manifest.repository.repositoryId &&
    grant.bindingId === manifest.repository.bindingId &&
    grant.grant.grantId === manifest.grant.grantId &&
    grant.grant.revision === manifest.grant.revision &&
    grant.grant.digest === manifest.grant.digest &&
    grant.grant.expiresAt === manifest.grant.expiresAt &&
    grant.runtimeProfile.profileId === manifest.repository.runtimeProfileId &&
    grant.runtimeProfile.revision === 1 &&
    grant.runtimeProfile.digest === manifest.repository.runtimeProfileDigest &&
    grant.revokedAt === null &&
    grant.operations.length === expectedOperations.length &&
    expectedOperations.every((operation) =>
      grant.operations.includes(operation)
    ) &&
    grant.integrationTargets.length === 0 &&
    canonicalExecutionJSON(grant.scopePolicy) ===
      canonicalExecutionJSON(manifest.scopePolicy) &&
    canonicalExecutionJSON(grant.verificationProfiles) ===
      canonicalExecutionJSON(verifierPins) &&
    Number.isFinite(issuedAt) && Number.isFinite(expiresAt) &&
    issuedAt <= nowMs && nowMs < expiresAt &&
    Date.parse(manifest.deadline) <= expiresAt;
}
