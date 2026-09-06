import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createTestResources } from "../test/resources.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { evidenceToolDefinition, readEvidence } from "./evidence-access-reader.mjs";
import { packet, hash, exclusive } from "./authority-collaboration.mjs";
import { reserve, assertUnconsumed, executeExperiment, verifyFreeze, freezePath, reportPath,
  auditExperiment, gradePath, assessmentPath, assessExperiment } from "./authority-experiment.mjs";

test("one explicit twelve-session plan rejects reopening, reorder and an extra model slot", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-admission-");
  const file = path.join(resources.directory, "consumed.json"); assertUnconsumed(file); exclusive(file, {});
  assert.throws(() => assertUnconsumed(file), /consumed/);
  const report = { state: "running", attempts: [] }, p = packet();
  const meta = { runs: Object.fromEntries([...p.owners, "finalizer"].map(r => [r, `run_qa079_${r}`])) };
  assert.throws(() => reserve(report, p.schedule[1], meta));
  for (const slot of p.schedule) reserve(report, slot, meta);
  assert.throws(() => reserve(report, p.schedule[0], meta));
  assert.equal(report.attempts.length, 12);
});

async function syntheticInvoke({ replay, scheduled, instruction }) {
  const observedAt = new Date().toISOString(), access = makeAccess(replay, scheduled, observedAt);
  const reads = replay.documents.map((d, attempt) => readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: access.control.run,
    attempt, now: observedAt, call: { name: "read_evidence", arguments: { evidenceRef: d.evidenceRef, revision: d.revision } } }));
  const finalAnswer = scheduled.role === "finalizer" ? "Synthetic transport test only. No quality claim or operational approval." :
    JSON.stringify({ observations: Object.entries(JSON.parse(replay.documents[1].content).values).map(([checkId, value]) => ({ checkId, value })) });
  return { ...scheduled, observedAt, endedAt: observedAt, finalAnswerAt: observedAt, elapsedMilliseconds: 0,
    instructionSha256: hash(instruction), requestedModel: "gpt-5.5", observedProviderModel: null, reasoningEffort: "low",
    outcome: "completed", failures: [], finalAnswer, answerSha256: hash(finalAnswer), grant: access.control.grant, reads,
    readerLifecycle: [{ stage: "tools_listed", runId: scheduled.runId, definitionSha256: hash(JSON.stringify(evidenceToolDefinition(access.bundle))) }] };
}

test("synthetic full schedule exercises real Result storage, distinct source domains, restart and withheld final evidence", async t => {
  const resources = await createTestResources(t, "convene-wire-qa079-schedule-");
  const report = { state: "running", synthetic: true, identity: packet().identity, maximumSessions: 12, attempts: [], scenarios: [] }, calls = [], retained = [];
  await executeExperiment(resources, report, { invoke: async options => {
    calls.push({ role: options.scheduled.role, scenario: options.scheduled.scenario, ids: options.replay.documents.map(d => d.evidenceRef) });
    return syntheticInvoke(options);
  }, retainOwner: (owner, record) => retained.push({ owner, record }) });
  assert.equal(calls.length, 12); assert.equal(retained.length, 9);
  for (const call of calls.filter(c => c.role !== "finalizer")) {
    assert.deepEqual(call.ids, [`evidence_qa079_${call.role}_raw`, `evidence_qa079_${call.role}_local_checks`]);
  }
  const finals = calls.filter(c => c.role === "finalizer");
  assert.equal(finals[0].ids.length, 3); assert.equal(finals[1].ids.length, 3); assert.equal(finals[2].ids.length, 2);
  assert.ok(finals.every(f => f.ids.every(id => id.endsWith("_released"))));
  const resumed = report.scenarios[1], revoked = report.scenarios[2];
  assert.equal(resumed.recovery[0].modelSessionsBeforeRestart, 7); assert.equal(resumed.publications[0].replayed, true);
  assert.equal(resumed.centralSnapshot.results.length, 4); assert.equal(revoked.centralSnapshot.results.length, 3);
  assert.ok(revoked.revocation.newReleaseDenied); assert.ok(!revoked.publications.some(p => p.owner === "operations"));
  for (const token of ["QA079_CODE_PRIVATE_CANARY", "QA079_SECURITY_PRIVATE_CANARY", "QA079_OPERATIONS_PRIVATE_CANARY", "private-east-machine"]) assert.ok(!JSON.stringify(report).includes(token));
  report.state = "consumed";
  const syntheticOwners = Object.fromEntries(packet().owners.map(owner => [owner, { records: retained.filter(r => r.owner === owner).map(r => r.record) }]));
  const checked = auditExperiment({ syntheticReport: report, syntheticOwners });
  assert.equal(checked.sourceReturns, 26);
  assert.ok(checked.checks.every(c => c.completeAuthorizedReleases && c.finalReads && c.allOwnerReads));
});

test("frozen files and public/private rubric alignment remain pinned", { skip: !existsSync(freezePath) }, () => {
  verifyFreeze();
});
test("retained real outcomes, receipts and private-to-public publication can be audited offline", { skip: !existsSync(reportPath) }, () => {
  const audited = auditExperiment(); assert.ok(audited.report.attempts.length <= 12);
});
test("retained first semantic grades rejoin without replacing them or calling a grader", { skip: !existsSync(gradePath) }, () => {
  const result = assessExperiment();
  if (existsSync(assessmentPath)) assert.deepEqual(result, JSON.parse(readFileSync(assessmentPath, "utf8")));
});
