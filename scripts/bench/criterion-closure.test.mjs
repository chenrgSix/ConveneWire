import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { evidenceToolDefinition, readEvidence, hash } from "./evidence-access-reader.mjs";
import { makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { directory, loadClosurePacket, closureInstruction, retentionOracle, parseClosureOutput, assessClosureOutput, inspectClosureRun } from "./criterion-closure.mjs";
import { assertExecutionAuthorized, assertUnconsumed, claimClosurePlan, reserveClosureSlot, verifyClosureFreeze, freezePath, reportPath } from "./criterion-closure-run.mjs";

const replay = loadClosurePacket(), reference = JSON.parse(readFileSync(`${directory}/reference.json`, "utf8"));
const refs = replay.documents.map(doc => doc.evidenceRef), keys = replay.fixture.task.criteria.map(row => row.criterionKey);
const observedAt = "2026-09-06T12:00:00.000Z", readAt = "2026-09-06T12:00:01.000Z", answerAt = "2026-09-06T12:00:02.000Z";
const closure = () => ({ criterionChecks: keys.map(criterionKey => ({ criterionKey, status: "satisfied", evidenceRefs: refs, missing: [] })) });
const answer = (arm, artifact = reference, table = closure()) =>
  (arm === "F" ? `<criterion-closure>${JSON.stringify(table)}</criterion-closure>\n` : "") + `<final-answer>${JSON.stringify(artifact)}</final-answer>`;
// Explicit authored semantic witness, not a model result or a schema-derived truth judgment.
const review = (artifact = reference) => ({ finalArtifactSha256: hash(JSON.stringify(artifact)), unsupportedAdditions: [],
  criteria: keys.map((criterionKey, i) => ({ criterionKey, status: "pass", reason: "Authored reference manually checked against visible criterion and sources.",
    quotes: [i === 0 ? '"mode":"proposal_only"' : i === 5 ? '"totals":' + JSON.stringify(artifact.totals) : i === 6 ? artifact.tests[0].expected :
      i === 7 ? '"evidenceRefs":' + JSON.stringify(artifact.decisions[0].evidenceRefs) :
        artifact.decisions.find(row => row.objectId === [null, "lime-full-04", "lime-base-01", "slate-full-02", "slate-full-05"][i]).reason] })) });
function result(slot = 1) {
  const scheduled = replay.fixture.order[slot], access = makeAccess(replay, scheduled, observedAt), finalAnswer = answer(scheduled.treatment);
  return structuredClone({ ...scheduled, observedAt, endedAt: answerAt, finalAnswerAt: answerAt, finalAnswer,
    answerSha256: hash(finalAnswer), instructionSha256: hash(closureInstruction(scheduled.treatment, replay)), requestedModel: replay.fixture.runtime.model,
    reasoningEffort: replay.fixture.runtime.reasoningEffort, outcome: "completed", turnCompleted: true, failures: [], elapsedMilliseconds: 2000,
    grant: access.control.grant, evidenceAccess: { configured: true },
    readerLifecycle: [{ stage: "tools_listed", runId: scheduled.runId, observedAt, definitionSha256: hash(JSON.stringify(evidenceToolDefinition(access.bundle))) }],
    reads: access.bundle.documents.map((doc, attempt) => readEvidence({ ...access, attempt, grant: access.control.grant,
      currentRun: access.control.run, now: readAt, call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision } } })) });
}

test("new task/source identities, visible rubric mapping and E/F parity contain no hidden answer", () => {
  assert.ok(replay.fixture.task.taskId.includes("qa076")); assert.ok(!JSON.stringify(replay.fixture).includes("windows-availability"));
  const e = closureInstruction("E", replay), f = closureInstruction("F", replay);
  assert.equal(f, e + "\n\nFull criterion closure requirement:\n" + replay.fixture.closureInstruction);
  assert.ok(!e.includes("expectedDecisions") && !f.includes("retainBytes=6300"));
  assert.ok(!e.includes('"targetClaims"') && !f.includes('"expectedDisposition"'));
  assert.deepEqual(runtimeConfig("E", "B", "C", "R", "RUN", "G"), runtimeConfig("F", "B", "C", "R", "RUN", "G"));
  const rubric = JSON.parse(readFileSync(`${directory}/scoring.json`, "utf8"));
  assert.deepEqual(rubric.criteria.map(row => row.visibleRequirement), replay.fixture.task.criteria.map(row => row.description));
  assert.ok(replay.fixture.contributions.every(row => row.kind === "authored_fixture_note_not_agent_run"));
});

test("independent reference respects all policy branches and fits common output limits", () => {
  const oracle = retentionOracle(replay);
  assert.deepEqual(oracle.totals, { retainBytes: 6300, deleteCandidateBytes: 2300, holdBytes: 2100 });
  assert.deepEqual(Object.keys(oracle.decisions).filter(id => oracle.decisions[id] === "delete_candidate"), ["lime-full-05", "slate-full-01"]);
  assert.equal(oracle.decisions["lime-base-01"], "retain"); assert.equal(oracle.decisions["slate-full-02"], "retain");
  for (const arm of ["E", "F"]) {
    const assessed = assessClosureOutput(answer(arm), arm, replay, refs, review());
    assert.equal(assessed.fullRequiredDeliverablePass, true); assert.equal(assessed.criticalCriteriaPass, true);
    assert.ok(assessed.parsed.finalArtifactBytes < replay.fixture.runtime.maximumFinalArtifactBytes / 2);
    assert.deepEqual(assessed.parsed.errors, []);
  }
});

