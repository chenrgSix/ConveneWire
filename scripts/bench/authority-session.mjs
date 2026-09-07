// Maintained QA authority-session supervisor. No automatic retry or model execution entrypoint.
import assert from "node:assert/strict";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { invokeAuthoritySession } from "./authority-session-runtime.mjs";
import { childCommand, hash } from "./authority-collaboration.mjs";

const causes = ["TOOL_PROTOCOL", "TIMEOUT", "CANCELED", "PROCESS", "NO_FINAL", "EVIDENCE_INCOMPLETE", "PUBLICATION", "HARNESS"];
export function validateTerminalIntent(intent) {
  assert.deepEqual(Object.keys(intent).sort(), ["cause", "observedAt", "scope", "status", "version"]);
  assert.equal(intent.version, 1); assert.ok(causes.includes(intent.cause));
  assert.equal(intent.status, intent.cause === "CANCELED" ? "canceled" : "failed");
  assert.ok(Number.isFinite(Date.parse(intent.observedAt)));
  assert.deepEqual(Object.keys(intent.scope).sort(), ["agentId", "ownerMemberId", "roomId", "runId", "taskId", "teamId"]);
  for (const [key, prefix] of Object.entries({ agentId: "agent", ownerMemberId: "member", roomId: "room", runId: "run", taskId: "task", teamId: "team" })) {
    assert.match(intent.scope[key], new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,96}$`));
  }
  return intent;
}
export function terminalIntent(meta, role, cause) {
  return validateTerminalIntent({ version: 1, scope: { teamId: meta.teamId, roomId: meta.roomId,
    taskId: meta.taskId, runId: meta.runs[role], agentId: meta.agents[role], ownerMemberId: meta.ownerMemberId },
  status: cause === "CANCELED" ? "canceled" : "failed", cause, observedAt: new Date().toISOString() });
}
export function retainTerminalIntent(file, intent) {
  validateTerminalIntent(intent);
  if (existsSync(file)) { assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), intent); return; }
  const fd = openSync(file, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(intent) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  const parent = openSync(path.dirname(file), "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
export async function replayTerminalIntent({ resources, databasePath, intentPath, deliveryDirectory, crashAfterCommit = false }) {
  const intent = validateTerminalIntent(JSON.parse(readFileSync(intentPath, "utf8")));
  try {
    const response = await childCommand(resources, "scripts/bench/authority-run-terminal.mts",
      { databasePath, intent, crashAfterCommit }, deliveryDirectory, { typescript: true });
    if (response.exitCode !== 0 || !response.response) return { persistence: "pending_terminal", cause: "TERMINAL_DELIVERY_FAILED", intentSha256: hash(JSON.stringify(intent)) };
    const { state: runState, ...receipt } = response.response;
    return { ...receipt, runState, persistence: receipt.matchedIntent ? "terminal" : "terminal_conflict", intentSha256: hash(JSON.stringify(intent)) };
  } catch { return { persistence: "pending_terminal", cause: "TERMINAL_DELIVERY_FAILED", intentSha256: hash(JSON.stringify(intent)) }; }
}
function failureCause(row, signal) {
  if (signal?.aborted || row?.outcome === "canceled") return "CANCELED";
  if (row?.outcome === "timed_out") return "TIMEOUT";
  if (row?.failures?.some(f => ["unapproved_tool", "tool_identity_changed", "tool_identity_missing", "tool_call_incomplete", "tool_return_failed", "discovery_call_limit", "tool_call_limit"].includes(f))) return "TOOL_PROTOCOL";
  if (row?.failures?.includes("process_failed")) return "PROCESS";
  if (row?.failures?.includes("no_final_answer") || (row && !row.finalAnswer)) return "NO_FINAL";
  return "HARNESS";
}
export async function runAuthorityFinalizer({ resources, databasePath, meta, intentPath, deliveryDirectory,
  runtime, invoke = invokeAuthoritySession, publish }) {
  assert.ok(!existsSync(intentPath), "Retained terminal intent must be replayed without invoking the model");
  assert.equal(runtime.scheduled.runId, meta.runs.finalizer);
  assert.equal(runtime.replay.fixture.task.taskId, meta.taskId);
  assert.equal(runtime.replay.fixture.task.roomId, meta.roomId);
  publish ??= async finalAnswer => {
    const result = await childCommand(resources, "scripts/bench/authority-central.mts",
      { databasePath, mode: "final", meta, role: "finalizer", finalAnswer }, `${deliveryDirectory}-result`, { typescript: true });
    assert.equal(result.exitCode, 0, "Final Result publication did not acknowledge success");
    assert.ok(result.response?.result, "Final Result missing");
    return result.response;
  };
  let row, cause;
  try {
    row = await invoke({ ...runtime, resources });
    assert.equal(row.runId, meta.runs.finalizer);
    if (row.outcome !== "completed" || row.failures.length || !row.finalAnswer) cause = failureCause(row, runtime.signal);
    else {
      const documents = runtime.replay.documents;
      const complete = documents.every(d => row.reads.some(r => r.receipt.status === "returned" &&
        r.receipt.runId === row.runId && r.receipt.evidenceRef === d.evidenceRef && r.receipt.revision === d.revision &&
        r.receipt.contentSha256 === hash(r.content) && r.receipt.sourceContentSha256 === d.contentSha256 &&
        r.receipt.returnedRange?.start === d.allowedRange.start && r.receipt.returnedRange?.end === d.allowedRange.end &&
        !r.receipt.truncated && Date.parse(r.receipt.observedAt) <= Date.parse(row.finalAnswerAt)));
      if (!complete) cause = "EVIDENCE_INCOMPLETE";
      else {
        try { return { row, publication: await publish(row.finalAnswer), persistence: "result_proposed" }; }
        catch { cause = "PUBLICATION"; }
      }
    }
  } catch { cause = failureCause(row, runtime.signal); }
  const intent = terminalIntent(meta, "finalizer", cause);
  retainTerminalIntent(intentPath, intent);
  const closure = await replayTerminalIntent({ resources, databasePath, intentPath, deliveryDirectory });
  return { row: row ?? null, intent, closure, persistence: closure.persistence };
}
