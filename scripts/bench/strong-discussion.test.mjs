import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { hash, evidenceToolDefinition, readEvidence } from "./evidence-access-reader.mjs";
import { makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { fixtureDirectory, loadStrongPacket, assertAuthorized, roleReplay, baseInstruction, sessionInstruction,
  contributionTransfer, inspectSession, reserveSession, executeSchedule, validateFirstGrades, digest, packetPath, readJson } from "./strong-discussion.mjs";
import { freezePath, reportPath, firstPath, assertUnconsumed, writeExclusive, retainIdentical, verifyStrongFreeze,
  auditStrongReport, buildStrongAssessment } from "./strong-discussion-run.mjs";

const replay = loadStrongPacket();
const reference = readFileSync(`${fixtureDirectory}/reference.md`, "utf8");

async function syntheticSession(scheduled, instruction, delay = 2) {
  const observedAt = new Date().toISOString(), selected = roleReplay(replay, scheduled.role);
  const access = makeAccess(selected, scheduled, observedAt);
  await new Promise(resolve => setTimeout(resolve, delay));
  const now = new Date().toISOString();
  const reads = selected.documents.map((doc, attempt) => readEvidence({ bundle: access.bundle, grant: access.control.grant,
    currentRun: access.control.run, call: { name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision } }, attempt, now }));
  return { ...scheduled, observedAt, endedAt: now, finalAnswerAt: now, elapsedMilliseconds: Date.parse(now) - Date.parse(observedAt),
    requestedModel: "gpt-5.5", reasoningEffort: "low", observedProviderModel: null,
    instructionSha256: hash(instruction), outcome: "completed", failures: [], turnCompleted: true,
    finalAnswer: reference, answerSha256: hash(reference), grant: access.control.grant, reads,
    readerLifecycle: [{ stage: "tools_listed", runId: scheduled.runId, observedAt,
      definitionSha256: hash(JSON.stringify(evidenceToolDefinition(access.bundle))) }] };
}

test("one new solvable packet, equal final task/source/tool input, model and comfortable output bound", () => {
  assert.equal(baseInstruction(replay, "single"), baseInstruction(replay, "finalizer"));
  assert.deepEqual(runtimeConfig("S", "B", "C", "R", "RUN", "G"), runtimeConfig("D", "B", "C", "R", "RUN", "G"));
  assert.ok(Buffer.byteLength(reference) < replay.fixture.runtime.maximumAnswerBytes);
  assert.equal(replay.fixture.sources.length, 4); assert.equal(replay.fixture.task.criteria.length, 8);
  for (const forbidden of ["reference.md", "scoring.json", "QA-076", "criterion-closure", "claim-adjudication"]) assert.ok(!baseInstruction(replay).includes(forbidden));
});

test("source partitions have the same union; current-Run grants reject foreign domains, revision and expired authority", () => {
  const scheduled = replay.fixture.sessions[1], selected = roleReplay(replay, scheduled.role);
  const access = makeAccess(selected, scheduled, "2026-09-06T16:00:00Z");
  const foreign = replay.documents[2], allowed = selected.documents[0];
  const call = doc => ({ name: "read_evidence", arguments: { evidenceRef: doc.evidenceRef, revision: doc.revision } });
  const read = (args = {}) => readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: access.control.run,
    call: call(allowed), now: "2026-09-06T16:00:01Z", ...args });
  assert.equal(read().receipt.status, "returned");
  assert.equal(read({ call: call(foreign) }).receipt.status, "denied");
  assert.equal(read({ currentRun: { ...access.control.run, runId: "run_old000000" } }).receipt.status, "denied");
  assert.equal(read({ now: "2026-09-06T16:05:00Z" }).receipt.status, "denied");
  assert.equal(read({ call: call({ ...allowed, revision: "0".repeat(40) }) }).receipt.status, "denied");
  assert.equal(read({ call: { name: "read_evidence", arguments: { evidenceRef: allowed.evidenceRef, revision: allowed.revision,
    range: { start: 0, end: allowed.allowedRange.end + 1 } } } }).receipt.status, "denied");
});

