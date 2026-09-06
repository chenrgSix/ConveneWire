// QA-075 only; common C/D exposure with a single D disposition instruction. The retained journal closes this authorization before any startup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { sha256 } from "./evidence-access-replay.js";
import { fixturePath, loadQa075, instruction, inspectQa075, screenQa075, blindQa075 } from "./claim-adjudication-audit.js";
export { fixturePath, loadQa075 } from "./claim-adjudication-audit.js";
import { claimPlan } from "./evidence-access-execute.js";
import { evidenceToolDefinition } from "./evidence-access-reader.mjs";
import { invokeFinalizer, makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";

export const freezePath = "docs/acceptance/fixtures/qa-075-freeze.json";
export const reportPath = "docs/acceptance/evidence/qa-075-claim-adjudication-2026-09-06.json";
export const screeningPath = "docs/acceptance/evidence/qa-075-artifacts-2026-09-06.json";
export const blindPath = "docs/acceptance/evidence/qa-075-blind-answers-2026-09-06.json";
const basePath = "docs/acceptance/fixtures/qa-075-base-instruction.txt";
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
export function assertQa075Unconsumed(destination = reportPath) {
  assert.ok(!existsSync(destination), "QA-075 consumed: no startup, retry or resume is authorized");
}
export function reserveSix(report: { attempts: Array<{ slot: number; state: string }> }, slot: number) {
  assert.equal(slot, report.attempts.length, "No retry, skip or reorder");
  assert.ok(Number.isInteger(slot) && slot >= 0 && slot < 6, "Six invocation cap reached");
  report.attempts.push({ slot, state: "reserved" });
}
function catalogIdentity(replay: ReturnType<typeof loadQa075>) {
  const access = makeAccess(replay, replay.adjudication.order[1], "2026-09-06T00:00:00.000Z");
  return sha256(JSON.stringify(evidenceToolDefinition(access.bundle)));
}
function configIdentity() {
  return Object.fromEntries(["C", "D"].map(arm => [arm,
    sha256(JSON.stringify(runtimeConfig(arm, "BUNDLE", "CONTROL", "RECEIPTS", "RUN", "GRANT")))]));
}
export function verifyQa075Freeze(freeze = json(freezePath), historicalCommit?: string) {
  for (const pin of freeze.files) {
    const bytes = historicalCommit ? execFileSync("git", ["show", `${historicalCommit}:${pin.path}`]) : readFileSync(pin.path);
    assert.equal(sha256(bytes), pin.sha256, `Changed frozen QA-075 file: ${pin.path}`);
    if (historicalCommit && pin.path.startsWith("docs/")) assert.equal(sha256(readFileSync(pin.path)), pin.sha256);
  }
  const replay = loadQa075();
  assert.equal(freeze.identity, replay.fixture.identity);
  assert.equal(sha256(instruction("C", replay)), freeze.baseInstructionSha256);
  assert.equal(catalogIdentity(replay), freeze.catalogDefinitionSha256);
  assert.deepEqual(configIdentity(), freeze.configSha256);
  assert.equal(readFileSync(basePath, "utf8"), instruction("C", replay));
  return { replay, freeze };
}

export function auditQa075() {
  const report = json(reportPath);
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u);
  const { replay, freeze } = verifyQa075Freeze(json(freezePath), report.sourceCommit);
  assert.equal(report.identity, replay.fixture.identity);
  assert.equal(report.fixtureSha256, sha256(readFileSync(fixturePath)));
  assert.equal(report.freezeSha256, sha256(readFileSync(freezePath)));
  assert.equal(report.runtimeVersion, freeze.runtime.version);
  assert.equal(report.state, "consumed");
  assert.equal(report.attempts.length, 6); assert.equal(report.results.length, 6);
  for (let slot = 0; slot < 6; slot++) {
    const row = report.results[slot], attempt = report.attempts[slot];
    for (const key of ["slot", "treatment", "repetition", "runId"]) {
      assert.equal(row[key], replay.adjudication.order[slot]![key]);
      assert.equal(attempt[key], row[key]);
    }
    assert.equal(attempt.state, "terminal");
    assert.ok(Date.parse(attempt.reservedAt) <= Date.parse(row.observedAt));
    assert.equal(row.answerSha256, sha256(row.finalAnswer));
    assert.equal(row.instructionSha256, sha256(instruction(row.treatment, replay)));
    assert.deepEqual(row.manipulation, inspectQa075(replay, row));
  }
  const screening = { reportSha256: sha256(readFileSync(reportPath)), ...screenQa075(replay, report) };
  return { report, screening, blind: { version: 1, reportSha256: screening.reportSha256, answers: blindQa075(screening) } };
}

