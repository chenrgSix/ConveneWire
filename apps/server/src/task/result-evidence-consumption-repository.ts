import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

function evidenceScope(runtimeScopeId: string, policy?: string): string {
  return policy ? createHash("sha256").update(JSON.stringify([runtimeScopeId, policy])).digest("hex") : runtimeScopeId;
}

interface DeliveryEvidencePage {
  throughRevision?: number;
}

export class ResultEvidenceConsumptionRepository {
  public constructor(private readonly database: Database.Database) {}

  public get(
    taskId: string,
    agentId: string,
    runtimeScopeId: string,
    contextPolicy?: string
  ): number | undefined {
    const row = this.database.prepare(`
      SELECT through_revision
      FROM task_result_evidence_consumption
      WHERE task_id = ? AND agent_id = ? AND runtime_scope_id = ?
    `).get(taskId, agentId, evidenceScope(runtimeScopeId, contextPolicy)) as
      | { through_revision: number }
      | undefined;
    return row?.through_revision;
  }

  public acknowledge(input: {
    runId: string;
    taskId: string;
    agentId: string;
    runtimeScopeId: string;
    throughRevision: number;
    now: string;
  }): void {
    const policy = this.deliveryPolicy(input.runId);
    const current = this.get(input.taskId, input.agentId, input.runtimeScopeId, policy) ?? 0;
    if (input.throughRevision <= current) return;
    this.validateAcknowledgement(input);
    this.database.prepare(`
      INSERT INTO task_result_evidence_consumption (
        task_id, agent_id, runtime_scope_id, through_revision, updated_at
      ) VALUES (
        @taskId, @agentId, @runtimeScopeId, @throughRevision, @now
      )
      ON CONFLICT(task_id, agent_id, runtime_scope_id) DO UPDATE SET
        through_revision = max(
          task_result_evidence_consumption.through_revision,
          excluded.through_revision
        ),
        updated_at = excluded.updated_at
    `).run({ ...input, runtimeScopeId: evidenceScope(input.runtimeScopeId, policy) });
  }

  private deliveryPolicy(runId: string): string | undefined {
    const row = this.database.prepare("SELECT payload_json FROM run_deliveries WHERE run_id = ?").get(runId) as { payload_json: string } | undefined;
    return row ? (JSON.parse(row.payload_json) as { session?: { contextPolicy?: string } }).session?.contextPolicy : undefined;
  }

  public validateAcknowledgement(input: {
    runId: string;
    taskId: string;
    agentId: string;
    runtimeScopeId: string;
    throughRevision: number;
  }): void {
    const policy = this.deliveryPolicy(input.runId);
    const current = this.get(input.taskId, input.agentId, input.runtimeScopeId, policy) ?? 0;
    if (input.throughRevision <= current) return;
    const delivery = this.database.prepare(`
      SELECT payload_json FROM run_deliveries WHERE run_id = ?
    `).get(input.runId) as { payload_json: string } | undefined;
    if (!delivery) {
      throw new Error("Result-evidence acknowledgement has no durable delivery");
    }
    const payload = JSON.parse(delivery.payload_json) as {
      session?: { runtimeScopeId?: string };
      contextPlan?: { resultEvidence?: DeliveryEvidencePage };
    };
    if (
      payload.session?.runtimeScopeId !== input.runtimeScopeId ||
      payload.contextPlan?.resultEvidence?.throughRevision !== input.throughRevision
    ) {
      throw new Error("Result-evidence acknowledgement exceeds its delivered page");
    }
  }
}
