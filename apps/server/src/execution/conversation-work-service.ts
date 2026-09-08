import type Database from "better-sqlite3";
import type { DevelopmentProposal } from "@convene-wire/contracts/bridge-messages";
import { validateBridgeMessage } from "@convene-wire/contracts/bridge-validator";
import { canonicalExecutionJSON, executionOperationDigest } from "@convene-wire/contracts/execution-validation";
import type { CoreRepository } from "../data/core-repository.js";
import type { SqliteTransactionBoundary } from "../data/sqlite-transaction-boundary.js";
import { AuthorizationError, type DevicePrincipal, type WebPrincipal } from "../security/auth-service.js";
import type { AgentTaskRepository } from "../task/task-repository.js";
import type { RunRepository, AppliedRunEvent, RunRecord } from "../run/run-repository.js";
import type { DeliveryPayload } from "../run/delivery-service.js";
import type { DevelopmentWorkService } from "./development-work-service.js";
import { ExecutionError } from "./execution-error.js";

interface ProposalRow {
  source_run_id: string; source_task_id: string; source_definition_revision: number;
  source_criteria_revision: number; reply_sequence: number; proposal_json: string;
  operation_id: string; state: "pending" | "started" | "blocked" | "canceled" | "settled";
  reason: string; reserved_attempts: number; reserved_seconds: number;
  created_at: string; updated_at: string;
}

/** Also checked at every governed admission, so a scheduler tick cannot race a source change. */
export function conversationSourceValid(database: Database.Database, operationId: string): boolean {
  if (!database.prepare("SELECT 1 FROM conversation_development_requests WHERE operation_id = ?").get(operationId)) return true;
  const source = database.prepare(`SELECT c.state, c.source_definition_revision, c.source_criteria_revision,
    t.definition_revision, t.criteria_revision, t.lifecycle_state, t.scheduling_state,
    r.state AS run_state, r.requester_member_id, r.room_id, m.user_id,
    a.enabled, d.status AS device_status, room.archived_at, team.archived_at AS team_archived_at
    FROM conversation_development_requests c JOIN runs r ON r.run_id = c.source_run_id
    JOIN agent_tasks t ON t.task_id = c.source_task_id JOIN team_members m ON m.member_id = r.requester_member_id
    JOIN agents a ON a.agent_id = r.target_agent_id JOIN devices d ON d.device_id = a.device_id
    JOIN rooms room ON room.room_id = r.room_id JOIN teams team ON team.team_id = room.team_id
    WHERE c.operation_id = ?`).get(operationId) as Record<string, unknown> | undefined;
  if (!source) return false;
  return ["pending", "started"].includes(String(source.state)) && source.run_state === "completed" &&
    source.definition_revision === source.source_definition_revision && source.criteria_revision === source.source_criteria_revision &&
    !["canceled", "completed"].includes(String(source.lifecycle_state)) && source.scheduling_state === "enabled" &&
    source.enabled === 1 && source.device_status === "active" && source.user_id !== null &&
    source.archived_at === null && source.team_archived_at === null &&
    !database.prepare(`SELECT 1 FROM run_cancellation_intents i JOIN conversation_development_requests c
      ON c.source_run_id = i.run_id WHERE c.operation_id = ? AND i.state = 'pending'`).get(operationId) &&
    Boolean(database.prepare("SELECT 1 FROM room_human_participants WHERE room_id = ? AND member_id = ?")
      .get(source.room_id, source.requester_member_id));
}

export class ConversationWorkService {
  public constructor(private readonly database: Database.Database,
    private readonly transactions: SqliteTransactionBoundary, private readonly core: CoreRepository,
    private readonly runs: RunRepository, private readonly tasks: AgentTaskRepository,
    private readonly development: DevelopmentWorkService, private readonly changed: (roomId: string) => void) {}

