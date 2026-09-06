import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { loadReplay, renderReplay, sha256, treatmentInstruction } from "./evidence-access-replay.js";
import { claimPlan, reserveNext } from "./evidence-access-execute.js";
import { evidenceToolDefinition, readEvidence } from "./evidence-access-reader.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { blindAnswers, inspectManipulation, screenReport } from "./evidence-screening-audit.js";
import { assertQa074Unconsumed, auditQa074, freezePath, loadQa074, reportPath, verifyQa074Freeze } from "./evidence-screening.js";

const replay = loadQa074();
const observedAt = "2026-09-06T12:00:00.000Z", readAt = "2026-09-06T12:00:01.000Z", answerAt = "2026-09-06T12:00:02.000Z";
function result(slot: number, read = false) {
  const scheduled = replay.fixture.order[slot]!;
  const access = makeAccess(replay, scheduled, observedAt);
  const row: any = { ...scheduled, observedAt, endedAt: answerAt, finalAnswerAt: answerAt, finalAnswer: "Synthetic answer.",
    answerSha256: sha256("Synthetic answer."), requestedModel: replay.fixture.runtime.model, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    instructionSha256: sha256(treatmentInstruction(scheduled.treatment, replay)), outcome: "completed", turnCompleted: true, failures: [],
    elapsedMilliseconds: 2000, grant: access.control.grant, reads: [], evidenceAccess: { configured: scheduled.treatment !== "A" },
    readerLifecycle: scheduled.treatment === "A" ? [] : [{ stage: "tools_listed", runId: scheduled.runId, observedAt,
      definitionSha256: sha256(JSON.stringify(evidenceToolDefinition(access.bundle))) }] };
  if (read) row.reads = access.bundle.documents.map((doc: any) => readEvidence({ ...access,
    grant: access.control.grant, currentRun: access.control.run, now: readAt,
    call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision } } }));
  return structuredClone(row);
}

test("QA-074 preserves diagnostic bytes, freezes repaired code and executes only new ordered Run identities", () => {
  assert.equal(renderReplay(replay), renderReplay(loadReplay()));
  assert.equal(treatmentInstruction("A", replay), treatmentInstruction("B", replay));
  assert.equal(treatmentInstruction("C", replay), treatmentInstruction("A", replay) + "\n\n## Evidence-use requirement\n" + replay.fixture.useInstruction);
  const { freeze } = verifyQa074Freeze(undefined, existsSync(reportPath) ?
    JSON.parse(readFileSync(reportPath, "utf8")).sourceCommit : undefined);
  assert.ok(freeze.files.some((pin: any) => pin.path === "scripts/bench/evidence-invocation-observer.mjs"));
  assert.ok(replay.fixture.order.every(row => row.runId.includes("qa074")));
});

test("B optional no-read passes setup but no returns block semantic mechanism grading", () => {
  const report = { results: replay.fixture.order.map(row => result(row.slot)) };
  const screen = screenReport(replay, report);
  assert.equal(screen.results[1].setup, "passed"); assert.equal(screen.results[1].requiredReading, "optional");
  assert.equal(screen.exposureGate, "manipulation_failed");
  assert.equal(screen.qualityAssessment, "unscorable_manipulation_failed");
  assert.ok(blindAnswers(report, screen).every(answer => !answer.scorable));
  assert.equal(screen.comparisons.Q1.eligibleForStableInterpretation, false);
  assert.equal(screen.comparisons.Q2.eligibleForStableInterpretation, false);
});

test("C complete reading makes Q2 eligible with optional unread B, without claiming Q1 exposure", () => {
  const screen = screenReport(replay, { results: replay.fixture.order.map(row => result(row.slot, row.treatment === "C")) });
  assert.equal(screen.actualReaderReturns, 12); assert.equal(screen.exposureGate, "observed");
  assert.equal(screen.comparisons.Q1.eligibleForStableInterpretation, false);
  assert.equal(screen.comparisons.Q2.eligibleForStableInterpretation, true);
  const exposed = screenReport(replay, { results: replay.fixture.order.map(row => result(row.slot, row.treatment !== "A")) });
  assert.equal(exposed.comparisons.Q1.eligibleForStableInterpretation, true);
});

