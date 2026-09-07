import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { json, hash, encoded, exclusive, packet, sourceFor, pinDocument, replayFor, scopeFor,
  finalInstruction, inspectInvocation, verifyRelease } from "./authority-collaboration.mjs";
import { plan, planPath, independentInstruction, gradeObservations, executeIndependent } from "./independent-owner.mjs";
import { invokeAuthoritySession } from "./authority-session-runtime.mjs";

export const freezePath = "docs/acceptance/fixtures/qa-081/freeze.json";
export const reportPath = "docs/acceptance/evidence/qa-081-independent-experiment.json";
export const privatePath = (kind, scenario, owner) => `docs/acceptance/evidence/qa-081-${scenario}-${owner}-${kind}.json`;
export const assessmentPath = "docs/acceptance/evidence/qa-081-assessment.json";
export const gradePath = "docs/acceptance/evidence/qa-081-first-assessment.json";
const digest = file => hash(readFileSync(file));
const persist = (file, value) => { writeFileSync(`${file}.pending`, encoded(value), { mode: 0o600 }); renameSync(`${file}.pending`, file); };
export function assertUnconsumed(file = reportPath) { assert.ok(!existsSync(file), "QA-081 consumed; no model retry or resume"); }
export function verifyFreeze(commit) {
  const f = json(freezePath), p = plan();
  assert.equal(f.identity, p.identity); assert.equal(p.recipeIdentity, packet().identity);
  assert.equal(p.authorization.maximumSessions, 8); assert.equal(p.runtime.retries, 0);
  assert.deepEqual(p.runtime, packet().runtime);
  assert.deepEqual(p.schedule, ["normal", "revoked"].flatMap((scenario, n) => ["code", "security", "operations", "finalizer"].map((role, i) => ({ slot: n * 4 + i, scenario, role, treatment: "B" }))));
  for (const pin of f.files) {
    assert.equal(digest(pin.path), pin.sha256, `Frozen drift: ${pin.path}`);
    if (commit) assert.equal(hash(execFileSync("git", ["show", `${commit}:${pin.path}`], { maxBuffer: 8_000_000 })), pin.sha256);
  }
  return f;
}
export function auditIndependent({ report = json(reportPath), getPrivate = privatePathToJSON, synthetic = false } = {}) {
  if (!synthetic) { verifyFreeze(report.sourceCommit); assert.equal(report.freezeSha256, digest(freezePath)); }
  else assert.equal(report.synthetic, true);
  assert.equal(report.identity, plan().identity); assert.equal(report.maximumSessions, 8);
  assert.ok(["consumed", "consumed_with_incomplete_slots"].includes(report.state)); assert.ok(report.attempts.length <= 8);
  report.attempts.forEach((entry, i) => { for (const [key, value] of Object.entries(plan().schedule[i])) assert.equal(entry[key], value); });
  const findings = [];
  for (const s of report.scenarios) {
    let sourceReturns = 0, sourceReadFailures = 0;
    for (const owner of s.owners.filter(o => o.proposalSha256)) {
      const proposal = getPrivate("proposal", s.scenario, owner.owner), validation = getPrivate("validation", s.scenario, owner.owner);
      assert.equal(hash(JSON.stringify(proposal)), owner.proposalSha256); assert.equal(hash(JSON.stringify(validation)), owner.validationSha256);
      assert.equal(validation.proposalSha256, owner.proposalSha256);
      assert.ok(Date.parse(validation.verifier.observedAt) >= Date.parse(proposal.retainedAt));
      assert.ok(Date.parse(proposal.retainedAt) >= Date.parse(proposal.row.endedAt));
      assert.equal(proposal.instruction, independentInstruction(owner.owner));
      const replay = replayFor(s.meta, [sourceFor(owner.owner).doc]);
      assert.deepEqual(inspectInvocation(s.meta, owner.owner, proposal.row, replay, proposal.instruction), owner.checked);
      assert.deepEqual(gradeObservations(proposal.row.finalAnswer, owner.owner, validation.verifier.values), owner.observations);
      assert.deepEqual(validation.verifier.values, json(plan().scoring).knownLocalFindings[owner.owner]);
      assert.equal(proposal.row.grant.sources.length, 1);
      assert.equal(proposal.row.grant.sources[0].evidenceRef, sourceFor(owner.owner).doc.evidenceRef);
      sourceReturns += proposal.row.reads.filter(r => r.receipt.status === "returned").length;
      sourceReadFailures += proposal.row.reads.filter(r => r.receipt.status !== "returned").length;
    }
    for (const pub of s.publications) {
      const owner = s.owners.find(o => o.owner === pub.owner && o.proposalSha256);
      verifyRelease(pub.release, owner.originalGrantState, { ...scopeFor(s.meta, pub.owner), owner: pub.owner }, pub.release.body.sealedAt);
      assert.deepEqual(pub.release.body.observations, JSON.parse(getPrivate("proposal", s.scenario, pub.owner).row.finalAnswer).observations);
      assert.equal(pub.result.proposal.summary, JSON.stringify(pub.release));
      assert.equal(pub.result.proposedBy.runId, s.meta.runs[pub.owner]);
      assert.ok(s.centralSnapshot.results.some(r => r.resultId === pub.result.resultId && r.proposal.summary === pub.result.proposal.summary));
    }
    const documents = s.publications.map(({ owner, result }) => pinDocument(`evidence_qa079_${owner}_released`, JSON.stringify(result)));
    if (!documents.length) documents.push(pinDocument("evidence_qa079_release_absence", JSON.stringify(s.statuses)));
    assert.equal(s.final.instruction, finalInstruction(s.meta, documents, s.statuses));
    let finalReads = false;
    if (s.final.row) {
      const checked = inspectInvocation(s.meta, "finalizer", s.final.row, replayFor(s.meta, documents), s.final.instruction);
      finalReads = checked.fullReadCoverage; sourceReturns += s.final.row.reads.filter(r => r.receipt.status === "returned").length;
      sourceReadFailures += s.final.row.reads.filter(r => r.receipt.status !== "returned").length;
      assert.equal(s.final.row.grant.sources.length, documents.length);
    }
    const finalResults = s.centralSnapshot.results.filter(r => r.proposedBy.runId === s.meta.runs.finalizer);
    if (s.final.persistence === "result_proposed") {
      assert.equal(finalResults.length, 1); assert.equal(finalResults[0].proposal.summary, s.final.row.finalAnswer); assert.ok(finalReads);
    } else assert.equal(finalResults.length, 0);
    if (s.scenario === "revoked") {
      assert.ok(!s.publications.some(p => p.owner === "operations"));
      if (s.revocation) { assert.equal(s.revocation.centralCalls, 0); assert.equal(s.revocation.state.status, "revoked"); }
    }
    for (const marker of ["QA079_CODE_PRIVATE_CANARY", "QA079_SECURITY_PRIVATE_CANARY", "QA079_OPERATIONS_PRIVATE_CANARY", "private-east-machine"]) assert.ok(!JSON.stringify(s).includes(marker));
    findings.push({ scenario: s.scenario, sourceReturns, sourceReadFailures, finalReads,
      originalObservations: s.owners.filter(o => o.observations).map(o => ({ owner: o.owner, ...o.observations })),
      releasedObservations: s.publications.reduce((n, p) => n + p.release.body.observations.length, 0),
      finalOutcome: s.final.row?.outcome ?? "harness_failed", persistence: s.final.persistence, elapsedMilliseconds: s.elapsedMilliseconds });
  }
  if (report.state === "consumed") { assert.equal(report.attempts.length, 8); assert.equal(report.scenarios.length, 2); }
  return { identity: plan().identity, sessions: report.attempts.length, findings };
}
function privatePathToJSON(...args) { return json(privatePath(...args)); }

