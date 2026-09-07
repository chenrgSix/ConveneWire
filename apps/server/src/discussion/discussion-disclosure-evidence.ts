import type Database from "better-sqlite3";
import type { EvidenceDisclosureIntent, ResultProjection } from "@convene-wire/contracts/task-result";
import { disclosureContentDigest } from "@convene-wire/contracts/disclosure-validation";
import type { ResultRepository } from "../task/result-repository.js";
import type { DiscussionRecord, DiscussionTurn } from "./discussion-types.js";

export interface ReleasedDiscussionEvidence {
  result: ResultProjection;
  source: EvidenceDisclosureIntent["source"];
  contentSha256: string;
  contentBytes: number;
  ownerMemberId: string;
  deviceId: string;
  messageId: string;
}

/** Reads committed authority and existing Results; never creates a second contribution. */
export class DiscussionDisclosureEvidence {
  public constructor(private readonly database: Database.Database, private readonly results: ResultRepository) {}

  public forTurn(turn: DiscussionTurn, before: string): ReleasedDiscussionEvidence | undefined {
    const rows = this.database.prepare(`
      SELECT g.result_id FROM evidence_disclosure_grants g
      JOIN task_results r ON r.result_id = g.result_id
      WHERE g.run_id = ? AND r.proposed_at < ? ORDER BY r.result_version, r.result_id
    `).all(turn.runId, before) as Array<{ result_id: string }>;
    for (const row of rows) {
      const evidence = this.admitted(row.result_id, turn);
      if (evidence) return evidence;
    }
    return undefined;
  }

  public admitted(resultId: string, turn: DiscussionTurn): ReleasedDiscussionEvidence | undefined {
    const row = this.database.prepare(`
      SELECT g.intent_json, g.owner_member_id, g.device_id, m.message_id
      FROM evidence_disclosure_grants g JOIN task_results r ON r.result_id = g.result_id
      JOIN discussion_turns t ON t.run_id = g.run_id
      JOIN discussions d ON d.discussion_id = t.discussion_id
      JOIN agent_tasks task ON task.task_id = d.task_id
      JOIN messages m ON m.client_message_id = 'client_result_proposed_' || r.result_id
        AND m.room_id = d.room_id AND m.task_id = d.task_id AND m.sender_id = 'result_lifecycle'
      WHERE g.result_id = ? AND t.turn_id = ? AND g.run_id = ? AND g.agent_id = t.speaker_agent_id
        AND g.room_id = d.room_id AND g.task_id = d.task_id
        AND r.room_id = d.room_id AND r.task_id = d.task_id
        AND r.proposed_by_run_id = g.run_id AND r.proposed_by_agent_id = g.agent_id
        AND r.definition_revision = task.definition_revision AND r.criteria_revision = task.criteria_revision
    `).get(resultId, turn.turnId, turn.runId) as {
      intent_json: string; owner_member_id: string; device_id: string; message_id: string;
    } | undefined;
    if (!row) return undefined;
    const result = this.results.get(resultId);
    const intent = JSON.parse(row.intent_json) as EvidenceDisclosureIntent;
    if (!result || result.state === "rejected" || result.state === "superseded" ||
      intent.runId !== turn.runId || intent.agentId !== turn.speakerAgentId ||
      intent.operationId !== result.proposal.operationId || intent.audience !== "room_members" ||
      disclosureContentDigest(result.proposal.summary) !== intent.contentSha256 ||
      Buffer.byteLength(result.proposal.summary, "utf8") !== intent.contentBytes) return undefined;
    return { result, source: intent.source, contentSha256: intent.contentSha256,
      contentBytes: intent.contentBytes, ownerMemberId: row.owner_member_id,
      deviceId: row.device_id, messageId: row.message_id };
  }

  public canConsume(discussion: DiscussionRecord, agentId: string): boolean {
    return authorizedDisclosureConsumer(this.database, discussion.roomId, discussion.taskId, agentId);
  }
}

function authorizedDisclosureConsumer(database: Database.Database, roomId: string, taskId: string, agentId: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM agents a JOIN rooms r ON r.room_id = ? AND r.team_id = a.team_id
    JOIN teams team ON team.team_id = r.team_id
    JOIN room_agent_participants p ON p.room_id = r.room_id AND p.agent_id = a.agent_id
    JOIN room_human_participants h ON h.room_id = r.room_id AND h.member_id = a.owner_member_id
    JOIN agent_tasks task ON task.task_id = ? AND task.room_id = r.room_id
    LEFT JOIN devices device ON device.device_id = a.device_id
    WHERE a.agent_id = ? AND a.enabled = 1 AND r.archived_at IS NULL AND team.archived_at IS NULL
      AND task.lifecycle_state NOT IN ('completed', 'canceled')
      AND (task.is_default = 1 OR EXISTS (SELECT 1 FROM task_agent_assignments assigned
        WHERE assigned.task_id = task.task_id AND assigned.agent_id = a.agent_id))
      AND (a.device_id IS NULL OR (device.status = 'active' AND device.owner_member_id = a.owner_member_id))
  `).get(roomId, taskId, agentId));
}

/** Rechecked on every managed send, including a reconnect with an existing payload. */
export function canDeliverDisclosureDiscussion(database: Database.Database, runId: string): boolean {
  const row = database.prepare(`
    SELECT d.room_id, d.task_id, t.speaker_agent_id,
      (json_extract(run.context_manifest_json, '$.definitionRevision') = task.definition_revision
        AND json_extract(run.context_manifest_json, '$.criteriaRevision') = task.criteria_revision) AS current_revision
    FROM discussion_turns t JOIN runs run ON run.run_id = t.run_id
    JOIN discussions d ON d.discussion_id = t.discussion_id
    JOIN agent_tasks task ON task.task_id = d.task_id WHERE t.run_id = ?
      AND EXISTS (SELECT 1 FROM discussion_participants p JOIN agents a ON a.agent_id = p.agent_id
        WHERE p.discussion_id = d.discussion_id AND (json_extract(a.capabilities_json, '$.ownerPrivateOutput') = 1
          OR EXISTS (SELECT 1 FROM discussion_turns prior JOIN run_deliveries rd ON rd.run_id = prior.run_id
            WHERE prior.discussion_id = d.discussion_id AND json_extract(rd.payload_json, '$.ownerPrivateOutput') = 1)))
  `).get(runId) as { room_id: string; task_id: string; speaker_agent_id: string; current_revision: number | null } | undefined;
  return !row || (row.current_revision === 1 && authorizedDisclosureConsumer(database, row.room_id, row.task_id, row.speaker_agent_id));
}