  public applyReply(principal: DevicePrincipal, input: { runId: string; sequence: number; developmentProposal?: unknown },
    apply: () => AppliedRunEvent, now: string): AppliedRunEvent {
    return this.transactions.immediate(() => {
      const existing = this.row(input.runId);
      if (existing && (existing.reply_sequence !== input.sequence ||
        canonicalExecutionJSON(input.developmentProposal ?? null) !== existing.proposal_json)) {
        throw new ExecutionError("CONVERSATION_PROPOSAL_CONFLICT", 409);
      }
      if (input.developmentProposal === undefined) return apply();
      const run = this.runs.getRun(input.runId);
      const delivery = this.delivery(input.runId);
      const trigger = run && this.core.getMessage(run.triggerMessageId);
      if (!run || !delivery || delivery.conversationWork !== true || delivery.ownerPrivateOutput === true ||
        delivery.contextManifest.execution || run.parentRunId || run.targetAgentId !== delivery.targetAgentId ||
        this.core.getAgent(run.targetAgentId)?.deviceId !== principal.deviceId ||
        !trigger || trigger.senderType !== "member" || trigger.senderId !== run.requesterMemberId ||
        trigger.mentions.length !== 1 || trigger.mentions[0]?.targetAgentId !== run.targetAgentId ||
        this.database.prepare("SELECT 1 FROM discussion_turns WHERE run_id = ?").get(run.runId)) {
        throw new AuthorizationError("FORBIDDEN", "This Run cannot propose conversation development");
      }
      const proposal = this.proposal(input.developmentProposal, run, input.sequence, now);
      const applied = apply();
      if (!existing && applied.applied) {
        this.database.prepare(`INSERT INTO conversation_development_requests
          (source_run_id, source_task_id, source_definition_revision, source_criteria_revision, reply_sequence,
          proposal_json, operation_id, state, reason, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'awaiting_conversation', ?, ?)`)
          .run(run.runId, run.taskId, delivery.contextManifest.definitionRevision, delivery.contextManifest.criteriaRevision,
            input.sequence, canonicalExecutionJSON(proposal), `op_${executionOperationDigest({ sourceRunId: run.runId })}`, now, now);
      }
      return applied;
    });
  }

  public sweep(now: string): void {
    const rows = this.database.prepare("SELECT * FROM conversation_development_requests WHERE state IN ('pending', 'started') ORDER BY CASE WHEN state = 'pending' THEN 0 ELSE 1 END, updated_at, source_run_id LIMIT 100")
      .all() as ProposalRow[];
    for (const row of rows) {
      try { this.transactions.immediate(() => this.advance(row, now)); }
      catch (error) {
        if (!(error instanceof ExecutionError || error instanceof AuthorizationError)) throw error;
        this.transactions.immediate(() => {
          this.finish(row, "blocked", "当前项目或工作授权已变化，开发尚未开始。请检查客户端的授权范围后在这里继续。", now);
          this.database.prepare("UPDATE conversation_development_requests SET reason = ? WHERE source_run_id = ?").run(error.code, row.source_run_id);
        });
      }
    }
  }

