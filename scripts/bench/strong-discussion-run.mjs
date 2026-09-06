import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { evidenceToolDefinition, hash } from "./evidence-access-reader.mjs";
import { invokeFinalizer, makeAccess, runtimeConfig } from "./evidence-access-runtime.mjs";
import { fixtureDirectory, packetPath, readJson, digest, roles, loadStrongPacket, roleReplay,
  baseInstruction, contributionTransfer, sessionInstruction, inspectSession, executeSchedule, validateFirstGrades } from "./strong-discussion.mjs";

export const freezePath = `${fixtureDirectory}/freeze.json`;
export const reportPath = "docs/acceptance/evidence/qa-078-strong-discussion.json";
export const blindPath = "docs/acceptance/evidence/qa-078-final-only.json";
export const firstPath = "docs/acceptance/evidence/qa-078-first-assessment.json";
export const assessmentPath = "docs/acceptance/evidence/qa-078-assessment.json";
const encoded = value => JSON.stringify(value, null, 2) + "\n";
export function writeExclusive(file, value) { writeFileSync(file, encoded(value), { flag: "wx", mode: 0o600 }); }
export function retainIdentical(file, value) {
  if (existsSync(file)) assert.equal(readFileSync(file, "utf8"), encoded(value), "Existing evidence cannot be overwritten");
  else writeExclusive(file, value);
}
function persistJournal(report, file = reportPath) {
  writeFileSync(`${file}.pending`, encoded(report), { mode: 0o600 }); renameSync(`${file}.pending`, file);
}
export function assertUnconsumed(file = reportPath) { assert.ok(!existsSync(file), "QA-078 consumed; no retry, replacement or resume"); }