test("wrong catalog, grant, instruction, settings or baseline exposure fail setup", () => {
  for (const change of [
    (row: any) => { row.readerLifecycle = []; },
    (row: any) => { row.readerLifecycle[0].definitionSha256 = "wrong"; },
    (row: any) => { row.grant.runId = "foreign"; },
    (row: any) => { row.grant.sources[0].allowedRange.end++; },
    (row: any) => { row.instructionSha256 = "wrong"; },
    (row: any) => { row.reasoningEffort = "high"; }
  ]) { const row = result(1); change(row); assert.equal(inspectManipulation(replay, row).setup, "failed"); }
  const baseline = result(0); baseline.readerLifecycle = result(1).readerLifecycle;
  assert.equal(inspectManipulation(replay, baseline).setup, "failed");
});

test("receipt tampering cannot establish exposure", () => {
  for (const change of [
    (read: any) => { read.content += "changed"; },
    (read: any) => { read.receipt.runId = "foreign"; },
    (read: any) => { read.receipt.revision = "a".repeat(40); },
    (read: any) => { read.receipt.returnedRange.end++; },
    (read: any) => { read.receipt.observedAt = "2026-09-06T13:00:00.000Z"; }
  ]) {
    const row = result(1, true); row.reads = row.reads.slice(0, 1); change(row.reads[0]);
    const gate = inspectManipulation(replay, row);
    assert.equal(gate.actualReaderReturns, 0); assert.equal(gate.counts.invalid, 1); assert.equal(gate.setup, "failed");
  }
});

test("C full coverage joins ranges but rejects holes and returns after the answer", () => {
  const row = result(2, true), access = makeAccess(replay, row, observedAt);
  const doc = replay.documents[0]!;
  const partial = (start: number, end: number) => readEvidence({ bundle: access.bundle, grant: access.control.grant,
    currentRun: access.control.run, now: readAt, call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision, range: { start, end } } } });
  row.reads.splice(0, 1, partial(0, 100), partial(100, doc.allowedRange.end));
  assert.equal(inspectManipulation(replay, row).requiredReading, "complete");
  row.reads[1] = partial(101, doc.allowedRange.end);
  assert.equal(inspectManipulation(replay, row).requiredReading, "incomplete");
  row.reads[1] = partial(100, doc.allowedRange.end);
  row.finalAnswerAt = observedAt;
  assert.equal(inspectManipulation(replay, row).counts.beforeAnswer, 0);
  assert.equal(inspectManipulation(replay, row).requiredReading, "incomplete");
});

test("failed, missing or partially exposed repetitions are retained and prevent stable interpretation", () => {
  const report = { results: replay.fixture.order.map(row => result(row.slot, row.treatment !== "A")) };
  report.results[2].outcome = "failed"; report.results[2].finalAnswer = "";
  report.results[3].reads = [];
  const screen = screenReport(replay, report);
  assert.equal(screen.results.length, 9);
  assert.equal(screen.comparisons.Q1.eligibleForStableInterpretation, false);
  assert.equal(screen.comparisons.Q2.eligibleForStableInterpretation, false);
  assert.equal(screen.comparisons.Q1.repetitions[1].eligible, false);
  assert.ok(!blindAnswers(report, screen).find(row => row.finalAnswer === "")!.scorable);
  report.results.pop();
  assert.ok(screenReport(replay, report).comparisons.Q1.repetitions[2].reasons.includes("missing_attempt"));
});

test("fresh admission is exclusive, bounded to nine and rejects changed frozen bytes", async t => {
  const resources = await createTestResources(t, "convenewire-qa074-admission-");
  const destination = path.join(resources.directory, "journal.json");
  assertQa074Unconsumed(destination);
  claimPlan({ attempts: [] }, destination);
  assert.throws(() => assertQa074Unconsumed(destination), /QA-074 consumed/u);
  assert.throws(() => claimPlan({}, destination), /EEXIST/u);
  const journal = { attempts: [] };
  for (let slot = 0; slot < 9; slot++) reserveNext(journal, slot);
  assert.throws(() => reserveNext(journal, 8)); assert.throws(() => reserveNext(journal, 9));
  const frozen = JSON.parse(readFileSync(freezePath, "utf8")); frozen.files[0].sha256 = "wrong";
  assert.throws(() => verifyQa074Freeze(frozen), /Changed frozen QA-074 file/u);
});

test("retained QA-074 execution is auditable and consumed", { skip: !existsSync(reportPath) }, () => {
  const audit = auditQa074();
  assert.equal(audit.screening.results.length, 9);
  assert.throws(() => assertQa074Unconsumed(), /QA-074 consumed/u);
});