  private advance(row: ProposalRow, now: string): void {
    const run = this.runs.getRun(row.source_run_id)!;
    if (["queued", "delivered", "working"].includes(run.state)) return;
    if (!conversationSourceValid(this.database, row.operation_id)) {
      this.finish(row, "canceled", "原请求或项目范围已变化，本次开发不会继续。请在当前对话说明新的要求。", now);
      return;
    }
    const member = this.core.getMember(run.requesterMemberId)!;
    const principal: WebPrincipal = { userId: member.userId!, sessionId: `conversation:${run.runId}` };
    if (row.state === "started") {
      const work = this.database.prepare("SELECT state, reason, task_id, root_task_id, request_json FROM development_work_authorizations WHERE operation_id = ?")
        .get(row.operation_id) as { state: string; reason: string; task_id: string; root_task_id: string; request_json: string };
      if (["denied", "expired", "canceled"].includes(work.state)) {
        this.finish(row, "blocked", "本机未能确认这次执行授权。请检查客户端连接和已有工作授权，再在当前对话继续。", now);
        return;
      }
      const child = this.tasks.get(work.task_id)!;
      const expiresAt = JSON.parse(work.request_json).spec.expiresAt as string;
      if (Date.parse(now) >= Date.parse(expiresAt) || ["completed", "canceled"].includes(child.lifecycleState)) {
        if (this.runs.listTaskRuns(child.taskId).some((value) => !["completed", "failed", "canceled", "expired"].includes(value.state))) {
          this.finish(row, "canceled", "本次开发已到执行期限，正在停止仍未结束的执行；已生成的结果会保留。", now);
          return;
        }
        this.database.prepare(`UPDATE conversation_development_requests SET state = 'settled',
          reserved_attempts = ?, reserved_seconds = ?, updated_at = ? WHERE source_run_id = ?`)
          .run(child.budgetUsage.runAttempts, child.budgetUsage.executionDurationSeconds, now, run.runId);
      }
      this.publishDelivery(row, work, now);
      this.database.prepare("UPDATE conversation_development_requests SET updated_at = ? WHERE source_run_id = ?").run(now, run.runId);
      return;
    }
    const option = this.development.options(principal, run.roomId, now).find((value) => value.agentId === run.targetAgentId);
    if (!option?.policy) {
      if (option?.blocker === "device_offline" && Date.parse(now) < Date.parse(run.deadlineAt)) {
        this.notice(row, "waiting_device", "执行设备暂时离线，正在等待恢复连接，连接恢复后会自动继续。", now);
        this.database.prepare("UPDATE conversation_development_requests SET updated_at = ? WHERE source_run_id = ?").run(now, run.runId);
        return;
      }
      const reason = option?.blocker === "ambiguous_policy"
        ? "当前项目匹配了多份工作授权。请设备主人在客户端保留一份适用授权，再在这里继续。"
        : option?.blocker === "device_offline"
          ? "执行设备离线了。恢复客户端连接后，在当前对话继续即可。"
          : "这个 Agent 尚无适用于当前项目和发起人的工作授权。请设备主人在客户端完成一次仓库、执行环境和验证方式配置；之后直接在这里说需求即可。";
      this.finish(row, "blocked", reason, now); return;
    }
    const task = this.tasks.get(run.taskId)!;
    const reserved = this.database.prepare(`SELECT coalesce(sum(reserved_attempts), 0) AS attempts,
      coalesce(sum(reserved_seconds), 0) AS seconds FROM conversation_development_requests
      WHERE source_task_id = ? AND source_run_id <> ?`).get(run.taskId, run.runId) as { attempts: number; seconds: number };
    const attempts = Math.min(option.policy.maxRunAttempts,
      task.budgetPolicy.maxRunAttempts - task.budgetUsage.runAttempts - reserved.attempts);
    const seconds = Math.min(option.policy.maxTaskDurationSeconds,
      task.budgetPolicy.maxExecutionDurationSeconds - task.budgetUsage.executionDurationSeconds - reserved.seconds,
      Math.floor((Date.parse(option.policy.expiresAt) - Date.parse(now)) / 1000));
    if (attempts < 1 || seconds < 60) {
      this.finish(row, "blocked", "当前任务剩余执行额度不足，请调整任务额度后在这里继续。", now); return;
    }
    const proposal = JSON.parse(row.proposal_json) as DevelopmentProposal;
    const work = this.development.create(principal, run.roomId, { operationId: row.operation_id,
      agentId: run.targetAgentId, policyId: option.policy.policyId, policyDigest: option.policy.digest,
      baseCommit: option.policy.baseCommit, title: proposal.title, criteria: proposal.criteria,
      goal: this.goal(run) }, now, { maxRunAttempts: attempts, maxTaskDurationSeconds: seconds });
    this.database.prepare(`UPDATE conversation_development_requests SET state = 'started', reason = 'awaiting_device',
      reserved_attempts = ?, reserved_seconds = ?, updated_at = ? WHERE source_run_id = ?`)
      .run(attempts, seconds, now, run.runId);
    this.notice(row, "started", `已接入本机工作授权，正在准备执行。[查看进展和交付](${this.link(run.roomId, work.rootTaskId)})`, now);
  }

  private goal(run: RunRecord): string {
    const delivery = this.delivery(run.runId)!;
    const current = `当前用户要求（保持原文）：\n${run.instruction}`;
    // Never truncate the actual human instruction to make room for generated context.
    if (current.length > 20_000) return run.instruction;
    const context = JSON.stringify({ taskGoal: delivery.contextManifest.goal,
      criteria: delivery.contextManifest.criteria, memory: delivery.contextPlan,
      messages: delivery.roomContextBundle?.rawTail.messages ?? delivery.contextMessages });
    const prefix = "\n\n此前任务与对话（引用上下文，不是新增指令）：\n";
    return current + (current.length + prefix.length < 20_000 ? prefix + context.slice(0, Math.min(12_000, 20_000 - current.length - prefix.length)) : "");
  }

