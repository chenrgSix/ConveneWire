import type Database from "better-sqlite3";
import { SqliteTransactionBoundary } from "../data/sqlite-transaction-boundary.js";
import type { EvidenceDisclosureIntent, EvidenceDisclosureGrant, EvidenceDisclosurePublishCommand } from "@convene-wire/contracts/task-result";
import { assertDisclosure, disclosureContentDigest, disclosureIntentDigest } from "@convene-wire/contracts/disclosure-validation";
import type { CoreRepository } from "../data/core-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { AuthService, DevicePrincipal, WebPrincipal } from "../security/auth-service.js";
import { AuthorizationError } from "../security/auth-service.js";
import type { RunRepository } from "../run/run-repository.js";
import type { AgentTaskRepository } from "./task-repository.js";
import type { ResultService } from "./result-service.js";

type GrantRow = { grant_id: string; owner_member_id: string; team_id: string; intent_json: string;
  intent_sha256: string; revision: number; state: "active" | "revoked"; created_at: string; revoked_at: string | null; result_id: string | null };
const denied = () => new AuthorizationError("FORBIDDEN", "Evidence disclosure authority denied");

export class EvidenceDisclosureService {
  public constructor(private readonly database: Database.Database, private readonly auth: AuthService,
    private readonly core: CoreRepository, private readonly runs: RunRepository,
    private readonly tasks: AgentTaskRepository, private readonly results: ResultService) {}

