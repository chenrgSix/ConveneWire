// QA-074 only. The retained journal closes this authorization before any startup.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { loadReplay, renderReplay, sha256, treatmentInstruction } from "./evidence-access-replay.js";
import { claimPlan, reserveNext } from "./evidence-access-execute.js";
import { evidenceToolDefinition } from "./evidence-access-reader.mjs";
import { invokeFinalizer, makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { blindAnswers, inspectManipulation, screenReport } from "./evidence-screening-audit.js";

export const fixturePath = "docs/acceptance/fixtures/qa-074-evidence-access-use.json";
export const freezePath = "docs/acceptance/fixtures/qa-074-freeze.json";
export const reportPath = "docs/acceptance/evidence/qa-074-access-use-2026-09-06.json";
export const screeningPath = "docs/acceptance/evidence/qa-074-manipulation-2026-09-06.json";
export const blindPath = "docs/acceptance/evidence/qa-074-blind-answers-2026-09-06.json";
const basePath = "docs/acceptance/fixtures/qa-074-base-instruction.txt";
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
export function assertQa074Unconsumed(destination = reportPath) {
  assert.ok(!existsSync(destination), "QA-074 consumed: no startup, retry or resume is authorized");
}
export function loadQa074() {
  const replay = loadReplay(fixturePath), prior = loadReplay();
  assert.equal(replay.fixture.identity, "qa-074-windows-access-use-v1");
  assert.equal(replay.fixture.authorization, "owner-authorized-qa074-nine-fresh-finalizer-invocations");
  const { identity, authorization, order, ...content } = replay.fixture;
  const { identity: oldId, authorization: oldAuthorization, order: oldOrder, ...oldContent } = prior.fixture;
  assert.deepEqual(content, oldContent, "No diagnostic or model treatment content changes");
  assert.deepEqual(order, oldOrder.map(row => ({ ...row, runId: row.runId.replace("qa072", "qa074") })));
  assert.equal(new Set(order.map(row => row.runId)).size, 9);
  return replay;
}
function catalogIdentity(replay: ReturnType<typeof loadQa074>) {
  const access = makeAccess(replay, replay.fixture.order[1], "2026-09-06T00:00:00.000Z");
  return sha256(JSON.stringify(evidenceToolDefinition(access.bundle)));
}
function configIdentity() {
  return Object.fromEntries(["A", "B", "C"].map(arm => [arm,
    sha256(JSON.stringify(runtimeConfig(arm, "BUNDLE", "CONTROL", "RECEIPTS", "RUN", "GRANT")))]));
}
export function verifyQa074Freeze(freeze = json(freezePath), historicalCommit?: string) {
  for (const pin of freeze.files) {
    const bytes = historicalCommit ? execFileSync("git", ["show", `${historicalCommit}:${pin.path}`]) : readFileSync(pin.path);
    assert.equal(sha256(bytes), pin.sha256, `Changed frozen QA-074 file: ${pin.path}`);
    if (historicalCommit && pin.path.startsWith("docs/")) assert.equal(sha256(readFileSync(pin.path)), pin.sha256);
  }
  const replay = loadQa074();
  assert.equal(freeze.identity, replay.fixture.identity);
  assert.equal(sha256(renderReplay(replay)), freeze.baseInstructionSha256);
  assert.equal(catalogIdentity(replay), freeze.catalogDefinitionSha256);
  assert.deepEqual(configIdentity(), freeze.configSha256);
  assert.equal(readFileSync(basePath, "utf8"), renderReplay(replay));
  return { replay, freeze };
}

export function auditQa074() {
  const report = json(reportPath);
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u);
  const { replay, freeze } = verifyQa074Freeze(json(freezePath), report.sourceCommit);
  assert.equal(report.identity, replay.fixture.identity);
  assert.equal(report.fixtureSha256, sha256(readFileSync(fixturePath)));
  assert.equal(report.freezeSha256, sha256(readFileSync(freezePath)));
  assert.equal(report.runtimeVersion, freeze.runtime.version);
  assert.equal(report.state, "consumed");
  assert.equal(report.attempts.length, 9); assert.equal(report.results.length, 9);
  for (let slot = 0; slot < 9; slot++) {
    const row = report.results[slot], attempt = report.attempts[slot];
    for (const key of ["slot", "treatment", "repetition", "runId"]) {
      assert.equal(row[key], replay.fixture.order[slot]![key]);
      assert.equal(attempt[key], row[key]);
    }
    assert.equal(attempt.state, "terminal");
    assert.ok(Date.parse(attempt.reservedAt) <= Date.parse(row.observedAt));
    assert.equal(row.answerSha256, sha256(row.finalAnswer));
    assert.equal(row.instructionSha256, sha256(treatmentInstruction(row.treatment, replay)));
    assert.deepEqual(row.manipulation, inspectManipulation(replay, row));
  }
  const screening = { reportSha256: sha256(readFileSync(reportPath)), ...screenReport(replay, report) };
  return { report, screening, blind: { version: 1, reportSha256: screening.reportSha256, answers: blindAnswers(report, screening) } };
}