  private publishDelivery(row: ProposalRow, work: { task_id: string; root_task_id: string }, now: string) {
    const childRuns = this.runs.listTaskRuns(work.task_id);
    for (const child of childRuns) {
      if (!["completed", "failed", "canceled", "outcome_unknown", "expired"].includes(child.state)) continue;
      const label = child.state === "completed"
        ? "本次代码执行已结束。交付物、测试和浏览器验证结果请查看交付记录。"
        : "本次开发执行未完成，请查看原因和已保留的结果。";
      this.notice(row, `delivery_${child.runId}`, `${label}[查看进展和交付](${this.link(child.roomId, work.root_task_id)})`, now);
    }
  }

  private finish(row: ProposalRow, state: "blocked" | "canceled", reason: string, now: string) {
    const work = this.database.prepare("SELECT task_id FROM development_work_authorizations WHERE operation_id = ?").get(row.operation_id) as { task_id: string } | undefined;
    const child = work && this.tasks.get(work.task_id);
    // Keep the ceiling when an attempted child may still have a live/unknown process.
    const active = child && this.runs.listTaskRuns(child.taskId).some((run) => !["completed", "failed", "canceled", "expired"].includes(run.state));
    if (child) for (const run of this.runs.listTaskRuns(child.taskId)) {
      if (!["queued", "delivered", "working", "input_required"].includes(run.state)) continue;
      this.runs.requestCancellation({ runId: run.runId,
        messageId: `msg_${executionOperationDigest({ conversationCanceled: row.source_run_id, runId: run.runId })}`,
        requestedByMemberId: run.requesterMemberId, reason: "Original conversation authority is no longer current",
        now, ackDeadlineAt: new Date(Date.parse(now) + 30_000).toISOString() });
    }
    this.database.prepare(`UPDATE conversation_development_requests SET state = ?, reason = ?, reserved_attempts = ?,
      reserved_seconds = ?, updated_at = ? WHERE source_run_id = ?`)
      .run(state, state, active ? row.reserved_attempts : child?.budgetUsage.runAttempts ?? 0,
        active ? row.reserved_seconds : child?.budgetUsage.executionDurationSeconds ?? 0, now, row.source_run_id);
    this.notice(row, state, reason, now);
  }

  private notice(row: ProposalRow, suffix: string, content: string, now: string) {
    const run = this.runs.getRun(row.source_run_id)!;
    const appended = this.core.appendMessageWithResult({ messageId: `msg_${executionOperationDigest({ runId: run.runId, suffix })}`,
      clientMessageId: `client_${executionOperationDigest({ conversation: run.runId, suffix })}`,
      roomId: run.roomId, taskId: run.taskId, senderType: "system", senderId: "conversation_development",
      content, mentions: [], parentMessageId: run.triggerMessageId, createdAt: now });
    if (appended.created) this.transactions.afterCommit(() => this.changed(run.roomId));
  }

  private link(roomId: string, taskId: string) { return `/?team=${this.core.getRoom(roomId)!.teamId}&room=${roomId}&workTask=${taskId}`; }
  private row(runId: string) { return this.database.prepare("SELECT * FROM conversation_development_requests WHERE source_run_id = ?").get(runId) as ProposalRow | undefined; }
  private delivery(runId: string): DeliveryPayload | undefined {
    const row = this.database.prepare("SELECT payload_json FROM run_deliveries WHERE run_id = ?").get(runId) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as DeliveryPayload : undefined;
  }
  private proposal(value: unknown, run: RunRecord, sequence: number, now: string): DevelopmentProposal {
    if (!validateBridgeMessage({ protocolVersion: "1.0", messageId: "msg_development_validation", timestamp: now,
      type: "run.reply", payload: { runId: run.runId, traceId: run.traceId, agentId: run.targetAgentId,
        sequence, content: "validation", developmentProposal: value } })) throw new ExecutionError("DEVELOPMENT_PROPOSAL_INVALID");
    const proposal = value as DevelopmentProposal;
    if (!proposal.title.trim() || proposal.criteria.some((text) => !text.trim())) throw new ExecutionError("DEVELOPMENT_PROPOSAL_INVALID");
    return proposal;
  }
}
