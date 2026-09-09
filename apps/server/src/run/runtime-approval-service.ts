import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { RuntimeApprovalRequestedPayload, RuntimeApprovalDecisionPayload } from "@convene-wire/contracts/bridge-messages";
import { canonicalExecutionJSON } from "@convene-wire/contracts/execution-validation";
import { SqliteTransactionBoundary } from "../data/sqlite-transaction-boundary.js";
import type { CoreRepository } from "../data/core-repository.js";
import type { BridgeConnectionRegistry } from "../bridge/bridge-connection-registry.js";
import type { RunRepository } from "./run-repository.js";
import { AuthorizationError, type AuthService, type DevicePrincipal, type WebPrincipal } from "../security/auth-service.js";
import { redactSensitiveText } from "../security/redaction.js";

type Row = {
  request_id: string; run_id: string; device_id: string; owner_member_id: string; team_id: string;
  room_id: string; connection_epoch: number; request_json: string; digest: string;
  state: RuntimeApprovalDecisionPayload["decision"]; created_at: string; expires_at: string;
};
const denied = () => new AuthorizationError("FORBIDDEN", "Runtime approval authority is unavailable");

export class RuntimeApprovalService {
  public constructor(private readonly database: Database.Database, private readonly auth: AuthService,
    private readonly core: CoreRepository, private readonly runs: RunRepository,
    private readonly connections: BridgeConnectionRegistry) {
    // A new Central process has no live Runtime callback/connection evidence.
    database.prepare("UPDATE runtime_approvals SET state = 'expired' WHERE state IN ('pending', 'allow')").run();
  }

