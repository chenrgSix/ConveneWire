import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assessmentPath, buildQa077Assessment } from "./criterion-gpt55-report.mjs";
import { assertQa077Unconsumed, loadQa077, reportPath } from "./criterion-gpt55-run.mjs";
import { assessClosureOutput } from "./criterion-closure.mjs";
import { validateFirstJudgments } from "./criterion-closure-report.mjs";

const read = file => JSON.parse(readFileSync(file, "utf8"));
const report = read(reportPath), assessment = read(assessmentPath);
const first = read("docs/acceptance/evidence/qa-077-first-assessment.json");
const exported = read("docs/acceptance/evidence/qa-077-final-only.json");

test("six frozen GPT-5.5 results recompute from exact receipts and immutable first/table judgments", () => {
  assert.deepEqual(buildQa077Assessment(), assessment);
  assert.equal(report.state, "consumed"); assert.equal(assessment.consumedInvocations, 6);
  assert.throws(() => assertQa077Unconsumed(), /consumed/);
  for (const row of assessment.results) {
    assert.equal(row.requestedModel, "gpt-5.5"); assert.equal(row.reasoningEffort, "low");
    assert.equal(row.setup, "passed"); assert.equal(row.actualReaderReturns, 4);
    assert.deepEqual(row.sourceReadCounts, { returned: 4, denied: 0, failed: 0, invalid: 0, truncated: 0, beforeAnswer: 4 });
    assert.equal(row.commonManipulationValid, true);
  }
});

test("all 48 first judgments bind real artifact quotations and all canonical requirements", () => {
  validateFirstJudgments(first, exported); const { replay } = loadQa077();
  for (const entry of first.reviews) {
    const run = report.results.find(row => row.screening.assessment.parsed.finalArtifactSha256 === entry.review.finalArtifactSha256);
    assert.ok(run);
    const result = assessClosureOutput(run.finalAnswer, run.treatment, replay, run.screening.fullSourcesBeforeAnswer, entry.review);
    assert.equal(result.reviewValid, true); assert.equal(result.criteria.length, 8);
  }
  const changed = structuredClone(first); changed.reviews[0].review.criteria[0].quotes.push("a nonexistent QA-077 approval");
  assert.throws(() => validateFirstJudgments(changed, exported));
});

test("complete versus critical delivery remains separate when duplicate regression permits unresolved", () => {
  assert.deepEqual(assessment.results.map(row => row.fullRequiredDeliverablePass), [true, false, true, true, true, false]);
  assert.ok(assessment.results.every(row => row.criticalCriteriaPass));
  assert.equal(assessment.arms.E.fullPass, 3); assert.equal(assessment.arms.F.fullPass, 1);
  for (const slot of [1, 5]) {
    const row = assessment.results[slot];
    assert.deepEqual(row.criteria.filter(item => item.status !== "pass").map(item => item.criterionKey), ["criterion_qa076_regressions"]);
    const judgment = first.reviews.find(item => item.blindId === row.blindId).review.criteria.find(item => item.status === "fail");
    assert.ok(judgment.quotes.some(quote => quote.includes("unresolved")));
  }
});

test("three structurally valid all-satisfied tables retain two failed-criterion overclaims", () => {
  const rows = assessment.results.filter(row => row.treatment === "F");
  assert.ok(rows.every(row => row.closureProtocol === "structurally_valid"));
  assert.deepEqual(rows.map(row => row.criterionToFinalStatus.filter(item => item.comparison === "overclaimed").length), [1, 0, 1]);
  assert.equal(assessment.arms.F.overclaimedCriteria, 2);
  assert.equal(assessment.candidateWithinTaskSignal, false);
});

test("preservation, uncertainty, unsupported additions and actual overhead remain independently visible", () => {
  for (const row of assessment.results) {
    assert.ok(row.correctContentPreservationCriterionProjection.every(item => item.status === "pass"));
    assert.equal(row.unresolvedPreservationCriterionProjection, "pass");
    assert.deepEqual(row.unsupportedAdditions, { reviewStatus: "assessed", count: 0 });
    assert.equal(row.elapsedMilliseconds, report.results[row.slot].elapsedMilliseconds);
  }
  assert.equal(assessment.arms.F.meanClosureBytes, 1327); assert.equal(assessment.arms.E.meanClosureBytes, 0);
  assert.ok(assessment.limitations.some(value => value.includes("historical/descriptive")));
});