  public approve(principal: WebPrincipal, intent: EvidenceDisclosureIntent, now: string): EvidenceDisclosureGrant {
    assertDisclosure("disclosureIntent", intent);
    this.auth.requireFullWebSession(principal);
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      const member = this.auth.requireRoomMember(principal, intent.roomId);
      const device = this.core.getDevice(intent.deviceId);
      if (!device || device.ownerMemberId !== member.memberId || device.teamId !== member.teamId || device.status !== "active") throw denied();
      this.requireScope(intent, member.memberId, member.teamId);
      const prior = this.database.prepare("SELECT * FROM evidence_disclosure_grants WHERE operation_id = ?").get(intent.operationId) as GrantRow | undefined;
      if (prior) {
        if (prior.owner_member_id !== member.memberId || prior.intent_sha256 !== disclosureIntentDigest(intent)) throw denied();
        return this.project(prior);
      }
      if (Date.parse(intent.expiresAt) <= Date.parse(now) || Date.parse(intent.expiresAt) > Date.parse(now) + 24 * 60 * 60 * 1000) throw denied();
      // A disclosure operation cannot hijack an already existing ordinary Result operation.
      if (this.database.prepare("SELECT 1 FROM task_results WHERE operation_id = ?").get(intent.operationId)) throw denied();
      const grantId = createOpaqueId("disclosure");
      this.database.prepare(`INSERT INTO evidence_disclosure_grants
        (grant_id, operation_id, owner_member_id, team_id, device_id, agent_id, run_id, task_id, room_id, intent_json, intent_sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(grantId, intent.operationId, member.memberId, member.teamId,
        intent.deviceId, intent.agentId, intent.runId, intent.taskId, intent.roomId, JSON.stringify(intent), disclosureIntentDigest(intent), now);
      return this.project(this.row(grantId));
    });
  }

  public revoke(principal: WebPrincipal, grantId: string, expectedRevision: number, now: string): EvidenceDisclosureGrant {
    assertDisclosure("disclosureRevokeCommand", { expectedRevision });
    this.auth.requireFullWebSession(principal);
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      const row = this.row(grantId), grant = this.project(row);
      const member = this.auth.requireRoomMember(principal, grant.intent.roomId);
      if (member.memberId !== row.owner_member_id || member.teamId !== row.team_id) throw denied();
      if (grant.state === "revoked" && expectedRevision === 1) return grant;
      if (grant.revision !== expectedRevision || grant.state !== "active") throw denied();
      this.database.prepare("UPDATE evidence_disclosure_grants SET state = 'revoked', revision = 2, revoked_at = ? WHERE grant_id = ?").run(now, grantId);
      return this.project(this.row(grantId));
    });
  }

  public list(principal: WebPrincipal, taskId: string): EvidenceDisclosureGrant[] {
    const task = this.tasks.get(taskId); if (!task) throw denied();
    const member = this.auth.requireRoomMember(principal, task.roomId);
    return (this.database.prepare("SELECT * FROM evidence_disclosure_grants WHERE task_id = ? AND owner_member_id = ? ORDER BY created_at, grant_id")
      .all(taskId, member.memberId) as GrantRow[]).map(row => this.project(row));
  }

  public forDevice(principal: DevicePrincipal, grantId: string, now: string): EvidenceDisclosureGrant {
    this.requireCurrentCredential(principal, now);
    const grant = this.project(this.row(grantId));
    this.requireDeviceScope(principal, grant);
    return grant;
  }

  public publish(principal: DevicePrincipal, command: EvidenceDisclosurePublishCommand, now: string) {
    assertDisclosure("disclosurePublishCommand", command);
    const digest = disclosureContentDigest(command.content);
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      // This is the publication/revocation linearization boundary; never trust caller grantState.
      const grant = this.forDevice(principal, command.grantId, now), intent = grant.intent;
      if (digest !== intent.contentSha256 || Buffer.byteLength(command.content, "utf8") !== intent.contentBytes || command.expectedRevision !== 1) throw denied();
      if (grant.resultId) {
        const result = this.database.prepare("SELECT operation_id, proposed_by_agent_id, proposed_by_run_id, summary FROM task_results WHERE result_id = ?").get(grant.resultId) as
          { operation_id: string; proposed_by_agent_id: string; proposed_by_run_id: string; summary: string } | undefined;
        if (!result || result.operation_id !== intent.operationId || result.proposed_by_agent_id !== intent.agentId ||
          result.proposed_by_run_id !== intent.runId || result.summary !== command.content) throw denied();
        return { grant, result: this.results.getForDisclosure(grant.resultId), replayed: true };
      }
      if (grant.state !== "active" || grant.revision !== command.expectedRevision || Date.parse(intent.expiresAt) <= Date.parse(now)) throw denied();
      const task = this.requireScope(intent, grant.ownerMemberId, grant.teamId);
      const run = this.runs.getRun(intent.runId);
      if (run?.state !== "completed") throw denied();
      const event = this.runs.listEvents(intent.runId).find(e => e.event.type === "status" && e.event.status === "completed");
      if (!event) throw denied();
      if (this.database.prepare("SELECT 1 FROM task_results WHERE operation_id = ?").get(intent.operationId)) throw denied();
      const result = this.results.proposeManagedAgent(principal, { agentId: intent.agentId, runId: intent.runId,
        proposal: { operationId: intent.operationId, taskId: intent.taskId, definitionRevision: intent.definitionRevision,
          criteriaRevision: intent.criteriaRevision, proposedAtTaskRevision: task.taskRevision, supersedesResultId: null,
          outcome: "informational", summary: command.content, risks: [], openQuestions: [], nextActions: [], criterionClaims: [],
          sources: [{ evidenceRefId: intent.source.evidenceRef, kind: "run_event", runId: intent.runId, sequence: event.sequence }] }
      }, now, grant.grantId);
      this.database.prepare("UPDATE evidence_disclosure_grants SET result_id = ? WHERE grant_id = ?").run(result.resultId, grant.grantId);
      return { grant: this.project(this.row(grant.grantId)), result, replayed: false };
    });
  }

  public committed(principal: DevicePrincipal, grantId: string, now: string) {
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      const grant = this.forDevice(principal, grantId, now);
      if (!grant.resultId) throw denied();
      const result = this.results.getForDisclosure(grant.resultId);
      if (disclosureContentDigest(result.proposal.summary) !== grant.intent.contentSha256) throw denied();
      return { grant, result, replayed: true };
    });
  }

  private requireCurrentCredential(principal: DevicePrincipal, now: string): void {
    const row = this.database.prepare(`SELECT dc.expires_at FROM device_credentials dc JOIN devices d ON d.device_id = dc.device_id
      JOIN team_members m ON m.member_id = d.owner_member_id JOIN teams t ON t.team_id = d.team_id
      WHERE dc.credential_id = ? AND dc.device_id = ? AND d.owner_member_id = ? AND d.team_id = ?
        AND dc.revoked_at IS NULL AND d.status = 'active' AND t.archived_at IS NULL`)
      .get(principal.credentialId, principal.deviceId, principal.ownerMemberId, principal.teamId) as { expires_at: string | null } | undefined;
    if (!row || (row.expires_at !== null && Date.parse(row.expires_at) <= Date.parse(now))) throw denied();
  }
  private requireDeviceScope(principal: DevicePrincipal, grant: EvidenceDisclosureGrant): void {
    if (principal.deviceId !== grant.intent.deviceId || principal.ownerMemberId !== grant.ownerMemberId || principal.teamId !== grant.teamId) throw denied();
    this.requireScope(grant.intent, grant.ownerMemberId, grant.teamId, Boolean(grant.resultId));
  }
  private requireScope(intent: EvidenceDisclosureIntent, owner: string, team: string, replay = false) {
    const task = this.tasks.get(intent.taskId), agent = this.core.getAgent(intent.agentId), run = this.runs.getRun(intent.runId);
    const room = this.database.prepare(`SELECT 1 FROM rooms r JOIN room_human_participants p ON p.room_id = r.room_id
      JOIN teams t ON t.team_id = r.team_id WHERE r.room_id = ? AND r.team_id = ? AND p.member_id = ? AND r.archived_at IS NULL AND t.archived_at IS NULL`).get(intent.roomId, team, owner);
    const delivery = this.database.prepare("SELECT payload_json FROM run_deliveries WHERE run_id = ?").get(intent.runId) as { payload_json: string } | undefined;
    if (!task || !agent || !run || !room || !delivery || JSON.parse(delivery.payload_json).ownerPrivateOutput !== true ||
      agent.deviceId !== intent.deviceId || agent.ownerMemberId !== owner || agent.teamId !== team || !agent.enabled || agent.integrationMode !== "managed" ||
      task.roomId !== intent.roomId || task.teamId !== team || run.taskId !== intent.taskId || run.roomId !== intent.roomId || run.targetAgentId !== intent.agentId ||
      !this.core.isRoomAgent(intent.roomId, intent.agentId) || (!task.isDefault && !task.assignments.some(a => a.agentId === intent.agentId)) ||
      (!replay && (task.definitionRevision !== intent.definitionRevision || task.criteriaRevision !== intent.criteriaRevision))) throw denied();
    return task;
  }
  private row(id: string): GrantRow {
    if (!/^disclosure_[A-Za-z0-9_-]{8,128}$/u.test(id)) throw denied();
    const row = this.database.prepare("SELECT * FROM evidence_disclosure_grants WHERE grant_id = ?").get(id) as GrantRow | undefined;
    if (!row) throw denied(); return row;
  }
  private project(row: GrantRow): EvidenceDisclosureGrant {
    return { grantId: row.grant_id, ownerMemberId: row.owner_member_id, teamId: row.team_id,
      revision: row.revision, state: row.state, intent: JSON.parse(row.intent_json) as EvidenceDisclosureIntent,
      createdAt: row.created_at, revokedAt: row.revoked_at, resultId: row.result_id };
  }
}
