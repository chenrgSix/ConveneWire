import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { invokeFinalizer } from "./evidence-access-runtime.mjs";
import { packet, packetPath, fixtureDirectory, json, encoded, hash, exclusive, pinDocument, scopeFor,
  replayFor, ownerInstruction, finalInstruction, makeDisclosure, releaseProposal, verifyRelease,
  revokeDisclosure, deliverWithConsent, localVerify, ownerDocuments, inspectInvocation, childCommand } from "./authority-collaboration.mjs";

export const freezePath = `${fixtureDirectory}/freeze.json`;
export const reportPath = "docs/acceptance/evidence/qa-079-authority-experiment.json";
export const privatePath = owner => `docs/acceptance/evidence/qa-079-owner-${owner}.json`;
export const gradePath = "docs/acceptance/evidence/qa-079-first-assessment.json";
export const assessmentPath = "docs/acceptance/evidence/qa-079-assessment.json";
const persist = (file, value) => { writeFileSync(`${file}.pending`, encoded(value), { mode: 0o600 }); renameSync(`${file}.pending`, file); };
const digest = file => hash(readFileSync(file));
export function assertUnconsumed(file = reportPath) { assert.ok(!existsSync(file), "QA-079 authorization consumed; no new/retried model sessions"); }
export function reserve(report, planned, meta) {
  const p = packet();
  assert.ok(report.state === "running" && report.attempts.length < 12);
  assert.deepEqual(planned, p.schedule[report.attempts.length], "No skipped, reordered or additional slots");
  assert.equal(p.runtime.model, "gpt-5.5"); assert.equal(p.runtime.reasoningEffort, "low");
  const entry = { ...planned, runId: meta.runs[planned.role], state: "reserved", reservedAt: new Date().toISOString() };
  report.attempts.push(entry); return entry;
}
function fixtureFiles() {
  const existing = execFileSync("git", ["ls-files", "apps/server/src", "packages/contracts", "apps/server/package.json", "package.json", "package-lock.json"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  return [...new Set([...existing, packetPath, `${fixtureDirectory}/scoring.json`, `${fixtureDirectory}/reference.md`,
    ...packet().sources.map(s => s.path), "docs/adr/0053-screen-authority-separated-evidence.md",
    "scripts/bench/authority-collaboration.mjs", "scripts/bench/authority-collaboration.test.mjs",
    "scripts/bench/authority-experiment.mjs", "scripts/bench/authority-experiment.test.mjs",
    "scripts/bench/authority-owner-verifier.mjs", "scripts/bench/authority-central.mts",
    "scripts/bench/evidence-access-runtime.mjs", "scripts/bench/evidence-access-reader.mjs",
    "scripts/bench/evidence-codex-config.mjs", "scripts/bench/evidence-invocation-observer.mjs",
    "scripts/test/child-process.mjs", "scripts/test/resources.mjs", "scripts/test/run-with-temp-root.mjs"
  ])].sort();
}
export function verifyFreeze(historicalCommit) {
  const freeze = json(freezePath), p = packet(); assert.equal(freeze.identity, p.identity);
  assert.equal(freeze.packetSha256, digest(packetPath));
  for (const pin of freeze.files) {
    assert.equal(digest(pin.path), pin.sha256, `Frozen drift: ${pin.path}`);
    if (historicalCommit) assert.equal(hash(execFileSync("git", ["show", `${historicalCommit}:${pin.path}`], { maxBuffer: 8_000_000 })), pin.sha256);
  }
  assert.equal(p.authorization.maximumSessions, 12); assert.equal(p.runtime.retries, 0);
  assert.deepEqual(p.schedule, ["normal", "restart", "revoked"].flatMap((scenario, s) =>
    ["code", "security", "operations", "finalizer"].map((role, i) => ({ slot: s * 4 + i, scenario, role, treatment: "B" }))));
  const rubric = json(`${fixtureDirectory}/scoring.json`);
  assert.deepEqual(rubric.criteria.map(({ criterionKey, description, required, ordinal }) => ({ criterionKey, description, required, ordinal })), p.task.criteria);
  assert.deepEqual(rubric.criteria.filter(c => c.critical).map(c => c.criterionKey), p.task.criticalCriterionKeys);
  return freeze;
}
if (process.argv.includes("--freeze-qa079")) {
  assertUnconsumed(); const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const freeze = { version: 1, identity: packet().identity, frozenAt: new Date().toISOString(), packetSha256: digest(packetPath),
    runtime: { nodeVersion: process.version, executableSha256: digest(executable), version: execFileSync(executable, ["--version"], { encoding: "utf8" }).trim() },
    files: fixtureFiles().map(file => ({ path: file, sha256: digest(file) })) };
  exclusive(freezePath, freeze); verifyFreeze(); process.stdout.write(`QA-079 frozen ${freeze.files.length} inputs; zero model calls.\n`);
}

export async function executeExperiment(resources, report, { invoke = invokeFinalizer, save = () => {}, retainOwner = () => {}, executable } = {}) {
  const p = packet();
  for (const scenario of p.scenarios) {
    const directory = path.join(resources.directory, scenario); mkdirSync(directory);
    const databasePath = path.join(directory, "central.sqlite");
    const central = (request, name) => childCommand(resources, "scripts/bench/authority-central.mts", { databasePath, ...request }, path.join(directory, `central-${name}`), { typescript: true });
    const initialized = await central({ mode: "init", scenario }, "init"); assert.equal(initialized.exitCode, 0, initialized.diagnostic);
    const meta = initialized.response, record = { scenario, meta, observedAt: new Date().toISOString(), owners: [], publications: [], statuses: [], recovery: [], final: null };
    report.scenarios.push(record); save();
    const issued = p.owners.map(owner => {
      const ownerDirectory = path.join(directory, owner); mkdirSync(ownerDirectory);
      const authority = makeDisclosure(meta, owner), grantStatePath = path.join(ownerDirectory, "authority.json");
      exclusive(grantStatePath, authority.state);
      return { owner, ownerDirectory, grantStatePath, ...authority };
    });
    // Reserve in frozen order, then run source owners independently. No owner sees a peer output.
    const entries = issued.map(({ owner }) => { const entry = reserve(report, p.schedule[report.attempts.length], meta); assert.equal(entry.role, owner); save(); return entry; });
    const ownersStarted = await central({ mode: "start", meta, roles: p.owners }, "start-owners");
    assert.equal(ownersStarted.exitCode, 0, ownersStarted.diagnostic);
    const settled = await Promise.allSettled(issued.map(async (ctx, i) => {
      const entry = entries[i], verifier = await localVerify(resources, meta, ctx.owner, path.join(ctx.ownerDirectory, "verify"));
      const documents = ownerDocuments(ctx.owner, verifier), replay = replayFor(meta, documents), instruction = ownerInstruction(ctx.owner, documents);
      const runtimeDir = path.join(ctx.ownerDirectory, "runtime"); mkdirSync(runtimeDir);
      entry.state = "started"; save();
      const row = await invoke({ resources, replay, scheduled: entry, executable, instruction, directory: runtimeDir });
      const checked = inspectInvocation(meta, ctx.owner, row, replay, instruction);
      entry.state = "terminal"; entry.outcome = row.outcome; save();
      const privateRecord = { scenario, owner: ctx.owner, instruction, verifier, row, checked };
      retainOwner(ctx.owner, privateRecord);
      return { ...ctx, verifier, row, checked, privateRecordSha256: hash(encoded(privateRecord)) };
    }));
    for (const [index, settledOwner] of settled.entries()) {
      const ctx = issued[index];
      if (settledOwner.status !== "fulfilled") {
        record.statuses.push({ owner: ctx.owner, status: "unavailable", reason: "owner_runtime_or_verifier_failed" });
        record.owners.push({ owner: ctx.owner, runId: entries[index].runId, outcome: "harness_failed" }); save(); continue;
      }
      const owner = settledOwner.value;
      record.owners.push({ owner: owner.owner, runId: owner.row.runId, outcome: owner.row.outcome,
        answerSha256: owner.row.answerSha256, privateRecordSha256: owner.privateRecordSha256,
        elapsedMilliseconds: owner.row.elapsedMilliseconds, checked: owner.checked,
        originalGrantState: owner.state });
      if (!owner.checked.delivered || !owner.checked.fullReadCoverage) {
        record.statuses.push({ owner: owner.owner, status: "unavailable", reason: "owner_output_or_required_reads_incomplete" }); save(); continue;
      }
      const exp = { ...scopeFor(meta, owner.owner), owner: owner.owner };
      let sealed;
      try { sealed = releaseProposal({ text: owner.row.finalAnswer, verifier: owner.verifier, state: json(owner.grantStatePath), expected: exp, privateKey: owner.privateKey }); }
      catch {
        record.statuses.push({ owner: owner.owner, status: "unavailable", reason: "owner_proposal_rejected_by_typed_verification_gate" }); save(); continue;
      }
      if (scenario === "revoked" && owner.owner === "operations") {
        const revoked = revokeDisclosure(owner.grantStatePath);
        assert.throws(() => releaseProposal({ text: owner.row.finalAnswer, verifier: owner.verifier, state: revoked, expected: exp, privateKey: owner.privateKey }));
        let centralInvocations = 0;
        await assert.rejects(() => deliverWithConsent(owner.grantStatePath, exp, sealed, () => { centralInvocations++; throw new Error("Revoked data must never reach Central"); }), /revoked/);
        assert.equal(centralInvocations, 0);
        record.revocation = { state: revoked, bufferedRetryDeniedBeforeCentral: true, bufferedRetryCentralInvocations: centralInvocations, newReleaseDenied: true, alreadyReadBytesNotRetracted: true };
        const notice = await central({ mode: "withheld", meta, role: owner.owner, revokedGrantState: revoked }, "withheld-status-only");
        assert.equal(notice.exitCode, 0, notice.diagnostic);
        record.revocation.publicStatusNotice = notice.response;
        record.statuses.push({ owner: owner.owner, status: "withheld", reason: "disclosure_revoked" }); save(); continue;
      }
      const publish = (name, extra = {}) => deliverWithConsent(owner.grantStatePath, exp, sealed, grantState =>
        central({ mode: "publish", meta, role: owner.owner, release: sealed, grantState, ...extra }, name));
      if (scenario === "restart" && owner.owner === "code") {
        const dead = await publish("killed-after-commit", { crashAfterCommit: true });
        assert.equal(dead.signal, "SIGKILL", dead.diagnostic); assert.equal(dead.response, null);
        record.recovery.push({ phase: "committed_before_ack", signal: dead.signal, responsePresent: false, runId: owner.row.runId,
          releaseSha256: hash(JSON.stringify(sealed)), modelSessionsBeforeRestart: report.attempts.length }); save();
      }
      const published = await publish(`publish-${owner.owner}`); assert.equal(published.exitCode, 0, published.diagnostic);
      if (scenario === "restart" && owner.owner === "code") assert.equal(published.response.replayed, true);
      const result = published.response.result;
      record.publications.push({ owner: owner.owner, release: sealed, result, replayed: published.response.replayed,
        resultCount: published.response.resultCount, summarySha256: published.response.summarySha256 });
      record.statuses.push({ owner: owner.owner, status: "released", observations: sealed.body.observations.map(o => o.checkId),
        missingObservations: p.disclosure.fields[owner.owner].filter(f => !sealed.body.observations.some(o => o.checkId === f.checkId)).map(f => f.checkId) }); save();
    }
    // Only actual persisted, approved Results become reader documents. Never inject withheld/private owner text.
    const documents = record.publications.map(({ owner, result }) => pinDocument(`evidence_qa079_${owner}_released`, JSON.stringify(result)));
    // An empty set gets a public absence record, with no substitute source observations.
    if (!documents.length) documents.push(pinDocument("evidence_qa079_release_absence", JSON.stringify(record.statuses)));
    const replay = replayFor(meta, documents), instruction = finalInstruction(meta, documents, record.statuses);
    const entry = reserve(report, p.schedule[report.attempts.length], meta); assert.equal(entry.role, "finalizer"); save();
    const finalStarted = await central({ mode: "start", meta, roles: ["finalizer"] }, "start-finalizer");
    assert.equal(finalStarted.exitCode, 0, finalStarted.diagnostic);
    const finalDirectory = path.join(directory, "finalizer"); mkdirSync(finalDirectory);
    entry.state = "started"; save();
    const row = await invoke({ resources, replay, scheduled: entry, executable, instruction, directory: finalDirectory });
    const checked = inspectInvocation(meta, "finalizer", row, replay, instruction);
    entry.state = "terminal"; entry.outcome = row.outcome;
    record.final = { instruction, row, checked };
    if (checked.delivered) {
      const published = await central({ mode: "final", meta, role: "finalizer", finalAnswer: row.finalAnswer }, "final");
      record.finalPublication = { exitCode: published.exitCode, result: published.response?.result ?? null };
    }
    const inspected = await central({ mode: "inspect", meta }, "inspect"); assert.equal(inspected.exitCode, 0, inspected.diagnostic);
    record.centralSnapshot = inspected.response;
    record.endedAt = new Date().toISOString(); record.elapsedMilliseconds = Date.parse(record.endedAt) - Date.parse(record.observedAt);
    save();
  }
}

if (process.argv.includes("--execute-qa079-frozen-twelve")) test("Owner-authorized QA-079 three bounded authority scenarios", { timeout: 3_000_000 }, async t => {
  assertUnconsumed(); const freeze = verifyFreeze();
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit frozen inputs before calls");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); verifyFreeze(sourceCommit);
  assert.equal(hash(execFileSync("git", ["show", `${sourceCommit}:${freezePath}`])), digest(freezePath));
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(digest(executable), freeze.runtime.executableSha256); assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convene-wire-qa079-live-");
  const report = { version: 1, identity: packet().identity, sourceCommit, freezeSha256: digest(freezePath), runtime: freeze.runtime,
    maximumSessions: 12, state: "running", attempts: [], scenarios: [], error: null };
  exclusive(reportPath, report);
  const owners = Object.fromEntries(packet().owners.map(owner => [owner, { identity: packet().identity, owner, privateAuditOnly: true, records: [] }]));
  for (const owner of packet().owners) exclusive(privatePath(owner), owners[owner]);
  try {
    await executeExperiment(resources, report, { executable,
      invoke: async options => { verifyFreeze(); assert.equal(digest(executable), freeze.runtime.executableSha256); return invokeFinalizer(options); },
      save: () => persist(reportPath, report),
      retainOwner: (owner, record) => { owners[owner].records.push(record); persist(privatePath(owner), owners[owner]);
        process.stdout.write(`QA-079 ${record.scenario}/${owner}: ${record.row.outcome}; raw source stays in owner audit.\n`); }
    });
    report.state = "consumed";
  } catch (error) {
    report.state = "consumed_with_incomplete_slots"; report.error = "Harness interruption retained; no same-plan model resume or retry.";
    throw error;
  } finally { persist(reportPath, report); }
});

export function auditExperiment({ syntheticReport, syntheticOwners } = {}) {
  const report = syntheticReport ?? json(reportPath), p = packet();
  if (syntheticReport) assert.equal(report.synthetic, true, "Only explicit provider-free fixtures may omit runtime freeze");
  else {
    assert.match(report.sourceCommit, /^[a-f0-9]{40}$/u); verifyFreeze(report.sourceCommit);
    assert.equal(report.freezeSha256, digest(freezePath)); assert.deepEqual(report.runtime, json(freezePath).runtime);
  }
  assert.equal(report.identity, p.identity); assert.equal(report.maximumSessions, 12);
  assert.ok(["consumed", "consumed_with_incomplete_slots"].includes(report.state));
  assert.ok(report.attempts.length <= 12);
  for (const [i, entry] of report.attempts.entries()) for (const key of Object.keys(p.schedule[i])) assert.deepEqual(entry[key], p.schedule[i][key]);
  const owners = syntheticReport ? syntheticOwners : Object.fromEntries(p.owners.map(o => [o, json(privatePath(o))]));
  const checks = [];
  for (const s of report.scenarios) {
    const meta = s.meta;
    for (const owner of s.owners) {
      const privateRecord = owners[owner.owner].records.find(r => r.scenario === s.scenario);
      if (owner.outcome === "harness_failed") { assert.ok(!privateRecord); continue; }
      assert.ok(privateRecord);
      assert.equal(owner.privateRecordSha256, hash(encoded(privateRecord)));
      const { row, verifier } = privateRecord;
      assert.deepEqual(verifier.values, json(`${fixtureDirectory}/scoring.json`).knownLocalFindings[owner.owner]);
      assert.equal(owner.answerSha256, hash(row.finalAnswer));
      const documents = ownerDocuments(owner.owner, verifier), replay = replayFor(meta, documents), instruction = ownerInstruction(owner.owner, documents);
      assert.equal(privateRecord.instruction, instruction);
      assert.deepEqual(owner.checked, inspectInvocation(meta, owner.owner, row, replay, instruction));
      assert.deepEqual(owner.checked, privateRecord.checked);
      const initial = owner.originalGrantState.grant;
      for (const key of ["experimentId", "authorityId", "taskId", "roomId", "runId", "recipientRunId"]) assert.equal(verifier[key], initial[key]);
    }
    for (const pub of s.publications) {
      const owner = s.owners.find(o => o.owner === pub.owner), privateRecord = owners[pub.owner].records.find(r => r.scenario === s.scenario);
      verifyRelease(pub.release, owner.originalGrantState, { ...scopeFor(meta, pub.owner), owner: pub.owner }, pub.release.body.sealedAt);
      assert.equal(pub.result.proposal.summary, JSON.stringify(pub.release));
      assert.equal(pub.summarySha256, hash(pub.result.proposal.summary));
      assert.equal(pub.result.proposedBy.runId, meta.runs[pub.owner]); assert.equal(pub.result.review, null);
      assert.equal(pub.result.taskId, meta.taskId); assert.equal(pub.result.roomId, meta.roomId);
      const candidate = JSON.parse(privateRecord.row.finalAnswer);
      assert.equal(candidate.observations.length, pub.release.body.observations.length);
      for (const value of pub.release.body.observations) {
        assert.deepEqual(value.value, privateRecord.verifier.values[value.checkId]);
        assert.ok(candidate.observations.some(v => v.checkId === value.checkId && JSON.stringify(v.value) === JSON.stringify(value.value)));
      }
      assert.ok(s.centralSnapshot.results.some(r => r.resultId === pub.result.resultId && r.proposal.summary === pub.result.proposal.summary));
    }
    const documents = s.publications.map(({ owner, result }) => pinDocument(`evidence_qa079_${owner}_released`, JSON.stringify(result)));
    if (!documents.length) documents.push(pinDocument("evidence_qa079_release_absence", JSON.stringify(s.statuses)));
    const expectedInstruction = finalInstruction(meta, documents, s.statuses);
    if (s.final) {
      assert.equal(s.final.instruction, expectedInstruction);
      assert.deepEqual(s.final.checked, inspectInvocation(meta, "finalizer", s.final.row, replayFor(meta, documents), expectedInstruction));
      assert.equal(s.final.row.elapsedMilliseconds, Date.parse(s.final.row.endedAt) - Date.parse(s.final.row.observedAt));
    }
    if (s.finalPublication?.result) {
      assert.equal(s.finalPublication.result.proposal.summary, s.final.row.finalAnswer);
      assert.equal(s.finalPublication.result.review, null);
      assert.equal(s.finalPublication.result.proposedBy.runId, meta.runs.finalizer);
    }
    assert.equal(new Set(s.centralSnapshot.results.map(r => r.proposal.operationId)).size, s.centralSnapshot.results.length);
    for (const role of p.owners) {
      const count = s.centralSnapshot.results.filter(r => r.proposedBy.runId === meta.runs[role]).length;
      assert.equal(count, s.publications.filter(r => r.owner === role).length);
    }
    const expectedOwners = s.scenario === "revoked" ? p.owners.filter(o => o !== "operations") : p.owners;
    const completeReleases = expectedOwners.every(o => {
      const pub = s.publications.find(r => r.owner === o);
      return pub && pub.release.body.observations.length === p.disclosure.fields[o].length;
    });
    if (s.scenario === "revoked" && s.revocation) {
      assert.equal(s.revocation.state.status, "revoked"); assert.equal(s.revocation.bufferedRetryDeniedBeforeCentral, true); assert.equal(s.revocation.bufferedRetryCentralInvocations, 0);
      assert.ok(!s.publications.some(r => r.owner === "operations"));
      assert.equal(s.revocation.publicStatusNotice.observationsPublished, 0);
      assert.ok(!s.final?.row.reads.some(r => r.receipt.evidenceRef === "evidence_qa079_operations_released"));
    }
    if (s.scenario === "restart" && s.recovery.length) {
      assert.equal(s.recovery[0].signal, "SIGKILL"); assert.equal(s.recovery[0].responsePresent, false);
      const pub = s.publications.find(r => r.owner === "code"); assert.ok(pub.replayed);
      assert.equal(s.recovery[0].releaseSha256, hash(JSON.stringify(pub.release)));
      assert.equal(s.recovery[0].modelSessionsBeforeRestart, 7);
    }
    checks.push({ scenario: s.scenario, ownerRuns: s.owners.length, finalDelivered: Boolean(s.final?.checked.delivered),
      allOwnerReads: s.owners.length === 3 && s.owners.every(o => o.checked?.delivered && o.checked.fullReadCoverage),
      finalReads: Boolean(s.final?.checked.fullReadCoverage), completeAuthorizedReleases: completeReleases,
      expectedOwnerResultCount: expectedOwners.length, actualOwnerResultCount: s.publications.length,
      sourceReturns: s.owners.reduce((n, o) => n + (o.checked?.returned ?? 0), 0) + (s.final?.checked.returned ?? 0),
      denialCount: s.owners.reduce((n, o) => n + (o.checked?.denied ?? 0), 0) + (s.final?.checked.denied ?? 0),
      coordinatorRestartVerified: s.scenario === "restart" ? s.recovery.length === 1 && s.publications.some(r => r.owner === "code" && r.replayed) : null,
      disclosureRevocationVerified: s.scenario === "revoked" ? Boolean(s.revocation?.newReleaseDenied && s.revocation.bufferedRetryDeniedBeforeCentral && s.revocation.bufferedRetryCentralInvocations === 0 && !s.publications.some(r => r.owner === "operations")) : null,
      elapsedMilliseconds: s.elapsedMilliseconds,
      summedModelMilliseconds: s.owners.reduce((n, o) => n + (o.elapsedMilliseconds ?? 0), 0) + (s.final?.row.elapsedMilliseconds ?? 0) });
  }
  // Detect specific accidental leaks as well as proving the structural typed egress above.
  const shared = JSON.stringify(report);
  for (const forbidden of ["QA079_CODE_PRIVATE_CANARY_7d392c", "QA079_SECURITY_PRIVATE_CANARY_a921fe", "QA079_OPERATIONS_PRIVATE_CANARY_1c873b", "private-east-machine", "private-west-machine", "private-disconnected-machine"]) assert.ok(!shared.includes(forbidden), "Forbidden owner text entered shared audit");
  if (report.state === "consumed") { assert.equal(report.attempts.length, 12); assert.equal(report.scenarios.length, 3); }
  return { report, checks, sourceReturns: checks.reduce((n, s) => n + s.sourceReturns, 0) };
}
export function assessExperiment() {
  const { report, checks } = auditExperiment(), p = packet(), first = json(gradePath);
  assert.equal(first.reportSha256, digest(reportPath)); assert.equal(first.rubricSha256, digest(`${fixtureDirectory}/scoring.json`));
  assert.equal(first.answers.length, report.scenarios.length);
  const rows = report.scenarios.map((s, i) => {
    const grade = first.answers.find(g => g.scenario === s.scenario); assert.ok(grade);
    assert.equal(grade.answerSha256, s.final?.row.answerSha256 ?? hash(""));
    assert.deepEqual(grade.criteria.map(c => c.criterionKey), p.task.criteria.map(c => c.criterionKey));
    const released = new Set(s.publications.map(r => `evidence_qa079_${r.owner}_released`));
    for (const c of grade.criteria) {
      assert.ok(["pass", "fail", "disputed", "no_artifact"].includes(c.judgment));
      assert.ok(typeof c.rationale === "string" && c.rationale.length > 0);
      assert.ok(Array.isArray(c.quotes) && c.quotes.every(q => typeof q === "string" && q.length > 0 && s.final.row.finalAnswer.includes(q)));
      assert.ok(c.evidenceRefs.every(r => released.has(r)));
      if (c.judgment === "pass") assert.ok(c.quotes.length > 0);
      if (c.judgment === "fail") assert.ok(["behavior_error", "missing_deliverable"].includes(c.failureKind));
      if (c.judgment === "disputed") assert.equal(c.failureKind, "wording_ambiguity");
    }
    for (const list of [grade.unsupportedAdditions, grade.behaviorErrors]) {
      assert.ok(Array.isArray(list));
      for (const item of list) assert.ok(s.final.row.finalAnswer.includes(item.quote) && item.rationale);
    }
    const judge = selected => selected.some(c => c.judgment === "no_artifact") ? "no_artifact" : selected.some(c => c.judgment === "fail") ? "fail" : selected.some(c => c.judgment === "disputed") ? "disputed" : "pass";
    const full = judge(grade.criteria), critical = judge(grade.criteria.filter(c => p.task.criticalCriterionKeys.includes(c.criterionKey)));
    const mechanics = checks[i];
    return { ...mechanics, answerSha256: grade.answerSha256, full, critical,
      unsupportedAdditions: grade.unsupportedAdditions.length, behaviorErrors: grade.behaviorErrors.length,
      completeScenarioPass: full === "pass" && mechanics.allOwnerReads && mechanics.finalReads && mechanics.completeAuthorizedReleases &&
        mechanics.coordinatorRestartVerified !== false && mechanics.disclosureRevocationVerified !== false && Boolean(s.finalPublication?.result) };
  });
  return { version: 1, identity: p.identity, reportSha256: digest(reportPath), firstAssessmentSha256: digest(gradePath),
    rows, sessionCount: report.attempts.length, sourceReturns: checks.reduce((n, c) => n + c.sourceReturns, 0),
    interpretation: "Three distinct scenarios on one authored synthetic case. No comparison with Single, no independent-human grading, no production/physical-owner/OS/provider isolation claim. Only named local verifier checks and fault points are established." };
}
if (process.argv.includes("--audit-qa079")) {
  const audit = auditExperiment(); process.stdout.write(JSON.stringify({ state: audit.report.state, sessions: audit.report.attempts.length, sourceReturns: audit.sourceReturns, checks: audit.checks }) + "\n");
}
if (process.argv.includes("--assess-qa079")) {
  const result = assessExperiment();
  if (existsSync(assessmentPath)) assert.equal(readFileSync(assessmentPath, "utf8"), encoded(result), "Existing assessment immutable");
  else exclusive(assessmentPath, result);
  process.stdout.write(JSON.stringify(result) + "\n");
}
