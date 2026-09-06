import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { hash, evidenceToolDefinition } from "./evidence-access-reader.mjs";
import { invokeFinalizer, runtimeConfig, makeAccess } from "./evidence-access-runtime.mjs";
import { loadClosurePacket, closureInstruction, inspectClosureRun, packetPath } from "./criterion-closure.mjs";
import { claimClosurePlan, reserveClosureSlot } from "./criterion-closure-run.mjs";

export const planPath = "docs/acceptance/fixtures/qa-077/plan.json";
export const freezePath = "docs/acceptance/fixtures/qa-077/freeze.json";
export const reportPath = "docs/acceptance/evidence/qa-077-gpt55-criterion-closure.json";
const baselineFreezePath = "docs/acceptance/fixtures/qa-076/freeze.json";
const read = file => JSON.parse(readFileSync(file, "utf8"));
const digest = file => hash(readFileSync(file));

export function assertQa077Authorized(plan) {
  assert.equal(plan.identity, "qa-077-retention-gpt55-v1");
  assert.equal(plan.model, "gpt-5.5", "No model substitution");
  assert.equal(plan.authorization.state, "authorized", "QA-077 Owner authorization required");
  assert.equal(plan.authorization.maximumFinalizerInvocations, 6);
  assert.equal(plan.authorization.approvedBy, "Owner");
  assert.equal(plan.authorization.approvalText, "你把模型换成5.5测");
  assert.ok(Number.isFinite(Date.parse(plan.authorization.approvedAt)));
  assert.equal(plan.authorization.destination, loadClosurePacket().fixture.proposedDestination);
}

export function assertQa077Unconsumed(destination = reportPath) {
  assert.ok(!existsSync(destination), "QA-077 consumed; no retry, replacement or resume");
}

export function loadQa077() {
  const plan = read(planPath), baseline = loadClosurePacket();
  assert.equal(plan.baselinePacketSha256, digest(packetPath));
  assert.equal(plan.baselineFreezeSha256, digest(baselineFreezePath));
  assertQa077Authorized(plan);
  assert.deepEqual(plan.order, ["E", "F", "F", "E", "E", "F"].map((treatment, slot) =>
    ({ slot, treatment, repetition: Math.floor(slot / 2) + 1, runId: `run_qa077_retention_${slot + 1}` })));
  const replay = structuredClone(baseline);
  Object.assign(replay.fixture, { identity: plan.identity, order: plan.order, authorization: plan.authorization });
  replay.fixture.runtime.model = plan.model;
  for (const arm of ["E", "F"]) assert.equal(closureInstruction(arm, replay), closureInstruction(arm, baseline));
  return { plan, replay };
}

function configIdentity() {
  return Object.fromEntries(["E", "F"].map(arm => [arm,
    hash(JSON.stringify(runtimeConfig(arm, "BUNDLE", "CONTROL", "RECEIPTS", "RUN", "GRANT")))]));
}
function catalogIdentity(replay) {
  return hash(JSON.stringify(evidenceToolDefinition(makeAccess(replay, replay.fixture.order[0], "2026-09-06T00:00:00.000Z").bundle)));
}

export function verifyQa077Freeze(freeze = read(freezePath), historicalCommit) {
  for (const pin of freeze.files) {
    const bytes = historicalCommit ? execFileSync("git", ["show", `${historicalCommit}:${pin.path}`]) : readFileSync(pin.path);
    assert.equal(hash(bytes), pin.sha256, `Changed QA-077 frozen file: ${pin.path}`);
    if (historicalCommit && pin.path.startsWith("docs/")) assert.equal(digest(pin.path), pin.sha256);
  }
  const loaded = loadQa077(), prior = read(baselineFreezePath);
  assert.equal(freeze.identity, loaded.plan.identity); assert.equal(freeze.model, "gpt-5.5");
  assert.equal(freeze.planSha256, digest(planPath));
  assert.deepEqual(freeze.configSha256, configIdentity());
  assert.deepEqual(freeze.configSha256, prior.configSha256);
  assert.equal(freeze.catalogDefinitionSha256, catalogIdentity(loaded.replay));
  assert.equal(freeze.catalogDefinitionSha256, prior.catalogDefinitionSha256);
  assert.deepEqual(freeze.instructionSha256, prior.instructionSha256);
  for (const arm of ["E", "F"]) assert.equal(hash(closureInstruction(arm, loaded.replay)), freeze.instructionSha256[arm]);
  return { ...loaded, freeze };
}

