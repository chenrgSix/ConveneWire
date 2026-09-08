import type Database from "better-sqlite3";
import type { ExecutionPlanDefinition, WorkAuthorization, WorkAuthorizationReceipt, WorkPolicyOffer } from "@convene-wire/contracts/execution-plan";
import { assertExecutionCommand, canonicalExecutionJSON, executionOperationDigest, workTaskGrantId } from "@convene-wire/contracts/execution-validation";
import type { BridgeConnectionRegistry } from "../bridge/bridge-connection-registry.js";
import type { CoreRepository } from "../data/core-repository.js";
import type { SqliteTransactionBoundary } from "../data/sqlite-transaction-boundary.js";
import type { AuthService, DevicePrincipal, WebPrincipal } from "../security/auth-service.js";
import { AuthorizationError } from "../security/auth-service.js";
import type { AgentTaskService } from "../task/agent-task-service.js";
import type { AgentTaskRepository } from "../task/task-repository.js";
import type { MessageService } from "../team-room/message-service.js";
import { ExecutionError } from "./execution-error.js";
import { conversationSourceValid } from "./conversation-work-service.js";
import type { ExecutionPlanRepository } from "./execution-plan-repository.js";
import type { ExecutionPlanService } from "./execution-plan-service.js";

interface DevelopmentCommand {
  operationId: string;
  agentId: string;
  policyId: string;
  policyDigest: string;
  baseCommit: string;
  title: string;
  goal: string;
  criteria: string[];
}

interface WorkRow {
  operation_id: string; team_id: string; room_id: string; initiator_member_id: string;
  device_id: string; agent_id: string; root_task_id: string; task_id: string;
  plan_id: string; plan_revision: number; command_digest: string; request_digest: string;
  request_json: string; receipt_json: string | null;
  state: "pending" | "authorized" | "denied" | "expired" | "canceled";
  reason: string; created_at: string; updated_at: string;
}

function command(value: unknown): DevelopmentCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ExecutionError("DEVELOPMENT_COMMAND_INVALID");
  const input = value as Record<string, unknown>;
  const keys = ["operationId", "agentId", "policyId", "policyDigest", "baseCommit", "title", "goal", "criteria"];
  if (Object.keys(input).length !== keys.length || keys.some((key) => !Object.hasOwn(input, key)) ||
    keys.filter((key) => key !== "criteria").some((key) => typeof input[key] !== "string") ||
    !/^op_[A-Za-z0-9_-]{8,128}$/u.test(String(input.operationId)) ||
    !/^agent_[A-Za-z0-9_-]{8,128}$/u.test(String(input.agentId)) ||
    !/^workpolicy_[A-Za-z0-9_-]{8,128}$/u.test(String(input.policyId)) ||
    !/^[a-f0-9]{64}$/u.test(String(input.policyDigest)) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(String(input.baseCommit)) ||
    typeof input.title !== "string" || !input.title.trim() || input.title.length > 160 ||
    typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 20_000 ||
    !Array.isArray(input.criteria) || input.criteria.length < 1 || input.criteria.length > 8 ||
    input.criteria.some((text) => typeof text !== "string" || !text.trim() || text.length > 2_000)) {
    throw new ExecutionError("DEVELOPMENT_COMMAND_INVALID");
  }
  // Schema/command digests must bind the exact user intent, not coerced objects.
  canonicalExecutionJSON(value);
  return { ...(input as unknown as DevelopmentCommand), title: input.title.trim(), goal: input.goal.trim(),
    criteria: input.criteria.map((text: string) => text.trim()) };
}

/** Explicit Room development intent reuses the existing Task/plan/Run authority. */
export class DevelopmentWorkService {
  private readonly sent = new Map<string, { epoch: number; at: number }>();

  public constructor(
    private readonly database: Database.Database,
    private readonly transactions: SqliteTransactionBoundary,
    private readonly auth: AuthService,
    private readonly core: CoreRepository,
    private readonly tasks: AgentTaskService,
    private readonly taskRepository: AgentTaskRepository,
    private readonly plans: ExecutionPlanService,
    private readonly planRepository: ExecutionPlanRepository,
    private readonly messages: MessageService,
    private readonly connections: BridgeConnectionRegistry,
    private readonly changed: (roomId: string) => void
  ) {}

