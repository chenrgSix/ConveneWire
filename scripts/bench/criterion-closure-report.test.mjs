import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hash } from "./evidence-access-reader.mjs";
import { assertUnconsumed, reportPath } from "./criterion-closure-run.mjs";
import { loadClosurePacket, assessClosureOutput } from "./criterion-closure.mjs";
import { assessmentPath, buildClosureAssessment, validateFirstJudgments } from "./criterion-closure-report.mjs";

const read = file => JSON.parse(readFileSync(file, "utf8"));
const report = read(reportPath), assessed = read(assessmentPath);
const first = read("docs/acceptance/evidence/qa-076-first-assessment.json");
const exported = read("docs/acceptance/evidence/qa-076-final-only.json");
const replay = loadClosurePacket();

test("retained six-session journal and all source scopes re-audit without invoking a provider", () => {
  assert.deepEqual(buildClosureAssessment(), assessed);
  assert.equal(report.state, "consumed");
  assert.deepEqual(report.results.map(row => row.treatment), ["E", "F", "F", "E", "E", "F"]);
  assert.throws(() => assertUnconsumed(), /consumed/);
  assert.equal(assessed.consumedInvocations, 6);
  for (const row of assessed.results) {
    assert.equal(row.setup, "passed"); assert.equal(row.actualReaderReturns, 4);
    assert.deepEqual(row.sourceReadCounts, { returned: 4, denied: 0, failed: 0, invalid: 0, truncated: 0, beforeAnswer: 4 });
  }
});

test("blind first judgments bind every final artifact, eight criteria and actual quoted evidence", () => {
  validateFirstJudgments(first, exported);
  for (const entry of first.reviews) {
    const run = report.results.find(row => row.screening.assessment.parsed.finalArtifactSha256 === entry.review.finalArtifactSha256);
    assert.ok(run);
    const checked = assessClosureOutput(run.finalAnswer, run.treatment, replay, run.screening.fullSourcesBeforeAnswer, entry.review);
    assert.equal(checked.reviewValid, true); assert.equal(checked.criteria.length, 8);
  }
});

test("a reordered, cross-artifact or invented quote judgment cannot join the retained evidence", () => {
  const reordered = structuredClone(first);
  [reordered.reviews[0], reordered.reviews[1]] = [reordered.reviews[1], reordered.reviews[0]];
  assert.throws(() => validateFirstJudgments(reordered, exported));
  const wrong = structuredClone(first); wrong.reviews[0].review.finalArtifactSha256 = "0".repeat(64);
  assert.throws(() => validateFirstJudgments(wrong, exported));
  const invented = structuredClone(first); invented.reviews[0].review.criteria[0].quotes.push("absent QA-076 attestation");
  assert.throws(() => validateFirstJudgments(invented, exported));
});

test("all-satisfied F tables with valid returned references retain twelve overclaims and zero full passes", () => {
  const rows = assessed.results.filter(row => row.treatment === "F");
  assert.ok(rows.every(row => row.closureProtocol === "structurally_valid"));
  assert.deepEqual(rows.map(row => row.criterionToFinalStatus.filter(item => item.comparison === "overclaimed").length), [3, 5, 4]);
  assert.ok(rows.every(row => !row.fullRequiredDeliverablePass && !row.criticalCriteriaPass));
  assert.equal(assessed.arms.F.overclaimedCriteria, 12);
  assert.equal(assessed.candidateWithinTaskSignal, false);
});

test("delivered output with escaped closing delimiter remains unscorable, never repaired into a pass", () => {
  const row = assessed.results[4];
  assert.equal(row.delivered, true); assert.equal(row.requiredReading, "complete");
  assert.equal(row.finalSchemaValid, false); assert.equal(row.commonManipulationValid, false);
  assert.deepEqual(row.formatErrors, ["invalid_final_artifact"]);
  assert.equal(row.finalArtifactSha256, hash("")); assert.equal(row.finalArtifactBytes, 0);
  assert.equal(row.unsupportedAdditions.count, null);
  const judgment = first.reviews.find(item => item.blindId === row.blindId);
  assert.ok(judgment.review.criteria.every(item => item.status === "unscorable"));
  assert.equal(assessed.arms.E.scheduled, 3); assert.equal(assessed.arms.E.fullPass, 0);
});

test("primary, critical, omissions, unsupported additions and overhead remain separate outcomes", () => {
  assert.equal(assessed.arms.E.fullPass, 0); assert.equal(assessed.arms.F.fullPass, 0);
  assert.equal(assessed.arms.E.criticalPass, 1); assert.equal(assessed.arms.F.criticalPass, 0);
  for (const row of assessed.results.filter(item => item.finalSchemaValid)) {
    assert.equal(row.criteria.find(item => item.criterionKey === "criterion_qa076_regressions").status, "fail");
  }
  assert.deepEqual(assessed.results.map(row => row.unsupportedAdditions.count), [0, 2, 2, 2, null, 1]);
  assert.deepEqual(assessed.results.map(row => row.elapsedMilliseconds), report.results.map(row => row.elapsedMilliseconds));
  assert.ok(assessed.arms.F.meanClosureBytes > 0); assert.equal(assessed.arms.E.meanClosureBytes, 0);
});
