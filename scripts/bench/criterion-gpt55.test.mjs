import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { loadClosurePacket, closureInstruction, inspectClosureRun } from "./criterion-closure.mjs";
import { claimClosurePlan, reserveClosureSlot } from "./criterion-closure-run.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { loadQa077, assertQa077Authorized, assertQa077Unconsumed, verifyQa077Freeze, reportPath, auditQa077 } from "./criterion-gpt55-run.mjs";

test("GPT-5.5 changes only model and fresh authorization/Run/experiment identity", () => {
  const baseline = loadClosurePacket(), { replay } = loadQa077();
  const expected = structuredClone(baseline);
  expected.fixture.identity = replay.fixture.identity; expected.fixture.order = replay.fixture.order;
  expected.fixture.authorization = replay.fixture.authorization; expected.fixture.runtime.model = "gpt-5.5";
  assert.deepEqual(replay, expected);
  for (const arm of ["E", "F"]) assert.equal(closureInstruction(arm, replay), closureInstruction(arm, baseline));
  assert.equal(replay.fixture.runtime.reasoningEffort, "low");
  assert.equal(replay.fixture.runtime.timeoutMilliseconds, 300000);
  assert.equal(replay.fixture.runtime.retries, 0);
});

test("new authorization cannot silently use another model, provider or additional slots", () => {
  const { plan } = loadQa077();
  for (const change of [p => { p.model = "gpt-5.4-mini"; }, p => { p.authorization.maximumFinalizerInvocations = 7; },
    p => { p.authorization.destination = "another provider"; }, p => { p.authorization.state = "not_authorized"; }]) {
    const modified = structuredClone(plan); change(modified); assert.throws(() => assertQa077Authorized(modified));
  }
});

test("new Run-scoped grants use identical source identities without accepting old receipts", () => {
  const { replay } = loadQa077(), scheduled = replay.fixture.order[0];
  const access = makeAccess(replay, scheduled, "2026-09-06T14:00:00Z");
  assert.equal(access.control.grant.runId, "run_qa077_retention_1");
  assert.equal(access.control.grant.experimentId, replay.fixture.identity);
  assert.equal(access.bundle.authorityId, loadClosurePacket().fixture.authorityId);
  const prior = JSON.parse(readFileSync("docs/acceptance/evidence/qa-076-criterion-closure.json", "utf8")).results[0];
  const row = { ...prior, ...scheduled, requestedModel: "gpt-5.5" };
  const checked = inspectClosureRun(replay, row);
  assert.equal(checked.setup, "failed"); assert.equal(checked.actualReaderReturns, 0);
  assert.equal(checked.counts.invalid, 4); assert.equal(checked.sourceAccessGrantValid, false);
});

test("exclusive journal and six ordered reservations reject retries, skips and extra attempts", async t => {
  const resources = await createTestResources(t, "convenewire-qa077-admission-");
  const destination = path.join(resources.directory, "journal.json"), report = { attempts: [] };
  assertQa077Unconsumed(destination); claimClosurePlan(report, destination);
  assert.throws(() => assertQa077Unconsumed(destination), /consumed/);
  assert.throws(() => claimClosurePlan(report, destination), /EEXIST/);
  assert.throws(() => reserveClosureSlot(report, 1), /skip/);
  for (let i = 0; i < 6; i++) reserveClosureSlot(report, i);
  assert.throws(() => reserveClosureSlot(report, 0), /skip/);
  assert.throws(() => reserveClosureSlot(report, 6), /cap/);
});

test("freeze retains original instructions, catalog and scoring code; consumed results audit offline", () => {
  const historical = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")).sourceCommit : undefined;
  const { freeze } = verifyQa077Freeze(undefined, historical);
  assert.equal(freeze.model, "gpt-5.5"); assert.equal(freeze.files.length, 63);
  if (existsSync(reportPath)) {
    assert.equal(auditQa077().results.length, 6);
    assert.throws(() => assertQa077Unconsumed(), /consumed/);
  }
});