test("schema, receipts and self-reported satisfied alone never establish semantic acceptance", () => {
  const row = inspectClosureRun(replay, result());
  assert.equal(row.commonManipulationValid, true); assert.equal(row.closureProtocol, "structurally_valid");
  assert.equal(row.fullRequiredDeliverablePass, false); assert.ok(row.assessment.criteria.every(item => item.status === "unscorable"));
  assert.equal(row.assessment.closureSemanticReview, "independent_missing_and_source_relevance_review_required");
});

test("reference policy handles strict millisecond boundary, UTC offsets, unknown verification and duplicate IDs", () => {
  const changed = structuredClone(replay), doc = changed.documents.find(doc => doc.evidenceRef === "snapshot-inventory");
  const inventory = JSON.parse(doc.content), boundary = inventory.objects.find(row => row.objectId === "slate-full-02");
  boundary.completedAt = "2026-08-30T11:59:59.999Z"; doc.content = JSON.stringify(inventory);
  assert.equal(retentionOracle(changed).decisions[boundary.objectId], "delete_candidate");
  boundary.completedAt = "2026-08-30T12:00:00Z"; doc.content = JSON.stringify(inventory);
  assert.equal(retentionOracle(changed).decisions[boundary.objectId], "retain");
  assert.deepEqual(retentionOracle(changed).heldIds, ["slate-full-05", "slate-full-06"]);
  inventory.objects.push(inventory.objects[0]); doc.content = JSON.stringify(inventory);
  assert.throws(() => retentionOracle(changed), /Duplicate inventory identity/u);
});

test("one missing object, unsafe decision, lost uncertainty or wrong total defeats full delivery", () => {
  for (const mutate of [
    artifact => { artifact.decisions.pop(); },
    artifact => { artifact.decisions.push(artifact.decisions[0]); },
    artifact => { artifact.decisions.find(row => row.objectId === "lime-base-01").decision = "delete_candidate"; },
    artifact => { artifact.decisions.find(row => row.objectId === "lime-full-06").decision = "delete_candidate"; },
    artifact => { artifact.decisions.find(row => row.objectId === "slate-full-02").decision = "delete_candidate"; },
    artifact => { artifact.unresolved.pop(); },
    artifact => { artifact.totals.retainBytes++; }
  ]) {
    const artifact = structuredClone(reference); mutate(artifact);
    const checked = assessClosureOutput(answer("F", artifact), "F", replay, refs, review(artifact));
    assert.equal(checked.fullRequiredDeliverablePass, false);
    assert.ok(checked.criterionToFinalStatus.some(row => row.comparison === "overclaimed"));
  }
});

test("eight criterion rows and named tests cannot hide incomplete regression expectations", () => {
  const artifact = structuredClone(reference); artifact.tests[0].expected = "Check it.";
  const judged = review(artifact); judged.criteria.find(row => row.criterionKey.endsWith("regressions")).status = "fail";
  const assessed = assessClosureOutput(answer("F", artifact), "F", replay, refs, judged);
  assert.equal(assessed.criticalCriteriaPass, true); assert.equal(assessed.fullRequiredDeliverablePass, false);
  assert.equal(assessed.criteria.filter(row => row.status === "pass").length, 7);
  assert.equal(assessed.criterionToFinalStatus.find(row => row.criterionKey.endsWith("regressions")).comparison, "overclaimed");
});

test("correctly preserving source unknowns can satisfy a required criterion without invented certainty", () => {
  const checked = inspectClosureRun(replay, result(), review());
  assert.equal(checked.fullRequiredDeliverablePass, true);
  assert.equal(checked.assessment.unresolvedPreservation, "pass"); assert.equal(reference.unresolved.length, 2);
  const table = closure(); table.criterionChecks[4].status = "unresolved"; table.criterionChecks[4].missing = ["Verification is missing."];
  const underclaim = assessClosureOutput(answer("F", reference, table), "F", replay, refs, review());
  assert.equal(underclaim.criterionToFinalStatus[4].comparison, "underclaimed");
});

test("missing, reordered or duplicate closure criteria and contradictory status fields fail fidelity", () => {
  for (const mutate of [
    table => { table.criterionChecks.pop(); },
    table => { table.criterionChecks.reverse(); },
    table => { table.criterionChecks[1] = table.criterionChecks[0]; },
    table => { table.criterionChecks[0].missing = ["Unfinished output"]; },
    table => { table.criterionChecks[0].status = "unresolved"; },
    table => { table.criterionChecks[0].status = "verified"; }
  ]) { const table = closure(); mutate(table); assert.ok(parseClosureOutput(answer("F", reference, table), "F", replay).errors.length > 0); }
  const reversed = `<final-answer>${JSON.stringify(reference)}</final-answer><criterion-closure>${JSON.stringify(closure())}</criterion-closure>`;
  assert.ok(parseClosureOutput(reversed, "F", replay).errors.includes("closure_not_before_final"));
  assert.ok(parseClosureOutput(answer("F"), "E", replay).errors.includes("unexpected_E_closure"));
});