  public options(principal: WebPrincipal, roomId: string, now: string) {
    const member = this.auth.requireRoomMember(principal, roomId);
    return this.core.listAgents(member.teamId).filter((agent) => agent.enabled &&
      this.core.isRoomAgent(roomId, agent.agentId)).map((agent) => {
      const offers = this.matchingOffers(agent.deviceId, agent.agentId, roomId, member.memberId, now);
      const available = agent.integrationMode === "managed" && agent.deviceId &&
        agent.capabilities.ownerPrivateOutput !== true && offers.length === 1;
      const offer = available ? offers[0]! : undefined;
      return {
        agentId: agent.agentId, agentName: agent.name, deviceId: agent.deviceId,
        state: offer ? "available" as const : "unavailable" as const,
        blocker: offer ? null : !agent.deviceId || !this.connections.activeEpoch(agent.deviceId)
          ? "device_offline" : offers.length > 1 ? "ambiguous_policy" : "policy_unavailable",
        policy: offer ? {
          policyId: offer.spec.policyId, digest: offer.digest, alias: offer.spec.alias,
          repositoryId: offer.spec.repositoryId, sourceRef: offer.spec.sourceRef, baseCommit: offer.baseCommit,
          scope: offer.spec.scopePolicy, verificationProfiles: offer.spec.verificationProfiles,
          maxRunAttempts: offer.spec.maxRunAttempts, maxTaskDurationSeconds: offer.spec.maxTaskDurationSeconds,
          expiresAt: offer.spec.expiresAt, observedAt: offer.observedAt
        } : null
      };
    });
  }

