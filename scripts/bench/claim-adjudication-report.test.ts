// Post-run integrity checks for retained human judgments; not a semantic model grader.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sha256 } from "./evidence-access-replay.js";
import { loadQa075 } from "./claim-adjudication-audit.js";
import { auditQa075, reportPath, screeningPath, blindPath } from "./claim-adjudication.js";

const prefix = "docs/acceptance/evidence/qa-075-";
const assessmentPath = `${prefix}blind-assessment-2026-09-06.json`;
const analysisPath = `${prefix}analysis-2026-09-06.json`;
const scoringPath = "docs/acceptance/fixtures/qa-075-scoring.json";
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const digest = (file: string) => sha256(readFileSync(file));
const categories = ["targetErrorCorrection", "correctContentPreservation", "uncertaintyPreservation", "requiredDeliverableCoverage"];

test("retained exports recompute from six frozen sessions and share exact report identity", () => {
  const { report, screening, blind } = auditQa075();
  assert.deepEqual(json(screeningPath), screening); assert.deepEqual(json(blindPath), blind);
  assert.equal(report.results.length, 6); assert.equal(screening.allCommonChecksPassed, true);
  assert.equal(screening.results.reduce((sum: number, row: any) => sum + row.actualReaderReturns, 0), 24);
  assert.equal(report.maximumFinalizerInvocations, 6);
});

test("all 78 separate judgments bind exact diagnoses and real answer spans without missing rubric items", () => {
  const blind = json(blindPath), assessment = json(assessmentPath), scoring = json(scoringPath);
  assert.equal(assessment.reportSha256, digest(reportPath));
  assert.equal(assessment.blindExportSha256, digest(blindPath)); assert.equal(assessment.scoringSha256, digest(scoringPath));
  assert.equal(assessment.grades.length, 6); assert.equal(new Set(assessment.grades.map((row: any) => row.blindId)).size, 6);
  let count = 0;
  for (const grade of assessment.grades) {
    const answer = blind.answers.find((row: any) => row.blindId === grade.blindId);
    assert.ok(answer?.scorable); assert.equal(grade.diagnosisSha256, answer.diagnosisSha256);
    assert.equal(sha256(answer.finalDiagnosis), grade.diagnosisSha256);
    for (const category of categories) {
      assert.deepEqual(grade[category].map((row: any) => row.id), scoring[category].map((row: any) => row.id));
      for (const item of grade[category]) {
        count++; assert.ok(scoring.states.includes(item.status)); assert.ok(item.reason.trim());
        assert.ok(item.quotes.length > 0);
        for (const quote of item.quotes) assert.ok(quote && answer.finalDiagnosis.includes(quote));
      }
    }
    for (const issue of [...grade.unsupportedAdditions, ...grade.policyConcerns]) assert.ok(answer.finalDiagnosis.includes(issue.quote));
    assert.ok(grade.unsupportedAssessment && grade.substantiveEvidenceCheck.reason);
  }
  assert.equal(count, 78);
});

