// QA-078 only: plain replies and fixed sources, no production persistence or scheduler.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { evidenceToolDefinition, hash, readEvidence } from "./evidence-access-reader.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";

export const fixtureDirectory = "docs/acceptance/fixtures/qa-078";
export const packetPath = `${fixtureDirectory}/packet.json`;
export const readJson = file => JSON.parse(readFileSync(file, "utf8"));
export const digest = file => hash(readFileSync(file));
export const roles = ["single", "contributor1", "contributor2", "finalizer"];

export function assertAuthorized(packet) {
  assert.equal(packet.identity, "qa-078-export-strong-single-discussion-v1");
  assert.equal(packet.runtime.model, "gpt-5.5"); assert.equal(packet.runtime.reasoningEffort, "low");
  assert.equal(packet.runtime.maximumSessions, 12); assert.equal(packet.runtime.retries, 0);
  assert.equal(packet.runtime.timeoutMilliseconds, 300000);
  assert.equal(packet.runtime.maximumReadCalls, 8); assert.equal(packet.runtime.maximumReturnBytes, 8192);
  assert.equal(packet.runtime.maximumAnswerBytes, 32768); assert.equal(packet.runtime.maximumContributionBytes, 32768);
  const a = packet.authorization;
  assert.equal(a.state, "authorized"); assert.equal(a.approvedBy, "Owner");
  assert.equal(a.approvalText, "可以，定好目标把制作并冻结题包、参考答案和评分规则到实验完成做完");
  assert.equal(a.maximumSessions, 12); assert.ok(Number.isFinite(Date.parse(a.approvedAt)));
  assert.equal(a.destination, "OpenAI via installed Codex CLI using existing ChatGPT authentication");
  const trials = ["S", "D", "D", "S", "S", "D"].map((arm, i) =>
    ({ trialId: `trial_qa078_${i + 1}`, arm, repetition: Math.floor(i / 2) + 1 }));
  assert.deepEqual(packet.trials, trials);
  let slot = 0;
  const sessions = trials.flatMap(trial => (trial.arm === "S" ? ["single"] : ["contributor1", "contributor2", "finalizer"])
    .map(role => ({ ...trial, role, slot, runId: `run_qa078_export_${++slot}`, treatment: trial.arm })));
  assert.deepEqual(packet.sessions, sessions);
}