if (process.argv.includes("--freeze-qa074")) {
  assertQa074Unconsumed();
  const replay = loadQa074();
  writeFileSync(basePath, renderReplay(replay));
  const prior = json("docs/acceptance/fixtures/qa-072-freeze.json");
  const files = [...new Set<string>([...prior.files.map((pin: any) => pin.path), fixturePath, basePath,
    "docs/acceptance/fixtures/qa-074-scoring.json", "docs/adr/0048-repeat-evidence-screening-with-manipulation-checks.md",
    "scripts/bench/evidence-screening.ts", "scripts/bench/evidence-screening-audit.ts", "scripts/bench/evidence-screening.test.ts",
    "scripts/bench/evidence-invocation-observer.mjs", "scripts/bench/evidence-invocation-observer.test.mjs", "scripts/bench/evidence-visibility.test.ts",
    ...replay.fixture.provenance.map(pin => pin.path)])];
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const freeze = { version: 1, identity: replay.fixture.identity, frozenAt: new Date().toISOString(),
    runtime: { executableSha256: sha256(readFileSync(executable)), version: execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), nodeVersion: process.version },
    baseInstructionSha256: sha256(renderReplay(replay)), catalogDefinitionSha256: catalogIdentity(replay), configSha256: configIdentity(),
    files: files.map(file => ({ path: file, sha256: sha256(readFileSync(file)) })) };
  writeFileSync(freezePath, JSON.stringify(freeze, null, 2) + "\n");
  process.stdout.write(`QA-074 freeze: ${files.length} pins; no provider invocation.\n`);
}

if (process.argv.includes("--audit-qa074")) {
  const { screening, blind } = auditQa074();
  writeFileSync(screeningPath, JSON.stringify(screening, null, 2) + "\n");
  writeFileSync(blindPath, JSON.stringify(blind, null, 2) + "\n");
  process.stdout.write(`QA-074 ${screening.exposureGate}; actual reader returns=${screening.actualReaderReturns}.\n`);
}

if (process.argv.includes("--execute-qa074-frozen-nine")) test("QA-074 newly authorized nine Finalizer sessions", { timeout: 2_790_000 }, async t => {
  assertQa074Unconsumed();
  const { replay, freeze } = verifyQa074Freeze();
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit the frozen plan before startup");
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(sha256(readFileSync(executable)), freeze.runtime.executableSha256);
  assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa074-live-");
  const report: any = { version: 2, identity: replay.fixture.identity, fixturePath,
    fixtureSha256: sha256(readFileSync(fixturePath)), freezeSha256: sha256(readFileSync(freezePath)),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    requestedModel: replay.fixture.runtime.model, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    runtimeVersion: freeze.runtime.version, observedProviderModel: null,
    state: "executing", maximumFinalizerInvocations: 9, attempts: [], results: [], error: null };
  claimPlan(report, reportPath);
  const persist = () => {
    writeFileSync(`${reportPath}.pending`, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    renameSync(`${reportPath}.pending`, reportPath);
  };
  try {
    for (const scheduled of replay.fixture.order) {
      // Source or CLI drift stops the remaining plan; it never causes a retry.
      verifyQa074Freeze(freeze);
      assert.equal(sha256(readFileSync(executable)), freeze.runtime.executableSha256);
      reserveNext(report, scheduled.slot);
      Object.assign(report.attempts[scheduled.slot], scheduled, { reservedAt: new Date().toISOString() });
      persist();
      const directory = path.join(resources.directory, `invocation-${scheduled.slot}`); mkdirSync(directory);
      const result = await invokeFinalizer({ resources, replay, scheduled, executable, directory,
        instruction: treatmentInstruction(scheduled.treatment, replay),
        onProgress: (partial: unknown) => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      result.manipulation = inspectManipulation(replay, result);
      report.results.push(result);
      report.attempts[scheduled.slot].state = "terminal";
      delete report.attempts[scheduled.slot].partial;
      persist();
      process.stdout.write(`QA-074 ${scheduled.slot + 1}/9 ${scheduled.treatment}: ${result.outcome}, setup=${result.manipulation.setup}, returns=${result.manipulation.actualReaderReturns}, required=${result.manipulation.requiredReading}\n`);
    }
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots";
    report.error = "Interrupted or failed harness; reserved slots remain consumed. No retry or same-plan resume.";
    throw new Error(report.error);
  } finally { persist(); }
});