  public create(principal: WebPrincipal, roomId: string, value: unknown, now: string,
    continuation?: { maxRunAttempts: number; maxTaskDurationSeconds: number }) {
    const input = command(value);
    const member = this.auth.requireRoomMember(principal, roomId);
    const digest = executionOperationDigest({ roomId, memberId: member.memberId, command: input });
    const row = this.transactions.immediate(() => {
      const existing = this.row(input.operationId);
      if (existing) {
        if (existing.command_digest !== digest) throw new ExecutionError("DEVELOPMENT_OPERATION_CONFLICT", 409);
        return existing;
      }
      const agent = this.core.getAgent(input.agentId);
      if (!agent || !agent.deviceId || agent.teamId !== member.teamId || !agent.enabled ||
        agent.integrationMode !== "managed" || agent.capabilities.ownerPrivateOutput === true ||
        !this.core.isRoomAgent(roomId, agent.agentId)) throw new ExecutionError("DEVELOPMENT_AGENT_UNAVAILABLE", 409);
      const offers = this.matchingOffers(agent.deviceId, agent.agentId, roomId, member.memberId, now);
      if (offers.length !== 1) throw new ExecutionError(offers.length > 1 ? "DEVELOPMENT_POLICY_AMBIGUOUS" : "DEVELOPMENT_POLICY_UNAVAILABLE", 409);
      const offer = offers[0]!;
      if (offer.spec.policyId !== input.policyId || offer.digest !== input.policyDigest || offer.baseCommit !== input.baseCommit) {
        throw new ExecutionError("DEVELOPMENT_OFFER_CHANGED", 409);
      }
      this.expirePending(agent.deviceId, now);
      const pending = this.database.prepare("SELECT count(*) AS count FROM development_work_authorizations WHERE device_id = ? AND state = 'pending'")
        .get(agent.deviceId) as { count: number };
      if (pending.count >= 8) throw new ExecutionError("DEVELOPMENT_DEVICE_BUSY", 409);
      const seconds = Math.min(offer.spec.maxTaskDurationSeconds, continuation?.maxTaskDurationSeconds ?? Infinity,
        Math.floor((Date.parse(offer.spec.expiresAt) - Date.parse(now)) / 1_000));
      if (seconds < 60) throw new ExecutionError("DEVELOPMENT_POLICY_EXPIRING", 409);
      const parent = { authorizationId: input.operationId, policyId: offer.spec.policyId, policyDigest: offer.digest,
        revision: 1 as const, initiatorMemberId: member.memberId,
        maxRunAttempts: Math.min(offer.spec.maxRunAttempts, continuation?.maxRunAttempts ?? Infinity), maxConcurrency: 1 };
      const budget = { maxRunAttempts: parent.maxRunAttempts, maxExecutionDurationSeconds: seconds };
      const root = this.tasks.create(member, { roomId, title: input.title, goal: input.goal, budgetPolicy: budget }, now);
      const message = this.messages.createMemberMessage(member, { roomId, taskId: root.taskId, content: input.goal, now });
      const criteria = input.criteria.map((description, index) => ({ criterionKey: `criterion_development${index + 1}`, description, required: true, ordinal: index + 1 }));
      const definition: ExecutionPlanDefinition = {
        schemaVersion: "1.0", rootTaskId: root.taskId, title: input.title,
        decision: { summary: "Execute this development request under the selected owner work policy.",
          items: [{ itemKey: "local_policy", statement: "Bridge prepares an isolated workspace, runs the required profiles and captures patch and candidate commit evidence." }],
          unresolvedQuestions: [], sources: [{ evidenceRefId: "evidence_development01", kind: "message", messageId: message.messageId }],
          sourceRevisions: [{ evidenceRefId: "evidence_development01", revision: message.sequence }] },
        nodes: [{ nodeKey: "Develop", kind: "implementation", required: true,
          task: { mode: "new", title: input.title, goal: input.goal, ownerMemberId: member.memberId,
            criteria: [criteria[0]!, ...criteria.slice(1)] },
          agentId: agent.agentId,
          repository: { repositoryId: offer.spec.repositoryId, bindingId: offer.spec.bindingId, baseCommit: offer.baseCommit,
            grantId: workTaskGrantId(parent), grantRevision: 1, runtimeProfileId: offer.spec.runtimeProfile.profileId,
            runtimeProfileDigest: offer.spec.runtimeProfile.digest },
          scope: structuredClone(offer.spec.scopePolicy), budget,
          verificationProfiles: offer.spec.verificationProfiles.map((profile) => ({ ...profile, required: true })),
          inputs: [], outputs: [{ slotKey: "patch", kind: "patch", required: true }, { slotKey: "commit", kind: "commit", required: true }] }],
        edges: [], externalInputs: [], policy: { maxConcurrency: 1, budget, integration: "reviewed_candidate",
          requireHumanIntegrationApproval: true, integrationTargets: [] }
      };
      const plan = this.plans.create(member, root.taskId, { operationId: this.operation(input.operationId, "plan"),
        expectedRootTaskRevision: this.tasks.get(member, root.taskId).taskRevision, definition }, now);
      const approved = this.plans.review(member, plan.planId, { operationId: this.operation(input.operationId, "approval"),
        expectedRevision: plan.current.revision, expectedDigest: plan.current.digest,
        expectedRootTaskRevision: this.tasks.get(member, root.taskId).taskRevision, decision: "approved",
        reason: "The Task owner initiated development using the selected preauthorized work policy." }, now);
      const compiled = approved.plan.compiledTasks[0]!;
      this.tasks.updateControl(member, compiled.taskId, {
        operationId: this.operation(input.operationId, "ready"),
        expectedTaskRevision: this.tasks.get(member, compiled.taskId).taskRevision,
        lifecycleState: "ready"
      }, now);
      const request: WorkAuthorization = { version: 1, deviceId: agent.deviceId, parent,
        requestedAt: now, deadline: new Date(Date.parse(now) + 60_000).toISOString(),
        spec: { grantId: workTaskGrantId(parent), bindingId: offer.spec.bindingId, bindingRevision: offer.spec.bindingRevision,
          sourceFingerprint: offer.spec.sourceFingerprint, repositoryId: offer.spec.repositoryId, baseCommit: offer.baseCommit,
          planId: approved.plan.planId, planRevision: approved.plan.current.revision, planDigest: approved.plan.current.digest,
          nodeKey: "Develop", roomId, taskId: compiled.taskId, definitionRevision: compiled.definitionRevision,
          criteriaRevision: compiled.criteriaRevision, agentId: agent.agentId, expiresAt: new Date(Date.parse(now) + seconds * 1_000).toISOString(),
          operations: offer.spec.operations, runtimeProfile: offer.spec.runtimeProfile, verificationProfiles: offer.spec.verificationProfiles,
          scopePolicy: offer.spec.scopePolicy, integrationTargets: [] } };
      assertExecutionCommand("workAuthorization", request);
      this.database.prepare(`INSERT INTO development_work_authorizations
        (operation_id, team_id, room_id, initiator_member_id, device_id, agent_id, root_task_id, task_id, plan_id, plan_revision,
          command_digest, request_digest, request_json, state, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'awaiting_device', ?, ?)`)
        .run(input.operationId, member.teamId, roomId, member.memberId, agent.deviceId, agent.agentId, root.taskId, compiled.taskId,
          plan.planId, plan.current.revision, digest, executionOperationDigest(request), canonicalExecutionJSON(request), now, now);
      this.transactions.afterCommit(() => this.changed(roomId));
      return this.row(input.operationId)!;
    });
    this.transactions.afterCommit(() => this.resendForDevice(row.device_id, now));
    return this.view(this.row(row.operation_id)!);
  }