test("authorization rejects model/effort/provider/order/budget substitutions", () => {
  for (const change of [p => { p.runtime.model = "gpt-5.4-mini"; }, p => { p.runtime.reasoningEffort = "high"; },
    p => { p.authorization.destination = "other"; }, p => { p.authorization.maximumSessions = 13; },
    p => { p.runtime.retries = 1; }, p => { p.sessions.reverse(); }, p => { p.trials[0].arm = "D"; }]) {
    const p = structuredClone(replay.fixture); change(p); assert.throws(() => assertAuthorized(p));
  }
});

test("exclusive journal and ordered twelve slots cannot reopen, skip or add an attempt", async t => {
  const resources = await createTestResources(t, "convenewire-qa078-admission-");
  const file = path.join(resources.directory, "journal.json");
  assertUnconsumed(file); writeExclusive(file, {});
  assert.throws(() => assertUnconsumed(file)); assert.throws(() => writeExclusive(file, {}));
  const report = { attempts: [] };
  assert.throws(() => reserveSession(report, replay.fixture.sessions[1], replay.fixture));
  for (const scheduled of replay.fixture.sessions) reserveSession(report, scheduled, replay.fixture);
  assert.throws(() => reserveSession(report, { ...replay.fixture.sessions[11], slot: 12 }, replay.fixture));
  assert.throws(() => retainIdentical(file, { changed: true }));
});

test("receipt audit requires actual full returned bytes, current authority, catalog and pre-answer timing", async () => {
  const scheduled = replay.fixture.sessions[0], instruction = sessionInstruction(replay, scheduled);
  const original = await syntheticSession(scheduled, instruction);
  assert.equal(inspectSession(replay, original, instruction).valid, true);
  for (const change of [r => { r.reads[0].content += "extra"; }, r => { r.reads[0].receipt.runId = "run_old000000"; },
    r => { r.reads.pop(); }, r => { r.readerLifecycle = []; }, r => { r.grant.sources.pop(); },
    r => { r.finalAnswerAt = r.observedAt; }, r => { r.reads[0].receipt.returnedBytes--; },
    r => { r.instructionSha256 = "0".repeat(64); }]) {
    const row = structuredClone(original); change(row); assert.equal(inspectSession(replay, row, instruction).valid, false);
  }
});

test("two contributors overlap; barrier, fixed transfer order and six-trial isolation hold", async () => {
  const report = { attempts: [], results: [], trials: [] }, starts = [], ends = [], instructions = new Map();
  await executeSchedule(replay, report, async (scheduled, instruction) => {
    starts.push(scheduled.slot); instructions.set(scheduled.slot, instruction);
    if (scheduled.role === "contributor2") assert.ok(!ends.includes(scheduled.slot - 1));
    if (scheduled.role === "finalizer") assert.ok(ends.includes(scheduled.slot - 1) && ends.includes(scheduled.slot - 2));
    const row = await syntheticSession(scheduled, instruction, scheduled.role === "contributor1" ? 8 : 2);
    ends.push(scheduled.slot); return row;
  });
  assert.deepEqual(starts, Array.from({ length: 12 }, (_, i) => i));
  assert.equal(report.trials.length, 6); assert.equal(report.results.length, 12);
  for (const row of report.results.filter(r => r.role === "finalizer")) {
    const transfer = contributionTransfer(replay, row, report.results);
    assert.deepEqual(transfer.map(r => r.role), ["contributor1", "contributor2"]);
    assert.ok(transfer.every(r => r.text === reference && r.omittedBytes === 0));
    assert.equal(instructions.get(row.slot), sessionInstruction(replay, row, report.results));
    assert.ok(!instructions.get(row.slot).includes(`run_qa078_export_${row.slot + 2}`));
  }
  for (const role of ["single", "finalizer"]) assert.equal(baseInstruction(replay, role), baseInstruction(replay));
});

test("a failed contributor is retained; finalizer still uses its own slot and full sources", async () => {
  const report = { attempts: [], results: [], trials: [] };
  await executeSchedule(replay, report, async (scheduled, instruction) => {
    const row = await syntheticSession(scheduled, instruction);
    if (scheduled.slot === 1) Object.assign(row, { outcome: "failed", finalAnswer: "", answerSha256: hash(""), finalAnswerAt: null, failures: ["turn.failed"] });
    return row;
  });
  const final = report.results[3], transfer = contributionTransfer(replay, final, report.results);
  assert.equal(report.attempts.length, 12); assert.equal(transfer[0].text, "");
  assert.ok(transfer[0].unavailableReason); assert.equal(final.manipulation.fullSourcesBeforeAnswer.length, 4);
});