export function loadStrongPacket() {
  const fixture = readJson(packetPath); assertAuthorized(fixture);
  assert.equal(fixture.sources.length, 4);
  const documents = fixture.sources.map(source => {
    const bytes = readFileSync(source.path);
    assert.equal(source.contentSha256, hash(bytes), source.evidenceRef);
    assert.equal(source.revision, createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex"));
    assert.deepEqual(source.allowedRange, { start: 0, end: bytes.length });
    assert.ok(bytes.length > 0 && bytes.length <= fixture.runtime.maximumReturnBytes);
    return { ...source, content: bytes.toString("utf8") };
  });
  const ids = fixture.sources.map(s => s.evidenceRef);
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(fixture.partitions.single, ids); assert.deepEqual(fixture.partitions.finalizer, ids);
  assert.deepEqual(fixture.partitions.contributor1, ids.slice(0, 2));
  assert.deepEqual(fixture.partitions.contributor2, ids.slice(2));
  return { fixture, documents };
}

export function roleReplay(replay, role) {
  assert.ok(roles.includes(role));
  const refs = replay.fixture.partitions[role];
  return { fixture: { ...replay.fixture, sources: replay.fixture.sources.filter(s => refs.includes(s.evidenceRef)) },
    documents: replay.documents.filter(s => refs.includes(s.evidenceRef)) };
}

export function baseInstruction(replay, role = "single") {
  const selected = roleReplay(replay, role);
  const instruction = role.startsWith("contributor") ? replay.fixture.contributorInstruction : replay.fixture.commonInstruction;
  return `${instruction}\n\nTask and canonical criteria:\n${JSON.stringify(replay.fixture.task, null, 2)}\n\nAuthorized fixed sources (omit range to read the complete source):\n${JSON.stringify(selected.fixture.sources.map(({ path: _path, ...source }) => source), null, 2)}\n`;
}

export function contributionTransfer(replay, scheduled, results) {
  assert.equal(scheduled.role, "finalizer");
  return ["contributor1", "contributor2"].map(role => {
    const planned = replay.fixture.sessions.find(s => s.trialId === scheduled.trialId && s.role === role);
    const row = results.find(r => r.runId === planned.runId);
    assert.ok(row && row.role === role && row.trialId === scheduled.trialId, "Current-trial contribution required");
    assert.equal(row.answerSha256, hash(row.finalAnswer));
    assert.ok(Buffer.byteLength(row.finalAnswer) <= replay.fixture.runtime.maximumContributionBytes, "No silent contribution truncation");
    const usable = row.outcome === "completed" && row.finalAnswer.length > 0;
    return { kind: "plain_reply", runId: row.runId, role, outcome: row.outcome,
      text: usable ? row.finalAnswer : "", answerSha256: row.answerSha256,
      returnedSourceRefs: row.manipulation?.fullSourcesBeforeAnswer ?? [],
      omittedBytes: 0, unavailableReason: usable ? null : "Contributor did not deliver a valid terminal reply." };
  });
}

export function sessionInstruction(replay, scheduled, results = []) {
  const base = baseInstruction(replay, scheduled.role);
  if (scheduled.role !== "finalizer") return base;
  return `${base}\n${replay.fixture.contributionPreamble}\n${JSON.stringify(contributionTransfer(replay, scheduled, results), null, 2)}\n`;
}

export function inspectSession(replay, row, instruction) {
  const selected = roleReplay(replay, row.role), expected = makeAccess(selected, row, row.observedAt);
  const counts = { returned: 0, denied: 0, failed: 0, invalid: 0, truncated: 0 };
  const full = new Set();
  const catalog = (row.readerLifecycle ?? []).filter(e => e.stage === "tools_listed");
  const catalogValid = catalog.length > 0 && catalog.every(e => e.runId === row.runId &&
    e.definitionSha256 === hash(JSON.stringify(evidenceToolDefinition(expected.bundle))) &&
    Date.parse(e.observedAt) >= Date.parse(row.observedAt) && Date.parse(e.observedAt) <= Date.parse(row.endedAt));
  const grantValid = JSON.stringify(row.grant) === JSON.stringify(expected.control.grant);
  for (const [attempt, returned] of (row.reads ?? []).entries()) {
    try {
      const receipt = returned.receipt;
      assert.ok(Date.parse(receipt.observedAt) >= Date.parse(row.observedAt) && Date.parse(receipt.observedAt) <= Date.parse(row.endedAt));
      for (const key of ["experimentId", "authorityId", "taskId", "roomId", "runId"]) assert.equal(receipt[key], expected.bundle[key]);
      if (receipt.status === "returned") {
        assert.ok(grantValid);
        const verified = readEvidence({ bundle: expected.bundle, grant: expected.control.grant, currentRun: expected.control.run,
          call: { name: "read_evidence", arguments: { evidenceRef: receipt.evidenceRef, revision: receipt.revision, range: receipt.requestedRange } }, attempt, now: receipt.observedAt });
        assert.deepEqual(returned, verified);
        assert.equal(receipt.status, "returned");
        counts.returned++; if (receipt.truncated) counts.truncated++;
        const doc = selected.documents.find(d => d.evidenceRef === receipt.evidenceRef);
        if (!receipt.truncated && JSON.stringify(receipt.returnedRange) === JSON.stringify(doc.allowedRange) &&
            row.finalAnswerAt && Date.parse(receipt.observedAt) <= Date.parse(row.finalAnswerAt)) full.add(doc.evidenceRef);
      } else {
        assert.ok(["denied", "failed"].includes(receipt.status));
        assert.equal(returned.content, null); assert.equal(receipt.returnedBytes, 0);
        assert.equal(receipt.contentSha256, null); assert.equal(receipt.returnedRange, null);
        assert.equal(receipt.truncated, false); assert.equal(typeof receipt.failureReason, "string");
        counts[receipt.status]++;
      }
    } catch { counts.invalid++; }
  }
  const instructionValid = row.instructionSha256 === hash(instruction);
  const modelValid = row.requestedModel === replay.fixture.runtime.model && row.reasoningEffort === replay.fixture.runtime.reasoningEffort;
  const delivered = row.outcome === "completed" && row.turnCompleted === true && row.failures.length === 0 &&
    Boolean(row.finalAnswer?.trim()) && Boolean(row.finalAnswerAt) && row.answerSha256 === hash(row.finalAnswer);
  return { catalogValid, grantValid, instructionValid, modelValid, counts, delivered,
    fullSourcesBeforeAnswer: selected.documents.filter(d => full.has(d.evidenceRef)).map(d => d.evidenceRef),
    valid: catalogValid && grantValid && instructionValid && modelValid && delivered &&
      full.size === selected.documents.length && counts.invalid + counts.denied + counts.failed + counts.truncated === 0 };
}

export function reserveSession(report, scheduled, packet) {
  assert.ok(scheduled.slot === report.attempts.length && scheduled.slot < 12, "No retry, skip, reordering or extra session");
  assert.deepEqual(scheduled, packet.sessions[scheduled.slot]);
  report.attempts.push({ ...scheduled, state: "reserved", reservedAt: new Date().toISOString() });
}

export async function executeSchedule(replay, report, invoke, persist = () => {}) {
  const run = async scheduled => {
    reserveSession(report, scheduled, replay.fixture); persist();
    const instruction = sessionInstruction(replay, scheduled, report.results);
    Object.assign(report.attempts[scheduled.slot], { instruction, instructionSha256: hash(instruction) }); persist();
    const row = await invoke(scheduled, instruction);
    row.manipulation = inspectSession(replay, row, instruction);
    report.results.push(row); report.results.sort((a, b) => a.slot - b.slot);
    report.attempts[scheduled.slot].state = "terminal";
    delete report.attempts[scheduled.slot].partial; persist();
    return row;
  };
  for (const trial of replay.fixture.trials) {
    const record = { ...trial, observedAt: new Date().toISOString(), endedAt: null, elapsedMilliseconds: null };
    report.trials.push(record); persist();
    const scheduled = replay.fixture.sessions.filter(s => s.trialId === trial.trialId);
    if (trial.arm === "D") {
      const settled = await Promise.allSettled(scheduled.slice(0, 2).map(run));
      const error = settled.find(result => result.status === "rejected");
      if (error) throw new Error("Harness interrupted during contributors; no same-plan resume.");
      await run(scheduled[2]);
    } else await run(scheduled[0]);
    record.endedAt = new Date().toISOString();
    record.elapsedMilliseconds = Date.parse(record.endedAt) - Date.parse(record.observedAt); persist();
  }
}

export function validateFirstGrades(replay, blind, first) {
  const rubric = readJson(`${fixtureDirectory}/scoring.json`);
  assert.equal(first.packetSha256, digest(packetPath));
  assert.equal(first.rubricSha256, digest(`${fixtureDirectory}/scoring.json`));
  assert.equal(first.answers.length, blind.answers.length);
  const sourceIds = replay.fixture.sources.map(s => s.evidenceRef);
  const checks = first.answers.map((row, index) => {
    const answer = blind.answers[index];
    assert.equal(row.blindId, answer.blindId); assert.equal(row.answerSha256, answer.answerSha256);
    assert.deepEqual(row.criteria.map(c => c.criterionKey), replay.fixture.task.criteria.map(c => c.criterionKey));
    for (const judgment of row.criteria) {
      assert.ok(rubric.judgments.includes(judgment.judgment));
      assert.ok(typeof judgment.rationale === "string" && judgment.rationale.length >= 12);
      assert.ok(judgment.evidenceRefs.length > 0 && judgment.evidenceRefs.every(id => sourceIds.includes(id)));
      assert.ok(judgment.quotes.every(q => typeof q === "string" && q.length > 0 && answer.finalAnswer.includes(q)));
      if (judgment.judgment === "pass") { assert.ok(judgment.quotes.length > 0); assert.equal(judgment.failureKind, null); }
      if (judgment.judgment === "fail") assert.ok(["behavior_error", "missing_deliverable"].includes(judgment.failureKind));
      if (judgment.judgment === "disputed") assert.equal(judgment.failureKind, "wording_ambiguity");
      if (!answer.delivered) assert.equal(judgment.judgment, "unscorable");
    }
    for (const group of ["facts", "unknowns"]) {
      assert.deepEqual(row[group].map(x => x.id), rubric[group].map(x => x.id));
      for (const j of row[group]) {
        assert.ok(["preserved", "lost", "contradicted", "disputed", "unscorable"].includes(j.judgment));
        assert.ok(j.quotes.every(q => typeof q === "string" && q.length > 0 && answer.finalAnswer.includes(q)));
        if (j.judgment === "preserved") assert.ok(j.quotes.length > 0);
        if (!answer.delivered) assert.equal(j.judgment, "unscorable");
        assert.ok(j.rationale.length >= 12);
      }
    }
    for (const addition of row.unsupportedAdditions) {
      assert.ok(answer.finalAnswer.includes(addition.claim) && addition.claim.length > 0);
      assert.ok(addition.rationale.length >= 12 && addition.evidenceRefs.every(id => sourceIds.includes(id)));
    }
    const definiteFailure = row.criteria.some(c => c.judgment === "fail") || row.unsupportedAdditions.length > 0;
    const allPass = row.criteria.every(c => c.judgment === "pass") && !definiteFailure;
    const state = !answer.delivered ? "no_artifact" : definiteFailure ? "fail" : allPass ? "pass" : "disputed";
    return { blindId: row.blindId, full: state, critical: state,
      unsupportedAdditions: row.unsupportedAdditions.length,
      facts: Object.fromEntries(row.facts.map(j => [j.id, j.judgment])),
      unknowns: Object.fromEntries(row.unknowns.map(j => [j.id, j.judgment])) };
  });
  return checks;
}
