// New QA-076 plan only. Offline preparation does not authorize model startup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { evidenceToolDefinition, hash } from "./evidence-access-reader.mjs";
import { invokeFinalizer, makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { directory, packetPath, loadClosurePacket, closureInstruction, retentionOracle, inspectClosureRun } from "./criterion-closure.mjs";

export const freezePath = `${directory}/freeze.json`;
export const reportPath = "docs/acceptance/evidence/qa-076-criterion-closure.json";
const read = file => JSON.parse(readFileSync(file, "utf8"));
export function assertExecutionAuthorized(fixture) {
  const a = fixture.authorization;
  assert.equal(a.state, "authorized", "QA-076 has zero authorized external calls; Owner approval of the concrete six-session plan is required");
  assert.equal(a.maximumFinalizerInvocations, 6); assert.equal(fixture.runtime.maximumFinalizerInvocations, 6);
  assert.equal(a.approvedBy, "Owner"); assert.ok(Number.isFinite(Date.parse(a.approvedAt)));
  assert.ok(typeof a.approvalText === "string" && a.approvalText.trim());
  assert.equal(a.destination, fixture.proposedDestination);
}
export function assertUnconsumed(destination = reportPath) {
  assert.ok(!existsSync(destination), "QA-076 consumed; no retry, replacement or same-plan resume");
}
export function claimClosurePlan(report, destination = reportPath) {
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export function reserveClosureSlot(report, slot) {
  assert.equal(slot, report.attempts.length, "No skip, retry or reorder");
  assert.ok(Number.isInteger(slot) && slot >= 0 && slot < 6, "Six invocation cap");
  report.attempts.push({ slot, state: "reserved" });
}
function configIdentity() {
  return Object.fromEntries(["E", "F"].map(arm => [arm, hash(JSON.stringify(runtimeConfig(arm, "BUNDLE", "CONTROL", "RECEIPTS", "RUN", "GRANT")))]));
}
function catalogIdentity(replay) {
  return hash(JSON.stringify(evidenceToolDefinition(makeAccess(replay, replay.fixture.order[0], "2026-09-06T00:00:00.000Z").bundle)));
}
export function verifyClosureFreeze(freeze = read(freezePath), historicalCommit) {
  for (const pin of freeze.files) {
    const bytes = historicalCommit ? execFileSync("git", ["show", `${historicalCommit}:${pin.path}`]) : readFileSync(pin.path);
    assert.equal(hash(bytes), pin.sha256, `Changed frozen QA-076 file: ${pin.path}`);
    if (historicalCommit && pin.path.startsWith("docs/")) assert.equal(hash(readFileSync(pin.path)), pin.sha256);
  }
  const replay = loadClosurePacket();
  assert.equal(freeze.identity, replay.fixture.identity);
  assert.deepEqual(freeze.configSha256, configIdentity());
  assert.equal(freeze.configSha256.E, freeze.configSha256.F);
  assert.equal(freeze.catalogDefinitionSha256, catalogIdentity(replay));
  for (const arm of ["E", "F"]) {
    assert.equal(hash(closureInstruction(arm, replay)), freeze.instructionSha256[arm]);
    assert.equal(readFileSync(`${directory}/${arm === "E" ? "base" : "F"}-instruction.txt`, "utf8"), closureInstruction(arm, replay));
  }
  const rubric = read(`${directory}/scoring.json`), oracle = retentionOracle(replay);
  assert.deepEqual(rubric.criteria.map(row => [row.criterionKey, row.visibleRequirement]), replay.fixture.task.criteria.map(row => [row.criterionKey, row.description]));
  assert.deepEqual(rubric.expectedDecisions, oracle.decisions); assert.deepEqual(rubric.expectedTotals, oracle.totals);
  assert.deepEqual(rubric.expectedUnresolved, oracle.heldIds);
  return { replay, freeze };
}

if (process.argv.includes("--freeze-qa076")) {
  assertUnconsumed(); const replay = loadClosurePacket();
  for (const arm of ["E", "F"]) writeFileSync(`${directory}/${arm === "E" ? "base" : "F"}-instruction.txt`, closureInstruction(arm, replay));
  const prior = read("docs/acceptance/fixtures/qa-075-freeze.json");
  const files = [...new Set([...prior.files.map(pin => pin.path), packetPath, ...replay.fixture.sources.map(source => source.path),
    ...["final.schema.json", "closure.schema.json", "scoring.json", "reference.json", "base-instruction.txt", "F-instruction.txt"].map(file => `${directory}/${file}`),
    "scripts/bench/criterion-closure.mjs", "scripts/bench/criterion-closure-run.mjs", "scripts/bench/criterion-closure.test.mjs",
    "docs/adr/0050-screen-full-criterion-closure.md"])];
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const freeze = { version: 1, identity: replay.fixture.identity, frozenAt: new Date().toISOString(),
    authorizationState: replay.fixture.authorization.state,
    runtime: { executableSha256: hash(readFileSync(executable)), version: execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), nodeVersion: process.version },
    instructionSha256: Object.fromEntries(["E", "F"].map(arm => [arm, hash(closureInstruction(arm, replay))])),
    catalogDefinitionSha256: catalogIdentity(replay), configSha256: configIdentity(),
    files: files.map(file => ({ path: file, sha256: hash(readFileSync(file)) })) };
  writeFileSync(freezePath, JSON.stringify(freeze, null, 2) + "\n");
  verifyClosureFreeze();
  process.stdout.write(`QA-076 offline freeze: ${files.length} pins; authorization=${freeze.authorizationState}; no model invocation.\n`);
}

if (process.argv.includes("--execute-qa076-frozen-six")) test("QA-076 approved six-session plan", { timeout: 1_890_000 }, async t => {
  // Must fail before journal creation, CLI inspection or spawning when budget is zero.
  const packet = loadClosurePacket(); assertExecutionAuthorized(packet.fixture); assertUnconsumed();
  const { replay, freeze } = verifyClosureFreeze(); assert.equal(freeze.authorizationState, "authorized");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit approved frozen inputs before startup");
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(hash(readFileSync(executable)), freeze.runtime.executableSha256); assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa076-live-");
  const report = { version: 1, identity: replay.fixture.identity, packetSha256: hash(readFileSync(packetPath)), freezeSha256: hash(readFileSync(freezePath)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), runtimeVersion: freeze.runtime.version,
    maximumFinalizerInvocations: 6, state: "executing", attempts: [], results: [], error: null };
  claimClosurePlan(report);
  const persist = () => { writeFileSync(`${reportPath}.pending`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); renameSync(`${reportPath}.pending`, reportPath); };
  try {
    for (const scheduled of replay.fixture.order) {
      verifyClosureFreeze(freeze); assert.equal(hash(readFileSync(executable)), freeze.runtime.executableSha256);
      reserveClosureSlot(report, scheduled.slot); Object.assign(report.attempts[scheduled.slot], scheduled, { reservedAt: new Date().toISOString() }); persist();
      const invocationDirectory = path.join(resources.directory, `invocation-${scheduled.slot}`); mkdirSync(invocationDirectory);
      const result = await invokeFinalizer({ resources, replay, scheduled, executable, directory: invocationDirectory,
        instruction: closureInstruction(scheduled.treatment, replay), onProgress: partial => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      result.screening = inspectClosureRun(replay, result); // No fabricated manual semantic passes.
      report.results.push(result); report.attempts[scheduled.slot].state = "terminal"; delete report.attempts[scheduled.slot].partial; persist();
      process.stdout.write(`QA-076 ${scheduled.slot + 1}/6 ${scheduled.treatment}: ${result.outcome}, reads=${result.screening.actualReaderReturns}; semantic review pending\n`);
    }
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots";
    report.error = "Interrupted or failed harness; no retry, replacement or same-plan resume.";
    throw new Error(report.error);
  } finally { persist(); }
});

export function auditClosureReport() {
  const report = read(reportPath);
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u);
  const { replay, freeze } = verifyClosureFreeze(undefined, report.sourceCommit);
  assertExecutionAuthorized(replay.fixture); assert.equal(freeze.authorizationState, "authorized");
  assert.equal(report.identity, replay.fixture.identity); assert.equal(report.packetSha256, hash(readFileSync(packetPath)));
  assert.equal(report.freezeSha256, hash(readFileSync(freezePath))); assert.equal(report.runtimeVersion, freeze.runtime.version);
  assert.equal(report.state, "consumed"); assert.equal(report.attempts.length, 6); assert.equal(report.results.length, 6);
  const results = report.results.map((row, slot) => {
    const attempt = report.attempts[slot];
    for (const key of ["slot", "treatment", "repetition", "runId"]) {
      assert.equal(row[key], replay.fixture.order[slot][key]); assert.equal(attempt[key], row[key]);
    }
    assert.equal(attempt.state, "terminal"); assert.ok(Date.parse(attempt.reservedAt) <= Date.parse(row.observedAt));
    assert.equal(row.answerSha256, hash(row.finalAnswer)); assert.equal(row.instructionSha256, hash(closureInstruction(row.treatment, replay)));
    const checked = inspectClosureRun(replay, row); assert.deepEqual(checked, row.screening); return checked;
  });
  return { reportSha256: hash(readFileSync(reportPath)), results };
}

if (process.argv.includes("--audit-qa076")) {
  const audit = auditClosureReport();
  const answers = [...audit.results].sort((a, b) => a.assessment.parsed.finalArtifactSha256.localeCompare(b.assessment.parsed.finalArtifactSha256) || a.slot - b.slot)
    .map((row, index) => ({ blindId: `answer-${index + 1}`, finalArtifactSha256: row.assessment.parsed.finalArtifactSha256,
      delivered: row.delivered, finalArtifact: row.assessment.parsed.final.raw }));
  const destination = "docs/acceptance/evidence/qa-076-final-only.json";
  const content = JSON.stringify({ reportSha256: audit.reportSha256, answers }, null, 2) + "\n";
  if (existsSync(destination)) assert.equal(readFileSync(destination, "utf8"), content, "Do not overwrite a different blind export");
  else writeFileSync(destination, content, { flag: "wx" });
  process.stdout.write("QA-076 integrity audit exported final-only artifacts; persist first judgments before unmasking tables.\n");
}