test("transfer refuses cross-trial substitution, changed hashes and oversized replies", async () => {
  const final = replay.fixture.sessions[3], rows = [];
  for (const scheduled of replay.fixture.sessions.slice(1, 3)) rows.push(await syntheticSession(scheduled, sessionInstruction(replay, scheduled)));
  assert.equal(contributionTransfer(replay, final, rows).length, 2);
  for (const change of [r => { r[0].trialId = "trial_other"; }, r => { r[0].finalAnswer += "changed"; },
    r => { r[0].finalAnswer = "x".repeat(32769); r[0].answerSha256 = hash(r[0].finalAnswer); }]) {
    const changed = structuredClone(rows); change(changed); assert.throws(() => contributionTransfer(replay, final, changed));
  }
});

test("harness interruption waits for the other contributor and never starts finalization or resumes", async () => {
  const report = { attempts: [], results: [], trials: [] }; let otherSettled = false;
  await assert.rejects(executeSchedule(replay, report, async (scheduled, instruction) => {
    if (scheduled.slot === 1) throw new Error("injected harness error");
    const row = await syntheticSession(scheduled, instruction);
    if (scheduled.slot === 2) otherSettled = true;
    return row;
  }));
  assert.equal(otherSettled, true); assert.equal(report.attempts.length, 3);
  assert.ok(!report.results.some(r => r.role === "finalizer"));
});

test("semantic grades retain disputes separately and reject fabricated quotations", () => {
  const rubric = readJson(`${fixtureDirectory}/scoring.json`);
  const blind = { answers: [{ blindId: "answer-1", answerSha256: hash(reference), delivered: true, finalAnswer: reference }] };
  const quote = "Do not release this implementation unchanged.";
  const first = { packetSha256: digest(packetPath), rubricSha256: digest(`${fixtureDirectory}/scoring.json`), answers: [{
    blindId: "answer-1", answerSha256: hash(reference), criteria: replay.fixture.task.criteria.map(c => ({ criterionKey: c.criterionKey,
      judgment: "pass", failureKind: null, quotes: [quote], evidenceRefs: [replay.fixture.sources[0].evidenceRef], rationale: "Synthetic record validation only, not an automated semantic verdict." })),
    facts: rubric.facts.map(f => ({ id: f.id, judgment: "preserved", quotes: [quote], rationale: "Synthetic record validation only." })),
    unknowns: rubric.unknowns.map(f => ({ id: f.id, judgment: "preserved", quotes: [quote], rationale: "Synthetic record validation only." })), unsupportedAdditions: [] }] };
  assert.equal(validateFirstGrades(replay, blind, first)[0].full, "pass");
  const disputed = structuredClone(first);
  Object.assign(disputed.answers[0].criteria[0], { judgment: "disputed", failureKind: "wording_ambiguity" });
  assert.equal(validateFirstGrades(replay, blind, disputed)[0].full, "disputed");
  Object.assign(disputed.answers[0].criteria[1], { judgment: "fail", failureKind: "missing_deliverable" });
  assert.equal(validateFirstGrades(replay, blind, disputed)[0].full, "fail");
  const invented = structuredClone(first); invented.answers[0].criteria[0].quotes = ["invented source-free quotation"];
  assert.throws(() => validateFirstGrades(replay, blind, invented));
});

test("committed freeze pins protocol, rubric and exact common instructions", { skip: !existsSync(freezePath) }, () => {
  const { freeze } = verifyStrongFreeze();
  assert.equal(freeze.identities.instructions.single, freeze.identities.instructions.finalizer);
  assert.equal(freeze.identities.catalogs.single, freeze.identities.catalogs.finalizer);
  assert.ok(freeze.files.some(pin => pin.path.endsWith("reference.md")));
});

test("retained model report recomputes without reopening consumed authorization", { skip: !existsSync(reportPath) }, () => {
  const { trials } = auditStrongReport(); assert.equal(trials.length, 6); assert.throws(() => assertUnconsumed());
});

test("retained first grading and arm metrics rejoin without net scoring", { skip: !existsSync(firstPath) }, () => {
  const result = buildStrongAssessment(); assert.equal(result.trials.length, 6);
  assert.equal(result.arms.S.scheduled, 3); assert.equal(result.arms.D.scheduled, 3);
  for (const row of result.trials) assert.ok(["pass", "fail", "disputed", "no_artifact"].includes(row.full));
});