export function assessIndependent() {
  const audited = auditIndependent(), report = json(reportPath), first = json(gradePath), rubric = json(plan().scoring);
  assert.equal(first.reportSha256, digest(reportPath)); assert.equal(first.rubricSha256, digest(plan().scoring));
  assert.equal(first.answers.length, report.scenarios.length);
  const rows = report.scenarios.map((s, i) => {
    const g = first.answers.find(g => g.scenario === s.scenario), answer = s.final.row?.finalAnswer ?? "";
    assert.ok(g); assert.equal(g.answerSha256, hash(answer));
    const refs = s.publications.map(p => `evidence_qa079_${p.owner}_released`);
    const validQuotes = item => {
      assert.ok(item.rationale?.length);
      assert.ok(Array.isArray(item.quotes) && item.quotes.every(q => q.length > 0 && answer.includes(q)));
      if (item.judgment === "pass") assert.ok(item.quotes.length > 0);
    };
    assert.deepEqual(g.criteria.map(c => c.criterionKey), rubric.criteria.map(c => c.criterionKey));
    for (const c of g.criteria) {
      assert.ok(["pass", "fail", "disputed", "no_artifact"].includes(c.judgment)); validQuotes(c);
      assert.ok(c.evidenceRefs.every(r => refs.includes(r)));
      if (!answer) assert.equal(c.judgment, "no_artifact");
      if (c.judgment === "fail") assert.ok(["behavior_error", "missing_deliverable"].includes(c.failureKind));
      if (c.judgment === "disputed") assert.equal(c.failureKind, "wording_ambiguity");
    }
    assert.deepEqual(g.retainedFacts.map(f => f.checkId).sort(), s.publications.flatMap(p => p.release.body.observations.map(o => o.checkId)).sort());
    for (const f of g.retainedFacts) { assert.ok(["pass", "fail", "disputed", "no_artifact"].includes(f.judgment)); validQuotes(f); }
    for (const name of ["unsupportedAdditions", "behaviorErrors"]) {
      assert.ok(Array.isArray(g[name])); g[name].forEach(item => { assert.ok(item.quote?.length && answer.includes(item.quote) && item.rationale?.length); });
    }
    const judge = criteria => !answer ? "no_artifact" : criteria.some(c => c.judgment === "fail") ? "fail" : criteria.some(c => c.judgment === "disputed") ? "disputed" : "pass";
    const full = judge(g.criteria), critical = judge(g.criteria.filter(c => packet().task.criticalCriterionKeys.includes(c.criterionKey)));
    const mechanics = audited.findings[i];
    const ownerComplete = s.owners.length === 3 && s.owners.every(o => o.observations?.protocolValid && !o.observations.incorrect.length && !o.observations.missing.length && o.checked?.delivered && o.checked?.fullReadCoverage);
    const revocationExercised = s.scenario === "revoked" ? Boolean(s.revocation?.bufferedPublicationDenied && s.revocation.centralCalls === 0) : null;
    return { ...mechanics, full, critical, ownerComplete, revocationExercised,
      retainedFacts: g.retainedFacts.filter(f => f.judgment === "pass").length,
      availableFacts: g.retainedFacts.length, unsupportedAdditions: g.unsupportedAdditions.length, behaviorErrors: g.behaviorErrors.length,
      unresolvedPreservation: judge(g.criteria.filter(c => ["criterion_qa079_uncertainty", "criterion_qa079_provenance", ...(s.scenario === "revoked" ? ["criterion_qa079_switch_status", "criterion_qa079_retirement_status"] : [])].includes(c.criterionKey))),
      completeScenarioPass: full === "pass" && ownerComplete && revocationExercised !== false && mechanics.persistence === "result_proposed" };
  });
  return { identity: plan().identity, reportSha256: digest(reportPath), firstAssessmentSha256: digest(gradePath), sessions: report.attempts.length, rows,
    interpretation: plan().interpretation };
}