test("receipt scope, bytes, ranges and time must establish current successful reads for criterion refs", () => {
  assert.equal(result().grant.authorityId, "authority_qa076_synthetic_sources_v1");
  for (const mutate of [
    row => { row.reads[0].receipt.authorityId = "authority_qa072_owner_excerpts_v1"; },
    row => { row.reads[0].receipt.runId = "another_run"; },
    row => { row.reads[0].content += "modified"; },
    row => { row.reads[0].receipt.returnedRange.end--; },
    row => { row.finalAnswerAt = observedAt; },
    row => { row.reads = []; }
  ]) {
    const row = result(); mutate(row); const checked = inspectClosureRun(replay, row, review());
    assert.equal(checked.commonManipulationValid, false); assert.equal(checked.closureProtocol, "failed");
    assert.equal(checked.fullRequiredDeliverablePass, false); assert.ok(checked.assessment.bindingErrors.length > 0);
  }
});

test("failed Runs, unsupported additions and invalid manual-review identity cannot become complete passes", () => {
  const row = result(); row.outcome = "failed";
  assert.equal(inspectClosureRun(replay, row, review()).fullRequiredDeliverablePass, false);
  const judged = review(); judged.unsupportedAdditions = [{ reason: "Synthetic negative judgment, not a real source finding.", quotes: ["proposal_only"] }];
  assert.equal(assessClosureOutput(answer("F"), "F", replay, refs, judged).fullRequiredDeliverablePass, false);
  judged.finalArtifactSha256 = "wrong";
  assert.throws(() => assessClosureOutput(answer("F"), "F", replay, refs, judged), /another artifact/u);
  const invented = review(); invented.criteria[0].quotes = ["Never supplied text"];
  assert.throws(() => assessClosureOutput(answer("F"), "F", replay, refs, invented), /Nonexistent/u);
});

test("E emitting the F table contaminates the control without deleting its final artifact", () => {
  const row = result(0); row.finalAnswer = answer("F");
  const checked = inspectClosureRun(replay, row, review());
  assert.equal(checked.commonManipulationValid, false); assert.equal(checked.closureProtocol, "unexpected");
  assert.equal(checked.assessment.fullRequiredDeliverablePass, true);
  assert.equal(checked.assessment.parsed.final.value.decisions.length, 12);
});

test("new execution budget remains zero and the live entry fails before creating a journal", async t => {
  const unauthorized = structuredClone(replay.fixture); unauthorized.authorization.state = "not_authorized"; unauthorized.authorization.maximumFinalizerInvocations = 0;
  assert.throws(() => assertExecutionAuthorized(unauthorized), /zero authorized external calls/u);
  // A later owner approval must never make this routine test start real model calls.
  if (replay.fixture.authorization.state !== "not_authorized") return;
  assert.equal(replay.fixture.authorization.maximumFinalizerInvocations, 0);
  assert.equal(existsSync(reportPath), false);
  const resources = await createTestResources(t, "convenewire-qa076-zero-budget-");
  const child = spawnTestProcess(resources, process.execPath, ["--import", "tsx", "scripts/bench/criterion-closure-run.mjs", "--execute-qa076-frozen-six"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.process.stdout.on("data", bytes => { output += bytes; }); child.process.stderr.resume();
  const terminal = await child.terminal;
  assert.notEqual(terminal.code, 0); assert.match(output, /zero authorized external calls/u);
  assert.equal(existsSync(reportPath), false);
});

test("future approved plan still has exclusive six-slot admission without retry or replacement", async t => {
  const resources = await createTestResources(t, "convenewire-qa076-admission-");
  const destination = path.join(resources.directory, "journal.json"); assertUnconsumed(destination);
  claimClosurePlan({ attempts: [] }, destination); assert.throws(() => claimClosurePlan({}, destination), /EEXIST/u);
  assert.throws(() => assertUnconsumed(destination), /consumed/u);
  const report = { attempts: [] }; assert.throws(() => reserveClosureSlot(report, 1));
  for (let slot = 0; slot < 6; slot++) reserveClosureSlot(report, slot);
  assert.throws(() => reserveClosureSlot(report, 5)); assert.throws(() => reserveClosureSlot(report, 6));
});

test("offline freeze pins current instructions, new authority and rubric without model authorization", () => {
  const historicalCommit = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")).sourceCommit : undefined;
  const { freeze } = verifyClosureFreeze(undefined, historicalCommit); assert.equal(freeze.authorizationState, replay.fixture.authorization.state);
  const changed = JSON.parse(readFileSync(freezePath, "utf8")); changed.files[0].sha256 = "wrong";
  assert.throws(() => verifyClosureFreeze(changed), /Changed frozen QA-076 file/u);
});
