import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditReport } from "./evidence-access-report.mjs";

test("retained nine-call report matches every frozen treatment, source grant and instruction pin", () => {
  const audit = auditReport();
  assert.equal(audit.results.length, 9);
  assert.equal(audit.results.filter(row => row.outcome === "completed").length, 7);
  assert.equal(audit.results.filter(row => row.outcome === "failed").length, 2);
  assert.ok(audit.results.every(row => row.reads.returned === 0 && row.reads.denied === 0 && row.reads.failed === 0));
});

test("every judgment joins an exact retained answer, uses real quoted spans and preserves separate dimensions", () => {
  const audit = auditReport();
  const blind = JSON.parse(readFileSync("docs/acceptance/evidence/qa-072-blind-assessment-2026-09-06.json", "utf8"));
  const analysis = JSON.parse(readFileSync("docs/acceptance/evidence/qa-072-analysis-2026-09-06.json", "utf8"));
  assert.equal(blind.reportSha256, audit.reportSha256); assert.equal(analysis.reportSha256, audit.reportSha256);
  assert.equal(blind.grades.length, 9); assert.equal(analysis.results.length, 9);
  for (const answer of audit.answers) {
    const grade = blind.grades.find(row => row.answerSha256 === answer.answerSha256);
    const unmasked = analysis.results.find(row => row.answerSha256 === answer.answerSha256);
    assert.ok(grade && unmasked);
    assert.equal(grade.blindId, answer.blindId); assert.equal(unmasked.blindId, answer.blindId);
    for (const [dimension, ids] of Object.entries({ targetErrorCorrection: ["T1", "T2"],
      correctContentPreservation: ["P1", "P2", "P3", "P4"], uncertaintyPreservation: ["U1", "U2", "U3"],
      requiredDeliverableCoverage: ["D1", "D2", "D3", "D4"] })) {
      assert.deepEqual(grade[dimension].map(row => row.id), ids);
      assert.deepEqual(unmasked[dimension], grade[dimension].map(({ id, status }) => ({ id, status })));
      for (const item of grade[dimension]) {
        assert.ok(["pass", "partial", "fail", "unscorable"].includes(item.status));
        for (const quote of item.quotes) assert.ok(answer.finalAnswer.includes(quote), `${answer.blindId} ${item.id}: ${quote}`);
      }
    }
    for (const addition of grade.unsupportedAdditions) assert.ok(answer.finalAnswer.includes(addition.claim));
    assert.deepEqual(unmasked.unsupportedAdditions, grade.unsupportedAdditions.map(({ id, kind }) => ({ id, kind })));
    assert.equal(Object.hasOwn(unmasked, "netScore"), false);
    if (grade.answerKind === "progress_only") {
      assert.equal(unmasked.outcome, "failed");
      assert.ok(grade.targetErrorCorrection.every(row => row.status === "unscorable"));
    }
  }
  assert.equal(analysis.conclusions.Q1, "inconclusive");
  assert.equal(analysis.conclusions.Q2, "inconclusive");
});