function relativeDependencies(entries) {
  const files = new Set();
  const visit = file => {
    if (files.has(file)) return;
    assert.ok(existsSync(file), file); files.add(file);
    if (!/\.[cm]?[jt]s$/.test(file)) return;
    for (const [, relative] of readFileSync(file, "utf8").matchAll(/\b(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
      visit(path.normalize(path.join(path.dirname(file), relative)));
    }
  };
  entries.forEach(visit); return [...files].sort();
}
function identities(replay) {
  return {
    instructions: Object.fromEntries(roles.map(role => [role, hash(baseInstruction(replay, role))])),
    config: hash(JSON.stringify(runtimeConfig("S", "BUNDLE", "CONTROL", "RECEIPTS", "RUN", "GRANT"))),
    catalogs: Object.fromEntries(roles.map(role => {
      const scheduled = replay.fixture.sessions.find(s => s.role === role);
      return [role, hash(JSON.stringify(evidenceToolDefinition(makeAccess(roleReplay(replay, role), scheduled, "2026-09-06T00:00:00Z").bundle)))];
    }))
  };
}

export function verifyStrongFreeze(freeze = readJson(freezePath), historicalCommit) {
  for (const pin of freeze.files) {
    assert.equal(digest(pin.path), pin.sha256, `Frozen input drift: ${pin.path}`);
    if (historicalCommit) assert.equal(hash(execFileSync("git", ["show", `${historicalCommit}:${pin.path}`])), pin.sha256);
  }
  const replay = loadStrongPacket();
  assert.equal(freeze.identity, replay.fixture.identity); assert.equal(freeze.packetSha256, digest(packetPath));
  assert.deepEqual(freeze.identities, identities(replay));
  assert.equal(freeze.identities.instructions.single, freeze.identities.instructions.finalizer);
  assert.equal(freeze.identities.catalogs.single, freeze.identities.catalogs.finalizer);
  for (const role of roles) assert.equal(readFileSync(`${fixtureDirectory}/${role}-instruction.txt`, "utf8"), baseInstruction(replay, role));
  const rubric = readJson(`${fixtureDirectory}/scoring.json`);
  assert.deepEqual(rubric.criteria.map(({ criterionKey, description, required, ordinal }) => ({ criterionKey, description, required, ordinal })), replay.fixture.task.criteria);
  assert.deepEqual(replay.fixture.task.criticalCriterionKeys, rubric.criteria.filter(c => c.critical).map(c => c.criterionKey));
  assert.ok(Buffer.byteLength(readFileSync(`${fixtureDirectory}/reference.md`)) <= replay.fixture.runtime.maximumAnswerBytes);
  return { replay, freeze };
}

if (process.argv.includes("--freeze-qa078")) {
  assertUnconsumed(); const replay = loadStrongPacket();
  for (const role of roles) writeFileSync(`${fixtureDirectory}/${role}-instruction.txt`, baseInstruction(replay, role));
  const files = relativeDependencies([
    packetPath, ...replay.fixture.sources.map(s => s.path), `${fixtureDirectory}/scoring.json`, `${fixtureDirectory}/reference.md`,
    ...roles.map(role => `${fixtureDirectory}/${role}-instruction.txt`),
    "scripts/bench/strong-discussion.mjs", "scripts/bench/strong-discussion-run.mjs", "scripts/bench/strong-discussion.test.mjs",
    "scripts/bench/export-review-specimen.test.mjs", "scripts/test/run-with-temp-root.mjs",
    "package.json", "package-lock.json", "docs/adr/0052-compare-strong-single-and-discussion.md"
  ]);
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const freeze = { version: 1, identity: replay.fixture.identity, frozenAt: new Date().toISOString(), packetSha256: digest(packetPath),
    runtime: { executableSha256: digest(executable), version: execFileSync(executable, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), nodeVersion: process.version },
    identities: identities(replay), unrelatedWorktreeExceptions: [{ path: ".gitignore", sha256: digest(".gitignore"), reason: "Pre-existing Owner edit; ignored by the empty-CWD, ignore-config invocation. Never staged by QA-078." }],
    files: files.map(file => ({ path: file, sha256: digest(file) })) };
  writeFileSync(freezePath, encoded(freeze)); verifyStrongFreeze();
  process.stdout.write(`QA-078 frozen: ${files.length} inputs; zero model calls.\n`);
}

function assertLiveWorkspace(freeze) {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  verifyStrongFreeze(freeze, sourceCommit);
  assert.equal(hash(execFileSync("git", ["show", `${sourceCommit}:${freezePath}`])), digest(freezePath), "Commit freeze before startup");
  const changed = execFileSync("git", ["status", "--porcelain=v1", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  for (const line of changed) {
    const file = line.slice(3), exception = freeze.unrelatedWorktreeExceptions.find(e => e.path === file);
    assert.ok(exception && line.slice(0, 2) === " M", `Unfrozen worktree change: ${file}`);
    assert.equal(digest(file), exception.sha256);
  }
  return sourceCommit;
}

if (process.argv.includes("--execute-qa078-frozen-twelve")) test("QA-078 Owner-authorized bounded Single/Discussion comparison", { timeout: 3_000_000 }, async t => {
  assertUnconsumed(); const { replay, freeze } = verifyStrongFreeze();
  const sourceCommit = assertLiveWorkspace(freeze);
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(digest(executable), freeze.runtime.executableSha256); assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convenewire-qa078-live-");
  const report = { version: 1, identity: replay.fixture.identity, sourceCommit, packetSha256: digest(packetPath), freezeSha256: digest(freezePath),
    runtime: freeze.runtime, maximumSessions: 12, state: "executing", attempts: [], results: [], trials: [], error: null };
  writeExclusive(reportPath, report);
  const persist = () => persistJournal(report);
  try {
    await executeSchedule(replay, report, async (scheduled, instruction) => {
      verifyStrongFreeze(freeze); assert.equal(digest(executable), freeze.runtime.executableSha256);
      const directory = path.join(resources.directory, `session-${scheduled.slot}`); mkdirSync(directory);
      const row = await invokeFinalizer({ resources, replay: roleReplay(replay, scheduled.role), scheduled, executable, directory, instruction,
        onProgress: partial => { report.attempts[scheduled.slot].partial = partial; persist(); } });
      process.stdout.write(`QA-078 slot ${scheduled.slot + 1}/12 ${scheduled.role}: ${row.outcome}; source returns=${row.evidenceAccess.sourceReturns}; quality not graded\n`);
      return row;
    }, persist);
    report.state = "consumed";
  } catch {
    report.state = "consumed_with_unfinished_slots"; report.error = "Harness interrupted; retain all reserved slots, no retry or same-plan resume.";
    throw new Error(report.error);
  } finally { persist(); }
});

export function auditStrongReport() {
  const report = readJson(reportPath);
  assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u);
  const { replay, freeze } = verifyStrongFreeze(undefined, report.sourceCommit);
  assert.equal(report.identity, replay.fixture.identity); assert.equal(report.packetSha256, digest(packetPath));
  assert.equal(report.freezeSha256, digest(freezePath)); assert.deepEqual(report.runtime, freeze.runtime);
  assert.equal(report.maximumSessions, 12); assert.ok(["consumed", "consumed_with_unfinished_slots"].includes(report.state));
  assert.ok(report.attempts.length <= 12 && report.results.length <= report.attempts.length);
  if (report.state === "consumed") { assert.equal(report.results.length, 12); assert.equal(report.trials.length, 6); }
  for (const [index, attempt] of report.attempts.entries()) for (const key of Object.keys(replay.fixture.sessions[index])) assert.equal(attempt[key], replay.fixture.sessions[index][key]);
  const results = [];
  for (const row of report.results) {
    const scheduled = replay.fixture.sessions[row.slot];
    assert.ok(scheduled && !results.some(r => r.slot === row.slot));
    for (const key of Object.keys(scheduled)) assert.equal(row[key], scheduled[key]);
    assert.equal(report.attempts[row.slot].state, "terminal");
    assert.ok(Date.parse(report.attempts[row.slot].reservedAt) <= Date.parse(row.observedAt));
    const instruction = sessionInstruction(replay, row, report.results);
    assert.equal(report.attempts[row.slot].instruction, instruction);
    assert.equal(row.instructionSha256, report.attempts[row.slot].instructionSha256);
    const checked = inspectSession(replay, row, instruction); assert.deepEqual(row.manipulation, checked);
    assert.equal(row.answerSha256, hash(row.finalAnswer));
    assert.equal(row.elapsedMilliseconds, Date.parse(row.endedAt) - Date.parse(row.observedAt));
    if (row.role === "finalizer") {
      const contributors = report.results.filter(r => r.trialId === row.trialId && r.role.startsWith("contributor"));
      assert.equal(contributors.length, 2);
      assert.ok(contributors.every(r => Date.parse(r.endedAt) <= Date.parse(row.observedAt)), "All-settled barrier");
      contributionTransfer(replay, row, report.results);
    }
    results.push(row);
  }
  const trials = replay.fixture.trials.map((planned, index) => {
    const trial = report.trials[index], members = results.filter(r => r.trialId === planned.trialId);
    const final = members.find(r => ["single", "finalizer"].includes(r.role));
    if (trial) {
      for (const key of Object.keys(planned)) assert.equal(trial[key], planned[key]);
      assert.ok(members.every(r => Date.parse(r.observedAt) >= Date.parse(trial.observedAt)));
      if (trial.endedAt) {
        assert.ok(members.every(r => Date.parse(r.endedAt) <= Date.parse(trial.endedAt)));
        assert.equal(trial.elapsedMilliseconds, Date.parse(trial.endedAt) - Date.parse(trial.observedAt));
      }
      const previous = report.trials[index - 1];
      if (previous) assert.ok(Date.parse(previous.endedAt) <= Date.parse(trial.observedAt));
    }
    const reserved = report.attempts.filter(a => a.trialId === planned.trialId).length;
    return { ...planned, finalRunId: final?.runId ?? null, finalAnswerSha256: final?.answerSha256 ?? hash(""),
      delivered: final?.manipulation.delivered ?? false,
      manipulationValid: members.length === (planned.arm === "S" ? 1 : 3) && members.every(r => r.manipulation.valid),
      sessions: reserved, terminalSessions: members.length, unfinishedSessions: reserved - members.length,
      elapsedMilliseconds: trial?.elapsedMilliseconds ?? null,
      summedSessionMilliseconds: members.reduce((sum, r) => sum + r.elapsedMilliseconds, 0),
      failedSessions: members.filter(r => r.outcome !== "completed").length,
      reads: members.reduce((sum, r) => sum + r.manipulation.counts.returned, 0),
      finalAnswer: final?.finalAnswer ?? "" };
  });
  const blind = { version: 1, reportSha256: digest(reportPath), answers: [...trials].sort((a, b) => a.finalAnswerSha256.localeCompare(b.finalAnswerSha256) || a.trialId.localeCompare(b.trialId))
    .map((r, i) => ({ blindId: `answer-${i + 1}`, answerSha256: r.finalAnswerSha256, delivered: r.delivered, finalAnswer: r.finalAnswer })) };
  return { report, replay, trials, blind };
}

export function buildStrongAssessment() {
  const { replay, trials, blind } = auditStrongReport(), first = readJson(firstPath);
  assert.deepEqual(readJson(blindPath), blind); assert.equal(first.finalOnlySha256, digest(blindPath));
  const checked = validateFirstGrades(replay, blind, first);
  const blindOrder = [...trials].sort((a, b) => a.finalAnswerSha256.localeCompare(b.finalAnswerSha256) || a.trialId.localeCompare(b.trialId));
  const rows = trials.map(trial => {
    const masked = blind.answers[blindOrder.findIndex(t => t.trialId === trial.trialId)];
    const grade = checked.find(g => g.blindId === masked.blindId);
    const { finalAnswer: _answer, ...metrics } = trial; return { ...metrics, ...grade };
  });
  const arms = Object.fromEntries(["S", "D"].map(arm => {
    const selected = rows.filter(r => r.arm === arm), times = selected.map(r => r.elapsedMilliseconds).filter(n => n !== null).sort((a, b) => a - b);
    return [arm, { scheduled: 3, full: Object.fromEntries(["pass", "fail", "disputed", "no_artifact"].map(state => [state, selected.filter(r => r.full === state).length])),
      criticalPass: selected.filter(r => r.critical === "pass").length, manipulationValid: selected.filter(r => r.manipulationValid).length,
      sessions: selected.reduce((n, r) => n + r.sessions, 0), failedSessions: selected.reduce((n, r) => n + r.failedSessions, 0),
      unfinishedSessions: selected.reduce((n, r) => n + r.unfinishedSessions, 0),
      unsupportedAdditions: selected.reduce((n, r) => n + r.unsupportedAdditions, 0),
      meanElapsedMilliseconds: times.length ? times.reduce((n, time) => n + time, 0) / times.length : null,
      medianElapsedMilliseconds: times.length === 3 ? times[1] : null }];
  }));
  const candidate = arms.D.full.pass === 3 && arms.S.full.pass <= 1 && arms.D.unsupportedAdditions === 0 && rows.every(r => r.manipulationValid) &&
    rows.filter(r => r.arm === "D").every(r => [...Object.values(r.facts), ...Object.values(r.unknowns)].every(j => j === "preserved")) &&
    arms.S.full.disputed === 0 && arms.D.full.disputed === 0;
  return { version: 1, identity: replay.fixture.identity, reportSha256: digest(reportPath), firstAssessmentSha256: digest(firstPath),
    gradingDisclosure: first.evaluatorDisclosure, candidateSignal: candidate, arms, trials: rows,
    limitations: ["One synthetic task repeated three times", "More sessions for Discussion; not equal compute", "Requested provider model not independently attested", "Author knows reference; first final labels masked, not independent human evaluation", "Isolated pipeline, not production Discussion E2E", "No automatic semantic grader or net score"] };
}

if (process.argv.includes("--audit-qa078")) {
  const { trials, blind } = auditStrongReport(); retainIdentical(blindPath, blind);
  process.stdout.write(`QA-078 retained ${trials.length} planned finals; manipulation valid=${trials.filter(t => t.manipulationValid).length}; final-only export ready.\n`);
}
if (process.argv.includes("--audit-qa078-assessment")) {
  const report = buildStrongAssessment(); retainIdentical(assessmentPath, report);
  process.stdout.write(JSON.stringify({ arms: report.arms, candidateSignal: report.candidateSignal }) + "\n");
}