if (process.argv.includes("--freeze-qa075")) {
  assertQa075Unconsumed();
  const replay = loadQa075();
  writeFileSync(basePath, instruction("C", replay));
  const prior = json("docs/acceptance/fixtures/qa-074-freeze.json");
  const files = [...new Set<string>([...prior.files.map((pin: any) => pin.path), fixturePath, basePath,
    "docs/acceptance/fixtures/qa-075-scoring.json", "docs/adr/0049-screen-evidence-to-claim-adjudication.md",
    "scripts/bench/claim-adjudication.ts", "scripts/bench/claim-adjudication-audit.ts", "scripts/bench/claim-adjudication.test.ts",
    "docs/acceptance/fixtures/qa-075-disposition.schema.json",
    "scripts/bench/evidence-invocation-observer.mjs", "scripts/bench/evidence-invocation-observer.test.mjs", "scripts/bench/evidence-visibility.test.ts",
    ...replay.fixture.provenance.map(pin => pin.path)])];
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const freeze = { version: 1, identity: replay.fixture.identity, frozenAt: new Date().toISOString(),
    runtime: { executableSha256: sha256(readFileSync(executable)), version: execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), nodeVersion: process.version },
    baseInstructionSha256: sha256(instruction("C", replay)), catalogDefinitionSha256: catalogIdentity(replay), configSha256: configIdentity(),
    files: files.map(file => ({ path: file, sha256: sha256(readFileSync(file)) })) };
  writeFileSync(freezePath, JSON.stringify(freeze, null, 2) + "\n");
  process.stdout.write(`QA-075 freeze: ${files.length} pins; no provider invocation.\n`);
}

if (process.argv.includes("--audit-qa075")) {
  const { screening, blind } = auditQa075();
  writeFileSync(screeningPath, JSON.stringify(screening, null, 2) + "\n");
  writeFileSync(blindPath, JSON.stringify(blind, null, 2) + "\n");
  process.stdout.write(`QA-075 common checks=${screening.allCommonChecksPassed}; ${screening.results.length} retained attempts.\n`);
}

if (process.argv.includes("--execute-qa075-frozen-six")) test("QA-075 newly authorized six Finalizer sessions", { timeout: 1_890_000 }, async t => {
  assertQa075Unconsumed();
  const { replay, freeze } = verifyQa075Freeze();
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit the frozen plan before startup");
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(sha256(readFileSync(executable)), freeze.runtime.executableSha256);
  assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa075-live-");
  const report: any = { version: 2, identity: replay.fixture.identity, fixturePath,
    fixtureSha256: sha256(readFileSync(fixturePath)), freezeSha256: sha256(readFileSync(freezePath)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    requestedModel: replay.fixture.runtime.model, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    runtimeVersion: freeze.runtime.version, observedProviderModel: null,
    state: "executing", maximumFinalizerInvocations: 6, attempts: [], results: [], error: null };
  claimPlan(report, reportPath);
  const persist = () => {
    writeFileSync(`${reportPath}.pending`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    renameSync(`${reportPath}.pending`, reportPath);
  };
  try {
    for (const scheduled of replay.adjudication.order) {
      // Source or CLI drift stops the remaining plan; it never causes a retry.
      verifyQa075Freeze(freeze);
      assert.equal(sha256(readFileSync(executable)), freeze.runtime.executableSha256);
      reserveSix(report, scheduled.slot);
      Object.assign(report.attempts[scheduled.slot], scheduled, { reservedAt: new Date().toISOString() });
      persist();
      const directory = path.join(resources.directory, `invocation-${scheduled.slot}`); mkdirSync(directory);
      const result = await invokeFinalizer({ resources, replay, scheduled, executable, directory,
        instruction: instruction(scheduled.treatment, replay),
        onProgress: (partial: unknown) => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      result.manipulation = inspectQa075(replay, result);
      report.results.push(result);
      report.attempts[scheduled.slot].state = "terminal";
      delete report.attempts[scheduled.slot].partial;
      persist();
      process.stdout.write(`QA-075 ${scheduled.slot + 1}/6 ${scheduled.treatment}: ${result.outcome}, setup=${result.manipulation.setup}, returns=${result.manipulation.actualReaderReturns}, required=${result.manipulation.requiredReading}\n`);
    }
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots";
    report.error = "Interrupted or failed harness; reserved slots remain consumed. No retry or same-plan resume.";
    throw new Error(report.error);
  } finally { persist(); }
});
