// Read-only result audit. Never starts a runtime or changes an experiment input.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
const hash = value => createHash("sha256").update(value).digest("hex");
const json = name => JSON.parse(readFileSync(name, "utf8"));
export function auditReport() {
  const fixture = json("docs/acceptance/fixtures/qa-072-evidence-access-use.json");
  const freeze = json("docs/acceptance/fixtures/qa-072-freeze.json");
  const reportPath = "docs/acceptance/evidence/qa-072-access-use-2026-09-06.json";
  const report = json(reportPath);
  assert.match(report.sourceCommit, /^[0-9a-f]{40}$/u);
  for (const pin of freeze.files) {
    // Maintenance can repair shared code. The recorded run still used this exact Git version.
    const historical = execFileSync("git", ["show", `${report.sourceCommit}:${pin.path}`]);
    assert.equal(hash(historical), pin.sha256, `Historical source changed: ${pin.path}`);
    if (pin.path.startsWith("docs/")) assert.equal(hash(readFileSync(pin.path)), pin.sha256, `Frozen input changed: ${pin.path}`);
  }
  assert.equal(report.state, "consumed");
  assert.equal(report.results.length, 9); assert.equal(report.attempts.length, 9);
  assert.equal(report.freezeSha256, hash(readFileSync("docs/acceptance/fixtures/qa-072-freeze.json")));
  const base = readFileSync("docs/acceptance/fixtures/qa-072-base-instruction.txt", "utf8");
  const original = json(fixture.provenance[0].path).cases.find(c => c.id === fixture.caseId);
  const ajv = new Ajv({ allErrors: true }); addFormats(ajv);
  const validate = ajv.compile(json("docs/acceptance/fixtures/qa-072-read-receipt.schema.json"));
  const results = report.results.map((result, index) => {
    const planned = fixture.order[index];
    for (const key of ["slot", "runId", "treatment", "repetition"]) assert.equal(result[key], planned[key]);
    assert.equal(report.attempts[index].state, "terminal");
    assert.equal(result.instructionSha256, hash(planned.treatment === "C" ? `${base}\n\n## Evidence-use requirement\n${fixture.useInstruction}` : base));
    assert.equal(result.answerSha256, hash(result.finalAnswer));
    assert.equal(result.requestedModel, fixture.runtime.model); assert.equal(result.reasoningEffort, fixture.runtime.reasoningEffort);
    assert.ok(result.elapsedMilliseconds >= 0);
    if (planned.treatment === "A") { assert.equal(result.grant, null); assert.deepEqual(result.reads, []); }
    else {
      assert.equal(result.grant.runId, planned.runId);
      assert.deepEqual(result.grant.sources, fixture.sources.map(({ evidenceRef, revision, contentSha256, allowedRange }) => ({ evidenceRef, revision, contentSha256, allowedRange })));
    }
    const fullReads = new Set(), counts = { returned: 0, denied: 0, failed: 0, truncated: 0 };
    for (const returned of result.reads) {
      const r = returned.receipt;
      assert.ok(validate(r), JSON.stringify(validate.errors));
      assert.equal(r.runId, planned.runId); assert.equal(r.taskId, fixture.task.taskId); assert.equal(r.roomId, fixture.task.roomId);
      assert.equal(r.experimentId, fixture.identity); assert.equal(r.authorityId, result.grant.authorityId);
      assert.ok(Date.parse(r.observedAt) >= Date.parse(result.observedAt));
      assert.ok(Date.parse(r.observedAt) <= Date.parse(result.endedAt));
      counts[r.status]++; if (r.truncated) counts.truncated++;
      if (r.status !== "returned") { assert.equal(returned.content, null); continue; }
      const pin = fixture.sources.find(s => s.evidenceRef === r.evidenceRef);
      assert.ok(pin); assert.equal(r.revision, pin.revision); assert.equal(r.sourceContentSha256, pin.contentSha256);
      assert.equal(r.contentSha256, hash(returned.content)); assert.equal(r.returnedBytes, Buffer.byteLength(returned.content));
      assert.equal(r.returnedRange.end - r.returnedRange.start, r.returnedBytes);
      assert.ok(r.returnedRange.start >= pin.allowedRange.start && r.returnedRange.end <= pin.allowedRange.end);
      const doc = original.documents.find(d => d.id === r.evidenceRef);
      assert.equal(returned.content, Buffer.from(doc.content).subarray(r.returnedRange.start, r.returnedRange.end).toString("utf8"));
      if (r.returnedRange.start === pin.allowedRange.start && r.returnedRange.end === pin.allowedRange.end &&
        !r.truncated && result.finalAnswerAt && Date.parse(r.observedAt) <= Date.parse(result.finalAnswerAt)) fullReads.add(r.evidenceRef);
    }
    return { slot: index, runId: planned.runId, treatment: planned.treatment, repetition: planned.repetition,
      outcome: result.outcome, elapsedMilliseconds: result.elapsedMilliseconds,
      reads: counts, fullSourcesBeforeAnswer: [...fullReads], allSourcesReturnedBeforeAnswer: fullReads.size === fixture.sources.length,
      wordInstructionMet: result.outputWordInstructionMet, wordCount: result.outputWordCount, answerSha256: result.answerSha256 };
  });
  return { reportSha256: hash(readFileSync(reportPath)), results,
    answers: report.results.map(({ answerSha256, finalAnswer }) => ({ answerSha256, finalAnswer }))
      .sort((a, b) => a.answerSha256.localeCompare(b.answerSha256))
      .map((item, index) => ({ blindId: `answer-${index + 1}`, ...item })) };
}
