import type Database from "better-sqlite3";
import type { DiscussionWaveSealMember } from "./discussion-types.js";

// Public Room history may include a staged reply from a failed Run. Only the
// settled Turn output (or exact quorum seal member) is input to a later Wave.
export function discussionExcludedMessageIds(database: Database.Database, runId: string): string[] {
  const rows = database.prepare(`
    SELECT
      rejected.turn_id,
      rejected.state AS turn_state,
      rejected.output_message_id,
      sealed_wave.state AS wave_state,
      seal.accepted_members_json,
      projection.message_id,
      projection.reply_sequence
    FROM discussion_turns current_turn
    JOIN discussion_waves current_wave
      ON current_wave.wave_id = current_turn.wave_id
    JOIN discussion_waves sealed_wave
      ON sealed_wave.discussion_id = current_turn.discussion_id
    LEFT JOIN discussion_wave_seals seal
      ON sealed_wave.wave_id = seal.wave_id
    JOIN discussion_turns rejected
      ON rejected.wave_id = sealed_wave.wave_id
    JOIN run_reply_message_projections projection
      ON projection.run_id = rejected.run_id
    WHERE current_turn.run_id = ?
      AND sealed_wave.ordinal < current_wave.ordinal
    ORDER BY sealed_wave.ordinal, rejected.wave_member_ordinal,
      projection.reply_sequence
  `).all(runId) as Array<{
    turn_id: string;
    turn_state: string;
    output_message_id: string | null;
    wave_state: string;
    accepted_members_json: string | null;
    message_id: string;
    reply_sequence: number;
  }>;
  return [...new Set(rows.flatMap((row) => {
    const admitted = row.accepted_members_json !== null
      ? (JSON.parse(row.accepted_members_json) as DiscussionWaveSealMember[]).some(member =>
        member.turnId === row.turn_id && member.outputMessageId === row.message_id &&
        member.sourceReplySequence === row.reply_sequence)
      : row.wave_state !== "open" && row.turn_state === "completed" && row.output_message_id === row.message_id;
    return admitted ? [] : [row.message_id];
  }))];
}