  public list(principal: WebPrincipal, roomId: string, now: string) {
    this.auth.requireRoomMember(principal, roomId);
    const rows = this.database.prepare("SELECT * FROM development_work_authorizations WHERE room_id = ? ORDER BY created_at DESC, operation_id DESC LIMIT 50")
      .all(roomId) as WorkRow[];
    for (const row of rows) if (row.state === "pending") this.expireRow(row, now);
    return rows.map((row) => this.view(this.row(row.operation_id)!));
  }

  public resendForDevice(deviceId: string, now: string): void {
    this.expirePending(deviceId, now);
    const epoch = this.connections.activeEpoch(deviceId);
    if (!epoch) return;
    const rows = this.database.prepare("SELECT * FROM development_work_authorizations WHERE device_id = ? AND state = 'pending' ORDER BY created_at, operation_id LIMIT 8")
      .all(deviceId) as WorkRow[];
    for (const row of rows) {
      const sent = this.sent.get(row.operation_id);
      if (sent?.epoch === epoch && Date.parse(now) - sent.at < 5_000) continue;
      if (this.connections.requestWorkAuthorization(this.request(row))) this.sent.set(row.operation_id, { epoch, at: Date.parse(now) });
    }
  }

  public sweep(now: string): void {
    const devices = this.database.prepare("SELECT DISTINCT device_id FROM development_work_authorizations WHERE state = 'pending'")
      .all() as Array<{ device_id: string }>;
    for (const device of devices) this.resendForDevice(device.device_id, now);
  }

  public receive(principal: DevicePrincipal, epoch: number, value: unknown, now: string): void {
    assertExecutionCommand("workAuthorizationReceipt", value);
    const receipt = value as WorkAuthorizationReceipt;
    this.transactions.immediate(() => {
      const row = this.row(receipt.authorizationId);
      if (!row || principal.deviceId !== row.device_id || principal.teamId !== row.team_id ||
        this.connections.activeEpoch(row.device_id) !== epoch || receipt.deviceId !== row.device_id || receipt.requestDigest !== row.request_digest) {
        throw new AuthorizationError("FORBIDDEN", "Work authorization receipt does not match this Device and connection");
      }
      const request = this.request(row);
      if (row.state !== "pending") {
        if (row.receipt_json) {
          const old = JSON.parse(row.receipt_json) as WorkAuthorizationReceipt;
          if (canonicalExecutionJSON({ ...old, observedAt: receipt.observedAt }) !== canonicalExecutionJSON(receipt)) {
            throw new ExecutionError("DEVELOPMENT_RECEIPT_CONFLICT", 409);
          }
        }
        return;
      }
      if (this.expireRow(row, now)) return;
      if (Date.parse(receipt.observedAt) < Date.parse(request.requestedAt) || Date.parse(receipt.observedAt) > Date.parse(now) + 30_000) {
        throw new ExecutionError("DEVELOPMENT_RECEIPT_TIME_INVALID", 409);
      }
      if (receipt.status === "authorized") {
        const grant = receipt.grant;
        const current = this.connections.governedAgentExecutionCapability(row.device_id, row.agent_id)?.readyGrants;
        if (!grant || grant.revokedAt !== null || grant.grant.revision !== 1 || grant.grant.grantId !== request.spec.grantId ||
          grant.grant.expiresAt !== request.spec.expiresAt || grant.deviceId !== row.device_id || grant.agentId !== row.agent_id ||
          grant.planId !== row.plan_id || grant.nodeKey !== request.spec.nodeKey || grant.bindingId !== request.spec.bindingId ||
          grant.repositoryId !== request.spec.repositoryId ||
          !["operations", "runtimeProfile", "verificationProfiles", "scopePolicy", "integrationTargets"].every((key) =>
            canonicalExecutionJSON(grant[key as keyof typeof grant]) === canonicalExecutionJSON(request.spec[key as keyof typeof request.spec])) ||
          !current?.some((ready) => canonicalExecutionJSON(ready) === canonicalExecutionJSON(grant))) {
          throw new ExecutionError("DEVELOPMENT_GRANT_NOT_CURRENT", 409);
        }
      }
      this.database.prepare("UPDATE development_work_authorizations SET state = ?, reason = ?, receipt_json = ?, updated_at = ? WHERE operation_id = ? AND state = 'pending'")
        .run(receipt.status, receipt.reason, canonicalExecutionJSON(receipt), now, row.operation_id);
      this.sent.delete(row.operation_id);
      this.transactions.afterCommit(() => this.changed(row.room_id));
    });
  }