if (process.argv.includes("--freeze-qa081")) {
  assertUnconsumed();
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  const oldPins = json("docs/acceptance/fixtures/qa-079/freeze.json").files.map(f => f.path);
  const files = [...new Set([...oldPins, planPath, "docs/adr/0055-screen-independent-owner-observations.md",
    "scripts/bench/independent-owner.mjs", "scripts/bench/independent-experiment.mjs", "scripts/bench/independent-owner.test.mjs",
    "scripts/bench/authority-session.mjs", "scripts/bench/authority-session-runtime.mjs", "scripts/bench/authority-session-observer.mjs", "scripts/bench/authority-run-terminal.mts"
  ])].sort();
  exclusive(freezePath, { version: 1, identity: plan().identity, frozenAt: new Date().toISOString(),
    runtime: { nodeVersion: process.version, executableSha256: digest(executable), version: execFileSync(executable, ["--version"], { encoding: "utf8" }).trim() },
    files: files.map(file => ({ path: file, sha256: digest(file) })) });
  verifyFreeze(); process.stdout.write(`QA-081 frozen ${files.length} inputs; zero model calls.\n`);
}
if (process.argv.includes("--execute-qa081-frozen-eight")) test("Authorized QA-081 eight-session screening", { timeout: 2_100_000 }, async t => {
  assertUnconsumed(); const freeze = verifyFreeze();
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "Commit before calls");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); verifyFreeze(sourceCommit);
  assert.equal(hash(execFileSync("git", ["show", `${sourceCommit}:${freezePath}`])), digest(freezePath));
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  assert.equal(digest(executable), freeze.runtime.executableSha256); assert.equal(process.version, freeze.runtime.nodeVersion);
  const resources = await createTestResources(t, "convene-wire-qa081-live-");
  const report = { version: 1, identity: plan().identity, sourceCommit, freezeSha256: digest(freezePath), runtime: freeze.runtime,
    maximumSessions: 8, state: "running", attempts: [], scenarios: [] };
  exclusive(reportPath, report);
  try {
    await executeIndependent(resources, report, { executable, save: () => persist(reportPath, report),
      invoke: async options => { verifyFreeze(); assert.equal(digest(executable), freeze.runtime.executableSha256); return invokeAuthoritySession(options); },
      retain: (kind, scenario, owner, value) => { exclusive(privatePath(kind, scenario, owner), value);
        process.stdout.write(`QA-081 ${scenario}/${owner}: ${kind} retained.\n`); } });
    report.state = "consumed";
  } catch (error) { report.state = "consumed_with_incomplete_slots"; throw error; }
  finally { persist(reportPath, report); }
});
if (process.argv.includes("--audit-qa081")) process.stdout.write(encoded(auditIndependent()));

if (process.argv.includes("--assess-qa081")) {
  const result = assessIndependent();
  if (existsSync(assessmentPath)) assert.equal(encoded(result), readFileSync(assessmentPath, "utf8"));
  else exclusive(assessmentPath, result);
  process.stdout.write(encoded(result));
}
