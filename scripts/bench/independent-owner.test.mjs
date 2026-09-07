import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { existsSync } from "node:fs";
import { createTestResources } from "../test/resources.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { evidenceToolDefinition, readEvidence } from "./evidence-access-reader.mjs";
import { packet, json, hash, exclusive, localVerify } from "./authority-collaboration.mjs";
import { plan, reserve, independentInstruction, gradeObservations, executeIndependent } from "./independent-owner.mjs";
import { auditIndependent, assertUnconsumed, verifyFreeze, freezePath, reportPath, gradePath, assessmentPath, assessIndependent } from "./independent-experiment.mjs";

const values = () => json(plan().scoring).knownLocalFindings;
function synthetic(options, mutate = x => x) {
  const { replay, scheduled, instruction } = options;
  const observedAt = new Date().toISOString(), access = makeAccess(replay, scheduled, observedAt);
  const reads = replay.documents.map((d, attempt) => readEvidence({ bundle: access.bundle, grant: access.control.grant,
    currentRun: access.control.run, attempt, now: observedAt,
    call: { name: "read_evidence", arguments: { evidenceRef: d.evidenceRef, revision: d.revision } } }));
  const finalAnswer = scheduled.role === "finalizer" ? "Synthetic transport only; no semantic acceptance." : JSON.stringify({
    observations: mutate(Object.entries(values()[scheduled.role]).map(([checkId, value]) => ({ checkId, value })), scheduled) });
  return { ...scheduled, observedAt, endedAt: observedAt, finalAnswerAt: observedAt, elapsedMilliseconds: 0,
    instructionSha256: hash(instruction), requestedModel: "gpt-5.5", reasoningEffort: "low", outcome: "completed", failures: [],
    finalAnswer, answerSha256: hash(finalAnswer), grant: access.control.grant, reads,
    readerLifecycle: [{ stage: "tools_listed", runId: scheduled.runId, definitionSha256: hash(JSON.stringify(evidenceToolDefinition(access.bundle))) }] };
}
function report() { return { identity: plan().identity, synthetic: true, maximumSessions: 8, state: "running", attempts: [], scenarios: [] }; }
test("one-use eight-session authorization cannot resume or add slots", async t => {
  const resources = await createTestResources(t, "convene-wire-qa081-budget-");
  const consumed = path.join(resources.directory, "consumed.json"); assertUnconsumed(consumed); exclusive(consumed, {});
  assert.throws(() => assertUnconsumed(consumed), /consumed/);
  const r = report(), meta = { runs: Object.fromEntries([...packet().owners, "finalizer"].map(o => [o, `run_test_${o}`])) };
  plan().schedule.forEach(s => assert.equal(reserve(r, meta).slot, s.slot));
  assert.throws(() => reserve(r, meta), /ceiling/); r.state = "consumed"; assert.throws(() => reserve(r, meta));
});
test("raw proposal metric separates wrong, omitted and malformed observations", () => {
  const expected = values().code, rows = Object.entries(expected).map(([checkId, value]) => ({ checkId, value }));
  rows[0].value = false; rows.pop();
  const grade = gradeObservations(JSON.stringify({ observations: rows }), "code", expected);
  assert.equal(grade.correct.length, 2); assert.deepEqual(grade.incorrect, ["code_stage_keeps_old_issuer"]);
  assert.deepEqual(grade.missing, ["code_retirement_checks_expiry"]);
  assert.equal(gradeObservations('{"observations":[],"extra":1}', "code", expected).protocolValid, false);
  assert.equal(gradeObservations("no json", "code", expected).missing.length, 4);
});
test("raw-only owners retain proposals before hidden verification; revoked Finalizer reads only released Results", async t => {
  const resources = await createTestResources(t, "convene-wire-qa081-flow-");
  const r = report(), retained = new Map(), calls = [];
  await executeIndependent(resources, r, {
    invoke: async options => {
      const { role, scenario } = options.scheduled; calls.push({ role, scenario, sources: options.replay.documents.map(d => d.evidenceRef) });
      if (role !== "finalizer") {
        assert.equal(options.replay.documents.length, 1);
        assert.equal(options.instruction, independentInstruction(role));
        assert.ok(!options.instruction.includes("local_checks"));
        assert.ok(!existsSync(path.join(options.directory, "..", "hidden-verifier")));
        // A peer source and a hidden-verifier identity are both denied by the actual reader.
        const access = makeAccess(options.replay, options.scheduled, new Date().toISOString());
        for (const evidenceRef of [`evidence_qa079_${role}_local_checks`, `evidence_qa079_${role === "code" ? "security" : "code"}_raw`]) {
          const denied = readEvidence({ bundle: access.bundle, grant: access.control.grant, currentRun: access.control.run, attempt: 0,
            call: { name: "read_evidence", arguments: { evidenceRef, revision: "0".repeat(40) } } });
          assert.notEqual(denied.receipt.status, "returned");
        }
      }
      return synthetic(options);
    },
    retain: (kind, scenario, owner, value) => {
      const key = `${kind}/${scenario}/${owner}`; assert.ok(!retained.has(key)); retained.set(key, structuredClone(value));
    },
    verify: async (resources, meta, owner, directory) => {
      const scenario = meta.scenario.replace("qa081_", "");
      assert.ok(retained.has(`proposal/${scenario}/${owner}`));
      return localVerify(resources, meta, owner, directory);
    }
  });
  assert.equal(calls.length, 8); assert.equal(retained.size, 12);
  assert.deepEqual(calls.filter(c => c.role === "finalizer").map(c => c.sources.length), [3, 2]);
  assert.deepEqual(r.scenarios.map(s => s.centralSnapshot.results.length), [4, 3]);
  r.state = "consumed";
  const audited = auditIndependent({ report: r, synthetic: true, getPrivate: (k, s, o) => retained.get(`${k}/${s}/${o}`) });
  assert.deepEqual(audited.findings.map(s => s.sourceReturns), [6, 5]);
  assert.ok(audited.findings.every(s => s.finalReads && s.persistence === "result_proposed"));
});
test("wrong original values reject the whole release; omitted values remain absent; no model repair", async t => {
  const resources = await createTestResources(t, "convene-wire-qa081-negative-");
  const r = report(); let calls = 0;
  await executeIndependent(resources, r, { invoke: async options => {
    calls++;
    return synthetic(options, (rows, scheduled) => {
      if (scheduled.role === "code") rows[0].value = false;
      if (scheduled.role === "security") rows.pop();
      return rows;
    });
  } });
  assert.equal(calls, 8);
  for (const s of r.scenarios) {
    assert.ok(!s.publications.some(p => p.owner === "code"));
    assert.equal(s.publications.find(p => p.owner === "security").release.body.observations.length, 4);
    assert.ok(s.owners.find(o => o.owner === "code" && o.closure)?.closure.runState === "failed");
    assert.ok(s.statuses.find(o => o.owner === "security").missingObservations.includes("policy_rollback_requires_old_trust_and_validity"));
  }
});
test("frozen QA-081 code and recipe remain pinned", { skip: !existsSync(freezePath) }, () => verifyFreeze());
test("retained independent observations and real Results audit without model calls", { skip: !existsSync(reportPath) }, () => auditIndependent());

test("immutable first grades retain exact quotes and separate acceptance metrics", { skip: !existsSync(gradePath) }, () => {
  const result = assessIndependent();
  if (existsSync(assessmentPath)) assert.deepEqual(result, json(assessmentPath));
});