  private matchingOffers(deviceId: string | null, agentId: string, roomId: string, memberId: string, now: string): WorkPolicyOffer[] {
    if (!deviceId) return [];
    return this.connections.workPolicyOffers(deviceId, agentId).filter((offer) =>
      offer.spec.agentId === agentId && offer.spec.roomIds.includes(roomId) && offer.spec.initiatorMemberIds.includes(memberId) &&
      Date.parse(offer.issuedAt) <= Date.parse(now) && Date.parse(now) < Date.parse(offer.spec.expiresAt));
  }

  private expirePending(deviceId: string, now: string) {
    const rows = this.database.prepare("SELECT * FROM development_work_authorizations WHERE device_id = ? AND state = 'pending'").all(deviceId) as WorkRow[];
    for (const row of rows) this.expireRow(row, now);
  }

  private expireRow(row: WorkRow, now: string): boolean {
    const request = this.request(row);
    const task = this.taskRepository.get(row.task_id);
    const root = this.taskRepository.get(row.root_task_id);
    const plan = this.planRepository.get(row.plan_id);
    const initiator = this.core.getMember(row.initiator_member_id);
    const room = this.core.getRoom(row.room_id);
    const canceled = !conversationSourceValid(this.database, row.operation_id) || !task || !root || !plan || !initiator || !room || Boolean(room.archivedAt) || !this.core.isRoomMember(row.room_id, row.initiator_member_id) ||
      task.ownerMemberId !== row.initiator_member_id || [task.lifecycleState, root.lifecycleState].some((state) => state === "canceled" || state === "completed") ||
      plan.current.revision !== request.spec.planRevision || plan.current.digest !== request.spec.planDigest ||
      plan.state === "canceled" || task.definitionRevision !== request.spec.definitionRevision || task.criteriaRevision !== request.spec.criteriaRevision;
    const expired = Date.parse(now) >= Date.parse(request.deadline);
    if (!canceled && !expired) return false;
    this.database.prepare("UPDATE development_work_authorizations SET state = ?, reason = ?, updated_at = ? WHERE operation_id = ? AND state = 'pending'")
      .run(canceled ? "canceled" : "expired", canceled ? "task_changed" : "authorization_timeout", now, row.operation_id);
    this.sent.delete(row.operation_id);
    this.transactions.afterCommit(() => this.changed(row.room_id));
    return true;
  }

  private request(row: WorkRow): WorkAuthorization {
    const request = JSON.parse(row.request_json) as WorkAuthorization;
    assertExecutionCommand("workAuthorization", request);
    if (executionOperationDigest(request) !== row.request_digest || request.parent.authorizationId !== row.operation_id ||
      request.parent.initiatorMemberId !== row.initiator_member_id || request.deviceId !== row.device_id ||
      request.spec.roomId !== row.room_id || request.spec.agentId !== row.agent_id ||
      request.spec.taskId !== row.task_id || request.spec.planId !== row.plan_id || request.spec.planRevision !== row.plan_revision) {
      throw new ExecutionError("DEVELOPMENT_HISTORY_INCONSISTENT");
    }
    return request;
  }

  private row(id: string) { return this.database.prepare("SELECT * FROM development_work_authorizations WHERE operation_id = ?").get(id) as WorkRow | undefined; }
  private operation(id: string, purpose: string) { return `op_${executionOperationDigest({ authorizationId: id, purpose })}`; }
  private view(row: WorkRow) {
    return { operationId: row.operation_id, title: this.taskRepository.get(row.root_task_id)?.title ?? row.task_id,
      rootTaskId: row.root_task_id, taskId: row.task_id, planId: row.plan_id,
      agentId: row.agent_id, deviceId: row.device_id, state: row.state, reason: row.reason, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