  public request(actor: DevicePrincipal, input: RuntimeApprovalRequestedPayload, now: string): RuntimeApprovalDecisionPayload {
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      const previous = this.database.prepare("SELECT * FROM runtime_approvals WHERE request_id = ?").get(input.requestId) as Row | undefined;
      if (previous) {
        if (previous.device_id !== actor.deviceId || previous.owner_member_id !== actor.ownerMemberId || previous.team_id !== actor.teamId ||
          previous.request_json !== canonicalExecutionJSON(input)) throw denied();
        return this.receipt(this.refresh(previous, now));
      }
      const run = this.runs.getRun(input.runId), epoch = this.connections.activeEpoch(actor.deviceId);
      if (!run || epoch === undefined || !this.live(input, actor.deviceId, actor.ownerMemberId, actor.teamId, epoch, now) ||
        Date.parse(input.expiresAt) <= Date.parse(now) || Date.parse(input.expiresAt) > Date.parse(now) + 5 * 60_000 ||
        Date.parse(input.expiresAt) > Date.parse(run.deadlineAt) || redactSensitiveText(input.details) !== input.details) throw denied();
      const count = this.database.prepare("SELECT count(*) AS n FROM runtime_approvals WHERE run_id = ?").get(input.runId) as { n: number };
      if (count.n >= 64) throw denied();
      this.database.prepare(`INSERT INTO runtime_approvals
        (request_id, run_id, device_id, owner_member_id, team_id, room_id, connection_epoch, request_json, digest, state, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(input.requestId, input.runId, actor.deviceId,
        actor.ownerMemberId, actor.teamId, run.roomId, epoch, canonicalExecutionJSON(input),
        createHash("sha256").update(input.details).digest("hex"), now, input.expiresAt);
      return this.receipt(this.row(input.requestId));
    });
  }

  public list(actor: WebPrincipal, teamId: string, now: string) {
    this.auth.requireFullWebSession(actor);
    const member = this.auth.requireTeamMember(actor, teamId);
    const rows = this.database.prepare(`SELECT * FROM runtime_approvals WHERE team_id = ? AND owner_member_id = ?
      AND state = 'pending' ORDER BY created_at, request_id LIMIT 100`).all(teamId, member.memberId) as Row[];
    return rows.flatMap(original => {
      const row = this.refresh(original, now);
      if (row.state !== "pending") return [];
      try { this.auth.requireRoomMember(actor, row.room_id); } catch { return []; }
      const request = JSON.parse(row.request_json) as RuntimeApprovalRequestedPayload;
      const run = this.runs.getRun(row.run_id)!;
      return [{ ...this.receipt(row), request, roomId: row.room_id, taskId: run.taskId,
        agentName: this.core.getAgent(request.agentId)?.name ?? request.agentId,
        deviceName: this.core.getDevice(row.device_id)?.name ?? row.device_id,
        roomName: this.core.getRoom(row.room_id)?.name ?? row.room_id }];
    });
  }

  public decide(actor: WebPrincipal, id: string, digest: string, decision: "allow" | "deny", now: string) {
    this.auth.requireFullWebSession(actor);
    return new SqliteTransactionBoundary(this.database).immediate(() => {
      let row = this.row(id);
      const member = this.auth.requireRoomMember(actor, row.room_id);
      if (member.memberId !== row.owner_member_id || member.teamId !== row.team_id || row.digest !== digest) throw denied();
      row = this.refresh(row, now);
      if (row.state === decision) return this.receipt(row);
      if (row.state !== "pending") throw denied();
      this.database.prepare(`UPDATE runtime_approvals SET state = ?, decided_decision = ?, decided_at = ?, decided_by_session_id = ?
        WHERE request_id = ? AND state = 'pending'`).run(decision, decision, now, actor.sessionId, id);
      return this.receipt(this.row(id));
    });
  }

  private live(input: RuntimeApprovalRequestedPayload, deviceId: string, ownerId: string, teamId: string, epoch: number, now: string): boolean {
    const run = this.runs.getRun(input.runId), agent = this.core.getAgent(input.agentId), device = this.core.getDevice(deviceId);
    if (this.database.prepare("SELECT 1 FROM run_cancellation_intents WHERE run_id = ?").get(input.runId)) return false;
    if (!run || !agent || !device || device.status !== "active" || device.ownerMemberId !== ownerId || device.teamId !== teamId ||
      run.targetAgentId !== input.agentId || !["working", "delivered"].includes(run.state) || Date.parse(run.deadlineAt) <= Date.parse(now) ||
      agent.deviceId !== deviceId || agent.ownerMemberId !== ownerId || agent.teamId !== teamId || !agent.enabled || agent.capabilities.ownerPrivateOutput ||
      agent.runtimePolicy?.deviceTrust || agent.runtimePolicy?.centralApproval?.revision !== input.revision ||
      this.connections.activeEpoch(deviceId) !== epoch || this.connections.centralApprovalRevision(deviceId, input.agentId) !== input.revision ||
      !this.core.isRoomAgent(run.roomId, input.agentId)) return false;
    const room = this.database.prepare(`SELECT 1 FROM rooms r JOIN teams t ON t.team_id = r.team_id
      JOIN room_human_participants owner ON owner.room_id = r.room_id AND owner.member_id = ?
      JOIN room_human_participants requester ON requester.room_id = r.room_id AND requester.member_id = ?
      WHERE r.room_id = ? AND r.team_id = ? AND r.archived_at IS NULL AND t.archived_at IS NULL`).get(ownerId, run.requesterMemberId, run.roomId, teamId);
    const delivery = this.database.prepare("SELECT payload_json, device_id FROM run_deliveries WHERE run_id = ? AND state = 'accepted'")
      .get(input.runId) as { payload_json: string; device_id: string } | undefined;
    if (!room || !delivery || delivery.device_id !== deviceId) return false;
    const payload = JSON.parse(delivery.payload_json);
    return payload.centralApproval?.revision === input.revision && !payload.deviceTrust && !payload.conversationWork &&
      !payload.ownerPrivateOutput && !payload.contextManifest?.execution;
  }

  private refresh(row: Row, now: string): Row {
    if (["pending", "allow"].includes(row.state) && (Date.parse(row.expires_at) <= Date.parse(now) ||
      !this.live(JSON.parse(row.request_json), row.device_id, row.owner_member_id, row.team_id, row.connection_epoch, now))) {
      this.database.prepare("UPDATE runtime_approvals SET state = 'expired' WHERE request_id = ?").run(row.request_id);
      return { ...row, state: "expired" };
    }
    return row;
  }
  private row(id: string): Row {
    const row = this.database.prepare("SELECT * FROM runtime_approvals WHERE request_id = ?").get(id) as Row | undefined;
    if (!row) throw denied(); return row;
  }
  private receipt(row: Row): RuntimeApprovalDecisionPayload {
    return { requestId: row.request_id, runId: row.run_id, digest: row.digest, decision: row.state };
  }
}