if (process.argv.includes("--freeze-qa077")) {
  assertQa077Unconsumed(); const { plan, replay } = loadQa077(), prior = read(baselineFreezePath);
  // Only npm test/entry registrations changed after QA-076; dependencies and runtime bytes must match.
  for (const pin of prior.files) {
    if (pin.path !== "package.json") assert.equal(digest(pin.path), pin.sha256, pin.path);
    else {
      const commit = read("docs/acceptance/evidence/qa-076-criterion-closure.json").sourceCommit;
      const oldBytes = execFileSync("git", ["show", `${commit}:package.json`]); assert.equal(hash(oldBytes), pin.sha256);
      const oldPackage = JSON.parse(oldBytes), currentPackage = read("package.json");
      const allowed = ["test:discussion-criterion-closure", "test:discussion-gpt55", "bench:discussion-gpt55"];
      for (const value of [oldPackage, currentPackage]) for (const key of allowed) delete value.scripts[key];
      assert.deepEqual(currentPackage, oldPackage, "Only dedicated QA command registrations may change");
    }
  }
  const files = [...prior.files.map(pin => ({ ...pin, sha256: digest(pin.path) })), ...[baselineFreezePath, planPath, "scripts/bench/criterion-gpt55-run.mjs",
    "scripts/bench/criterion-gpt55.test.mjs", "docs/adr/0051-repeat-criterion-screening-with-gpt55.md"]
    .map(file => ({ path: file, sha256: digest(file) }))];
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const runtime = { executableSha256: digest(executable),
    version: execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), nodeVersion: process.version };
  const freeze = { version: 1, identity: plan.identity, frozenAt: new Date().toISOString(), model: plan.model,
    planSha256: digest(planPath), runtime, cliMatchesQa076: JSON.stringify(runtime) === JSON.stringify(prior.runtime),
    instructionSha256: Object.fromEntries(["E", "F"].map(arm => [arm, hash(closureInstruction(arm, replay))])),
    configSha256: configIdentity(), catalogDefinitionSha256: catalogIdentity(replay), files };
  writeFileSync(freezePath, JSON.stringify(freeze, null, 2) + "\n"); verifyQa077Freeze();
  process.stdout.write(`QA-077 frozen: ${files.length} pins; CLI matches QA-076=${freeze.cliMatchesQa076}; no model invocation.\n`);
}

if (process.argv.includes("--execute-qa077-frozen-six")) test("QA-077 authorized GPT-5.5 six-session plan", { timeout: 1_890_000 }, async t => {
  loadQa077(); assertQa077Unconsumed(); const { replay, freeze } = verifyQa077Freeze();
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit freeze before startup");
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(digest(executable), freeze.runtime.executableSha256); assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa077-live-");
  const report = { version: 1, identity: replay.fixture.identity, planSha256: digest(planPath), freezeSha256: digest(freezePath),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runtimeVersion: freeze.runtime.version,
    maximumFinalizerInvocations: 6, state: "executing", attempts: [], results: [], error: null };
  claimClosurePlan(report, reportPath);
  const persist = () => { writeFileSync(`${reportPath}.pending`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); renameSync(`${reportPath}.pending`, reportPath); };
  try {
    for (const scheduled of replay.fixture.order) {
      verifyQa077Freeze(freeze); assert.equal(digest(executable), freeze.runtime.executableSha256);
      reserveClosureSlot(report, scheduled.slot); Object.assign(report.attempts[scheduled.slot], scheduled, { reservedAt: new Date().toISOString() }); persist();
      const directory = path.join(resources.directory, `invocation-${scheduled.slot}`); mkdirSync(directory);
      const result = await invokeFinalizer({ resources, replay, scheduled, executable, directory,
        instruction: closureInstruction(scheduled.treatment, replay),
        onProgress: partial => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      result.screening = inspectClosureRun(replay, result);
      report.results.push(result); report.attempts[scheduled.slot].state = "terminal"; delete report.attempts[scheduled.slot].partial; persist();
      process.stdout.write(`QA-077 ${scheduled.slot + 1}/6 ${scheduled.treatment}: ${result.outcome}, reads=${result.screening.actualReaderReturns}; semantic review pending\n`);
    }
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots";
    report.error = "Interrupted or failed harness; no retry, replacement or same-plan resume.";
    throw new Error(report.error);
  } finally { persist(); }
});

export function auditQa077() {
  const report = read(reportPath);
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u);
  const { replay, freeze } = verifyQa077Freeze(undefined, report.sourceCommit);
  assert.equal(report.identity, replay.fixture.identity); assert.equal(report.planSha256, digest(planPath));
  assert.equal(report.freezeSha256, digest(freezePath)); assert.equal(report.runtimeVersion, freeze.runtime.version);
  assert.equal(report.maximumFinalizerInvocations, 6); assert.equal(report.state, "consumed");
  assert.equal(report.results.length, 6); assert.equal(report.attempts.length, 6);
  const results = report.results.map((row, slot) => {
    for (const key of ["slot", "runId", "treatment", "repetition"]) {
      assert.equal(row[key], replay.fixture.order[slot][key]); assert.equal(report.attempts[slot][key], row[key]);
    }
    assert.equal(report.attempts[slot].state, "terminal");
    assert.ok(Date.parse(report.attempts[slot].reservedAt) <= Date.parse(row.observedAt));
    assert.equal(row.requestedModel, "gpt-5.5"); assert.equal(row.reasoningEffort, "low");
    assert.equal(row.answerSha256, hash(row.finalAnswer));
    const checked = inspectClosureRun(replay, row); assert.deepEqual(checked, row.screening); return checked;
  });
  return { reportSha256: digest(reportPath), results };
}

if (process.argv.includes("--audit-qa077")) {
  const audit = auditQa077();
  const answers = [...audit.results].sort((a, b) => a.assessment.parsed.finalArtifactSha256.localeCompare(b.assessment.parsed.finalArtifactSha256) || a.slot - b.slot)
    .map((row, index) => ({ blindId: `answer-${index + 1}`, finalArtifactSha256: row.assessment.parsed.finalArtifactSha256,
      delivered: row.delivered, finalArtifact: row.assessment.parsed.final.raw }));
  const destination = "docs/acceptance/evidence/qa-077-final-only.json";
  const content = JSON.stringify({ reportSha256: audit.reportSha256, answers }, null, 2) + "\n";
  if (existsSync(destination)) assert.equal(readFileSync(destination, "utf8"), content);
  else writeFileSync(destination, content, { flag: "wx" });
  process.stdout.write("QA-077 audited; final-only export ready. Persist first judgments before unmasking tables.\n");
}
