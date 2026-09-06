// One new owner-authorized plan. The retained journal is its non-reusable admission fence.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { fixturePath, loadReplay, renderReplay, sha256, treatmentInstruction } from "./evidence-access-replay.js";
import { invokeFinalizer } from "./evidence-access-runtime.mjs";

export const lockPath = "docs/acceptance/fixtures/qa-072-freeze.json";
export const reportPath = "docs/acceptance/evidence/qa-072-access-use-2026-09-06.json";
export function verifyFreeze(frozen = JSON.parse(readFileSync(lockPath, "utf8"))) {
  for (const pin of frozen.files) assert.equal(sha256(readFileSync(pin.path)), pin.sha256, `Changed frozen file: ${pin.path}`);
  const replay = loadReplay();
  assert.equal(sha256(renderReplay(replay)), frozen.baseInstructionSha256);
  assert.deepEqual(replay.fixture.order.map(({ treatment }) => treatment), ["A", "B", "C", "B", "C", "A", "C", "A", "B"]);
  assert.equal(replay.fixture.runtime.maximumFinalizerInvocations, 9);
  assert.equal(new Set(replay.fixture.order.map(({ runId }) => runId)).size, 9);
  return { frozen, replay };
}
export function claimPlan(report: unknown, destination = reportPath) {
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export function reserveNext(report: { attempts: Array<{ slot: number; state: string }> }, slot: number) {
  assert.equal(slot, report.attempts.length, "No retry, skip or reorder");
  assert.ok(slot < 9, "Nine invocation cap reached");
  report.attempts.push({ slot, state: "reserved" });
}

if (process.argv.includes("--execute-qa072-frozen-nine")) test("QA-072 bounded nine-Finalizer experiment", { timeout: 2_790_000 }, async t => {
  const { frozen, replay } = verifyFreeze();
  assert.equal(replay.fixture.authorization, "owner-authorized-nine-finalizer-invocations");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit and validate inputs first");
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(sha256(readFileSync(executable)), frozen.runtime.executableSha256);
  assert.equal(execFileSync(executable, ["--version"], { encoding: "utf8" }).trim(), frozen.runtime.version);
  assert.equal(process.version, frozen.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa072-live-");
  const report: any = { version: 1, identity: replay.fixture.identity, fixturePath,
    fixtureSha256: sha256(readFileSync(fixturePath)), freezeSha256: sha256(readFileSync(lockPath)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    requestedModel: replay.fixture.runtime.model, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    observedProviderModel: null, runtimeVersion: frozen.runtime.version,
    state: "executing", maximumFinalizerInvocations: 9, attempts: [], results: [], error: null };
  // The fence is retained outside the temporary root. Even an interrupted phase cannot replay it.
  claimPlan(report);
  const persist = () => {
    const pending = `${reportPath}.pending`;
    writeFileSync(pending, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    renameSync(pending, reportPath);
  };
  try {
    for (const scheduled of replay.fixture.order) {
      reserveNext(report, scheduled.slot);
      Object.assign(report.attempts[scheduled.slot], scheduled, { reservedAt: new Date().toISOString() });
      persist(); // Provider start can never precede durable reservation.
      const directory = path.join(resources.directory, `invocation-${scheduled.slot}`);
      mkdirSync(directory);
      const result = await invokeFinalizer({ resources, replay, scheduled, executable,
        directory, instruction: treatmentInstruction(scheduled.treatment, replay),
        onProgress: (partial: unknown) => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      report.results.push(result);
      report.attempts[scheduled.slot].state = "terminal";
      delete report.attempts[scheduled.slot].partial;
      persist();
      process.stdout.write(`QA-072 slot ${scheduled.slot + 1}/9 ${scheduled.treatment}: ${result.outcome}, ${result.reads.length} reads, ${result.elapsedMilliseconds} ms\n`);
    }
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots";
    report.error = "Harness interrupted or failed; no automatic retry or resume. Reserved slots remain consumed.";
    throw new Error(report.error);
  } finally { persist(); }
});
