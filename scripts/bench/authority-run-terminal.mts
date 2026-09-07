// QA-only terminal delivery. No source content, model invocation or Result proposal.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { RunRepository } from "../../apps/server/src/run/run-repository.js";
import { ResultRepository } from "../../apps/server/src/task/result-repository.js";
import { validateTerminalIntent } from "./authority-session.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
const request = JSON.parse(readFileSync(inputPath, "utf8"));
const intent = validateTerminalIntent(request.intent);
const db = new Database(request.databasePath, { fileMustExist: true });
db.pragma("busy_timeout = 5000");
try {
  const response = db.transaction(() => {
    const runs = new RunRepository(db), run = runs.getRun(intent.scope.runId);
    assert.ok(run, "Unknown Run");
    const room = db.prepare("SELECT team_id FROM rooms WHERE room_id = ?").get(run.roomId) as { team_id: string };
    assert.equal(room.team_id, intent.scope.teamId);
    assert.equal(run.taskId, intent.scope.taskId);
    assert.equal(run.roomId, intent.scope.roomId);
    assert.equal(run.targetAgentId, intent.scope.agentId);
    assert.equal(run.requesterMemberId, intent.scope.ownerMemberId);
    const code = `QA_AUTHORITY_${intent.cause}`;
    const previous = db.prepare("SELECT error_json FROM run_events WHERE run_id = ? AND sequence = ?")
      .get(run.runId, run.lastSequence) as { error_json: string | null } | undefined;
    if (["completed", "failed", "canceled", "expired", "outcome_unknown"].includes(run.state)) {
      const same = run.state === intent.status && previous?.error_json && JSON.parse(previous.error_json).code === code;
      return { runId: run.runId, state: run.state, sequence: run.lastSequence,
        disposition: same ? "replayed" : "preserved_existing_terminal", matchedIntent: Boolean(same) };
    }
    assert.ok(!new ResultRepository(db).listForTask(run.taskId).some(r => r.proposedBy.runId === run.runId),
      "An existing Result requires explicit reconciliation, not synthetic failure");
    const applied = runs.applyEvent(run.runId, { type: "status", sequence: run.lastSequence + 1,
      status: intent.status, error: { code, message: "Bounded authority session ended without an accepted final output.", retryable: false } }, intent.observedAt);
    assert.ok(applied.applied);
    return { runId: run.runId, state: applied.run.state, sequence: applied.run.lastSequence,
      disposition: "applied", matchedIntent: true };
  }).immediate();
  if (request.crashAfterCommit === true) process.kill(process.pid, "SIGKILL");
  writeFileSync(outputPath, JSON.stringify(response) + "\n", { flag: "wx", mode: 0o600 });
} finally { db.close(); }