test("manual evidence/claim/final judgments join exact table verdicts, returned sources and source quotes", () => {
  const report = json(reportPath), analysis = json(analysisPath), rubric = json(scoringPath), replay = loadQa075();
  assert.equal(analysis.reportSha256, digest(reportPath)); assert.equal(analysis.assessmentSha256, digest(assessmentPath));
  assert.equal(analysis.scoringSha256, digest(scoringPath)); assert.equal(analysis.results.length, 6);
  let claimCount = 0;
  for (const row of analysis.results) {
    const run = report.results[row.slot], artifacts = run.manipulation.artifacts;
    for (const key of ["slot", "treatment", "repetition", "runId", "answerSha256", "elapsedMilliseconds", "outcome"]) assert.equal(row[key], run[key]);
    assert.equal(row.diagnosisSha256, artifacts.diagnosisSha256);
    if (row.treatment === "C") {
      assert.equal(row.evidenceToClaimConsistency, "not_applicable_no_table");
      assert.equal(row.claimToFinalConsistency, "not_applicable_no_table"); continue;
    }
    assert.equal(row.evidenceToClaimConsistency.length, 2); assert.equal(row.claimToFinalConsistency.length, 2);
    for (const item of row.evidenceToClaimConsistency) {
      claimCount++;
      const check = artifacts.disposition.criterionChecks.find((check: any) => check.claimId === item.claimId);
      const expected = rubric.evidenceToClaimConsistency.find((check: any) => check.claimId === item.claimId);
      assert.equal(item.observedDisposition, check.disposition); assert.equal(item.expectedDisposition, expected.expectedDisposition);
      assert.deepEqual(item.evidenceRefs, check.evidenceRefs);
      assert.ok(item.evidenceRefs.every((ref: string) => run.manipulation.fullSourcesBeforeAnswer.includes(ref)));
      if (item.status === "pass") {
        assert.equal(item.observedDisposition, item.expectedDisposition);
        assert.ok(expected.requiredSources.every((ref: string) => item.evidenceRefs.includes(ref)));
      }
      assert.deepEqual(item.sourceQuotes.map((quote: any) => quote.evidenceRef), expected.requiredSources);
      for (const quote of item.sourceQuotes) assert.ok(replay.documents.find(doc => doc.evidenceRef === quote.evidenceRef)?.content.includes(quote.quote));
      const final = row.claimToFinalConsistency.find((check: any) => check.claimId === item.claimId);
      assert.equal(final.observedDisposition, check.disposition); assert.ok(rubric.consistencyStates.includes(final.status));
      assert.ok(final.finalQuotes.length > 0 && final.finalQuotes.every((quote: string) => artifacts.finalDiagnosis.includes(quote)));
    }
    assert.equal(row.fourthManipulationCheck === "passed", row.dispositionProtocol === "structurally_valid" &&
      row.claimToFinalConsistency.every((item: any) => item.status === "consistent"));
  }
  assert.equal(claimCount, 6);
});

test("per-arm summaries derive from all attempts, without netting correctness against lost content", () => {
  const analysis = json(analysisPath), grades = json(assessmentPath).grades;
  for (const arm of ["C", "D"]) {
    const rows = analysis.results.filter((row: any) => row.treatment === arm), summary = analysis.byTreatment[arm];
    assert.equal(summary.attempts, rows.length); assert.equal(rows.length, 3);
    for (const row of rows) {
      const grade = grades.find((grade: any) => grade.blindId === row.blindId);
      for (const category of [...categories, "unsupportedAdditions"]) assert.deepEqual(row[category], grade[category]);
    }
    assert.equal(summary.targetCorrect, rows.filter((row: any) => row.targetErrorCorrection.every((item: any) => item.status === "pass")).length);
    assert.equal(summary.completeDeliverable, rows.filter((row: any) => row.requiredDeliverableCoverage.every((item: any) => item.status === "pass")).length);
    for (const [category, key] of [["correctContentPreservation", "preservationItems"], ["uncertaintyPreservation", "uncertaintyItems"], ["requiredDeliverableCoverage", "deliverableItems"]]) {
      for (const [id, states] of Object.entries(summary[key])) for (const [state, count] of Object.entries(states as object)) {
        assert.equal(count, rows.filter((row: any) => row[category].find((item: any) => item.id === id).status === state).length);
      }
    }
    assert.equal(summary.unsupportedAdditions, rows.reduce((sum: number, row: any) => sum + row.unsupportedAdditions.length, 0));
    assert.deepEqual(summary.elapsedMilliseconds, rows.map((row: any) => row.elapsedMilliseconds));
    assert.equal(summary.medianElapsedMilliseconds, [...summary.elapsedMilliseconds].sort((a, b) => a - b)[1]);
    if (arm === "D") {
      assert.equal(summary.evidenceToClaimPass, rows.flatMap((row: any) => row.evidenceToClaimConsistency).filter((item: any) => item.status === "pass").length);
      assert.equal(summary.claimToFinalConsistent, rows.flatMap((row: any) => row.claimToFinalConsistency).filter((item: any) => item.status === "consistent").length);
      assert.equal(summary.claimToFinalContradictory, rows.flatMap((row: any) => row.claimToFinalConsistency).filter((item: any) => item.status === "contradictory").length);
    }
  }
});
