import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { claimPlan } from "./evidence-access-execute.js";
import { evidenceToolDefinition, readEvidence } from "./evidence-access-reader.mjs";
import { makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { sha256, loadReplay, renderReplay } from "./evidence-access-replay.js";
import { loadQa075, instruction, parseArtifacts, inspectQa075, screenQa075, blindQa075 } from "./claim-adjudication-audit.js";
import { assertQa075Unconsumed, reserveSix, verifyQa075Freeze, auditQa075, freezePath, reportPath } from "./claim-adjudication.js";

const replay = loadQa075(), targets = replay.adjudication.targetClaims;
const observedAt = "2026-09-06T12:00:00.000Z", readAt = "2026-09-06T12:00:01.000Z", answerAt = "2026-09-06T12:00:02.000Z";
const table = () => ({ criterionChecks: targets.map((target, i) => ({ ...target,
  evidenceRefs: i === 0 ? ["windows-availability"] : ["windows-enrollment", "windows-console-preflight", "windows-availability"],
  disposition: i === 0 ? "contradicted" : "supported" })), unresolved: [] });
function answer(value = table(), diagnosis = "The complete helper body requires a regular file and Unix execute bits. CLI independently rejects missing bits; Console uses the helper before probing.") {
  return `<claim-disposition>${JSON.stringify(value)}</claim-disposition>\n<final-answer>${diagnosis}</final-answer>`;
}
function result(slot: number, read = true) {
  const scheduled = replay.adjudication.order[slot]!, access = makeAccess(replay, scheduled, observedAt);
  const finalAnswer = scheduled.treatment === "D" ? answer() : "<final-answer>Synthetic diagnosis.</final-answer>";
  const row: any = { ...scheduled, observedAt, endedAt: answerAt, finalAnswerAt: answerAt, finalAnswer,
    answerSha256: sha256(finalAnswer), requestedModel: replay.fixture.runtime.model, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    instructionSha256: sha256(instruction(scheduled.treatment, replay)), outcome: "completed", turnCompleted: true, failures: [],
    elapsedMilliseconds: 2000, grant: access.control.grant, reads: [], evidenceAccess: { configured: true },
    readerLifecycle: [{ stage: "tools_listed", runId: scheduled.runId, observedAt,
      definitionSha256: sha256(JSON.stringify(evidenceToolDefinition(access.bundle))) }] };
  if (read) row.reads = access.bundle.documents.map((doc: any) => readEvidence({ ...access, grant: access.control.grant,
    currentRun: access.control.run, now: readAt, call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision } } }));
  return structuredClone(row);
}

test("C/D share original diagnostic bytes, common targets, use rule, source catalog and runtime settings", () => {
  assert.equal(renderReplay(replay), renderReplay(loadReplay()));
  assert.equal(instruction("D", replay), instruction("C", replay) + "\n\n## Claim disposition requirement\n" + replay.adjudication.adjudicationInstruction);
  for (const target of targets) assert.ok(instruction("C", replay).includes(target.claim));
  assert.deepEqual(runtimeConfig("C", "B", "C", "R", "RUN", "G"), runtimeConfig("D", "B", "C", "R", "RUN", "G"));
  const c = makeAccess(replay, replay.adjudication.order[0], observedAt), d = makeAccess(replay, replay.adjudication.order[1], observedAt);
  assert.deepEqual(evidenceToolDefinition(c.bundle), evidenceToolDefinition(d.bundle));
  assert.equal(replay.fixture.runtime.maximumFinalizerInvocations, 6);
  assert.ok(!instruction("D", replay).includes("expectedDisposition"));
});

test("valid D table binds two frozen targets to complete successful current-Run source returns", () => {
  const check = inspectQa075(replay, result(1));
  assert.equal(check.commonValid, true); assert.equal(check.dispositionProtocol, "structurally_valid");
  assert.equal(check.actualReaderReturns, 4); assert.equal(check.semanticConsistency, "requires_frozen_rubric_review");
  assert.equal(inspectQa075(replay, result(0)).dispositionProtocol, "not_required");
});

test("malformed tables, duplicate or missing targets, altered claims and extra fields fail deterministically", () => {
  for (const mutate of [
    (value: any) => { value.criterionChecks.pop(); },
    (value: any) => { value.criterionChecks[1] = value.criterionChecks[0]; },
    (value: any) => { value.criterionChecks[0].claim = "Another proposition"; },
    (value: any) => { value.criterionChecks[0].criterionKey = "criterion_qa072_2"; },
    (value: any) => { value.criterionChecks[0].disposition = "verified"; },
    (value: any) => { value.criterionChecks[0].reasoning = "private derivation"; },
    (value: any) => { value.criterionChecks[0].evidenceRefs = []; },
    (value: any) => { value.criterionChecks[0].evidenceRefs = ["unknown"]; }
  ]) { const value = table(); mutate(value); assert.ok(parseArtifacts(answer(value), "D", targets).errors.length > 0); }
  assert.ok(parseArtifacts(answer().replace('"criterionChecks"', 'invalid'), "D", targets).errors.includes("invalid_disposition_json"));
});

test("unresolved list must exactly match verdicts and output order cannot be repaired after the fact", () => {
  const value: any = table(); value.criterionChecks[0].disposition = "unresolved";
  assert.ok(parseArtifacts(answer(value), "D", targets).errors.includes("unresolved_list_mismatch"));
  value.unresolved = [targets[0].claimId]; assert.deepEqual(parseArtifacts(answer(value), "D", targets).errors, []);
  const text = `<final-answer>diagnosis</final-answer><claim-disposition>${JSON.stringify(table())}</claim-disposition>`;
  assert.ok(parseArtifacts(text, "D", targets).errors.includes("disposition_not_before_final"));
  assert.ok(parseArtifacts(answer() + "<final-answer>second</final-answer>", "D", targets).errors.includes("missing_or_malformed_final_block"));
  assert.ok(parseArtifacts(answer(), "C", targets).errors.includes("unexpected_C_disposition"));
});

test("foreign Run, revision, bytes, missing sources or late returns cannot bind a target", () => {
  for (const mutate of [
    (row: any) => { row.reads[1].receipt.runId = "foreign"; },
    (row: any) => { row.reads[1].receipt.revision = "a".repeat(40); },
    (row: any) => { row.reads[1].content += "changed"; },
    (row: any) => { row.reads.splice(1, 1); },
    (row: any) => { row.finalAnswerAt = observedAt; }
  ]) {
    const row = result(1); mutate(row);
    const checked = inspectQa075(replay, row);
    assert.equal(checked.dispositionProtocol, "failed"); assert.ok(checked.bindingErrors.length > 0);
  }
  assert.equal(inspectQa075(replay, result(1, false)).commonValid, false);
});

test("full reading accepts joined ranges but not holes or an unauthorized grant", () => {
  const row = result(1), access = makeAccess(replay, row, observedAt), doc = replay.documents[0];
  const partial = (start: number, end: number) => readEvidence({ ...access, grant: access.control.grant, currentRun: access.control.run,
    now: readAt, call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision, range: { start, end } } } });
  row.reads.splice(0, 1, partial(0, 100), partial(100, doc.allowedRange.end));
  assert.equal(inspectQa075(replay, row).commonValid, true);
  row.reads[1] = partial(101, doc.allowedRange.end); assert.equal(inspectQa075(replay, row).commonValid, false);
  const invalid = result(1); invalid.grant.sources[0].allowedRange.end++;
  assert.equal(inspectQa075(replay, invalid).setup, "failed");
});

test("schema-valid contradictory finals remain retained for semantic scoring, never excluded as successes", () => {
  const rows = replay.adjudication.order.map(row => result(row.slot));
  rows[1].finalAnswer = answer(table(), "The executableAvailable body is absent, so its Windows behavior remains unknown.");
  const screen = screenQa075(replay, { results: rows });
  assert.equal(screen.results.length, 6); assert.equal(screen.allCommonChecksPassed, true);
  assert.equal(screen.results[1].dispositionProtocol, "structurally_valid");
  assert.equal(screen.results[1].semanticConsistency, "requires_frozen_rubric_review");
  assert.ok(blindQa075(screen).some(row => row.finalDiagnosis.includes("body is absent") && row.scorable));
});

test("table failure does not erase a delivered diagnosis; failed Runs and missing repetitions stay visible", () => {
  const rows = replay.adjudication.order.map(row => result(row.slot));
  rows[1].finalAnswer = "<final-answer>Delivered without table.</final-answer>";
  rows[2].outcome = "failed"; rows[2].finalAnswer = "";
  const screen = screenQa075(replay, { results: rows });
  assert.equal(screen.results.length, 6); assert.equal(screen.allCommonChecksPassed, false);
  assert.equal(screen.results[1].dispositionProtocol, "failed");
  assert.ok(blindQa075(screen).find(row => row.finalDiagnosis === "Delivered without table.")!.scorable);
  assert.equal(blindQa075(screen).filter(row => row.scorable).length, 5);
  rows.pop(); assert.equal(screenQa075(replay, { results: rows }).repetitions[2].commonComparisonValid, false);
});

test("diagnosis-only exports remove table, treatment and assessment and count table overhead separately", () => {
  const parsed = parseArtifacts(answer() + '<agentroom-assessment>{"x":"extra"}</agentroom-assessment>', "D", targets);
  assert.ok(parsed.dispositionBytes > 0 && parsed.terminalBytes > parsed.diagnosisBytes + parsed.dispositionBytes);
  const blind = blindQa075(screenQa075(replay, { results: [result(1)] }))[0];
  assert.deepEqual(Object.keys(blind), ["blindId", "diagnosisSha256", "scorable", "finalDiagnosis"]);
  assert.ok(!blind.finalDiagnosis.includes("criterionChecks"));
});

test("QA-075 admission is exclusive and capped at six, including reservation failures", async t => {
  const resources = await createTestResources(t, "convenewire-qa075-admission-");
  const destination = path.join(resources.directory, "journal.json");
  assertQa075Unconsumed(destination); claimPlan({ attempts: [] }, destination);
  assert.throws(() => assertQa075Unconsumed(destination), /QA-075 consumed/u);
  assert.throws(() => claimPlan({}, destination), /EEXIST/u);
  const report = { attempts: [] };
  assert.throws(() => reserveSix(report, 1));
  for (let slot = 0; slot < 6; slot++) reserveSix(report, slot);
  assert.throws(() => reserveSix(report, 5)); assert.throws(() => reserveSix(report, 6));
});

test("freeze rejects changed bytes and pins both treatment instructions through the fixture", () => {
  verifyQa075Freeze(undefined, existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")).sourceCommit : undefined);
  const frozen = JSON.parse(readFileSync(freezePath, "utf8")); frozen.files[0].sha256 = "wrong";
  assert.throws(() => verifyQa075Freeze(frozen), /Changed frozen QA-075 file/u);
});

test("retained six-session experiment can be recomputed but never restarted", { skip: !existsSync(reportPath) }, () => {
  const audit = auditQa075(); assert.equal(audit.screening.results.length, 6);
  assert.throws(() => assertQa075Unconsumed(), /QA-075 consumed/u);
});
