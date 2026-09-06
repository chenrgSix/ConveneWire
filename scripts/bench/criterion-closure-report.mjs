import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hash } from "./evidence-access-reader.mjs";
import { auditClosureReport, reportPath } from "./criterion-closure-run.mjs";
import { directory, loadClosurePacket, inspectClosureRun } from "./criterion-closure.mjs";

const prefix = "docs/acceptance/evidence/qa-076-";
export const assessmentPath = `${prefix}assessment.json`;
const read = file => JSON.parse(readFileSync(file, "utf8"));
const digest = file => hash(readFileSync(file));
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function validateFirstJudgments(first, exported) {
  assert.equal(first.reportSha256, exported.reportSha256);
  assert.deepEqual(first.reviews.map(row => row.blindId), exported.answers.map(row => row.blindId));
  assert.equal(first.reviews.length, 6);
  for (const [index, row] of first.reviews.entries()) {
    const answer = exported.answers[index];
    assert.equal(row.review.finalArtifactSha256, answer.finalArtifactSha256);
    assert.equal(hash(answer.finalArtifact), answer.finalArtifactSha256);
    assert.equal(row.unsupportedReviewStatus, answer.finalArtifact ? "assessed" : "unscorable_no_final_artifact");
    for (const item of [...row.review.criteria, ...row.review.unsupportedAdditions]) {
      for (const quote of item.quotes) assert.ok(quote && answer.finalArtifact.includes(quote));
    }
  }
}

export function buildClosureAssessment() {
  const audit = auditClosureReport(), report = read(reportPath), replay = loadClosurePacket();
  const exported = read(`${prefix}final-only.json`), first = read(`${prefix}first-assessment.json`);
  const closure = read(`${prefix}closure-review.json`);
  assert.equal(exported.reportSha256, audit.reportSha256);
  validateFirstJudgments(first, exported);
  assert.equal(first.finalOnlyExportSha256, digest(`${prefix}final-only.json`));
  assert.equal(first.scoringSha256, digest(`${directory}/scoring.json`));
  assert.equal(closure.firstAssessmentSha256, digest(`${prefix}first-assessment.json`));
  assert.equal(closure.reportSha256, audit.reportSha256);
  assert.ok(Date.parse(first.recordedAt) <= Date.parse(closure.recordedAt));
  assert.deepEqual(closure.rows.map(row => row.slot), [1, 2, 5]);
  const results = report.results.map(row => {
    const grade = first.reviews.find(item => item.review.finalArtifactSha256 === row.screening.assessment.parsed.finalArtifactSha256);
    assert.ok(grade);
    const checked = inspectClosureRun(replay, row, grade.review), a = checked.assessment;
    const tableReview = closure.rows.find(item => item.slot === row.slot);
    if (tableReview) {
      assert.equal(tableReview.runId, row.runId); assert.equal(tableReview.answerSha256, row.answerSha256);
      assert.equal(tableReview.closureSha256, hash(a.parsed.closure.raw));
      assert.deepEqual(tableReview.criterionChecks.map(item => item.criterionKey), replay.fixture.task.criteria.map(item => item.criterionKey));
      for (const [index, item] of tableReview.criterionChecks.entries()) {
        const actual = a.parsed.closure.value.criterionChecks[index];
        assert.equal(item.assertedStatus, actual.status);
        assert.deepEqual(item.evidenceRefs, actual.evidenceRefs); assert.deepEqual(item.missing, actual.missing);
        assert.ok(item.evidenceRefs.every(ref => checked.fullSourcesBeforeAnswer.includes(ref)));
        assert.ok(item.sourceRelevanceReason && item.reason);
        assert.equal(item.missingAssessment, a.criteria[index].status === "pass" ? "adequate" : "omits_final_defect");
      }
    }
    return {
      slot: row.slot, runId: row.runId, treatment: row.treatment, repetition: row.repetition, blindId: grade.blindId,
      answerSha256: row.answerSha256, finalArtifactSha256: a.parsed.finalArtifactSha256,
      outcome: row.outcome, delivered: checked.delivered, elapsedMilliseconds: row.elapsedMilliseconds,
      setup: checked.setup, readerCatalogObserved: checked.catalogObserved, sourceAccessGrantValid: checked.sourceAccessGrantValid,
      evidenceUseRuleSupplied: checked.evidenceUseRuleSupplied, requiredReading: checked.requiredReading,
      actualReaderReturns: checked.actualReaderReturns, sourceReadCounts: checked.counts,
      fullSourcesBeforeAnswer: checked.fullSourcesBeforeAnswer,
      commonManipulationValid: checked.commonManipulationValid, closureProtocol: checked.closureProtocol,
      finalSchemaValid: a.parsed.finalSchemaValid, formatErrors: a.parsed.errors,
      fullRequiredDeliverablePass: checked.fullRequiredDeliverablePass, criticalCriteriaPass: checked.criticalCriteriaPass,
      criteria: a.criteria, correctContentPreservationCriterionProjection: a.correctContentPreservation,
      unresolvedPreservationCriterionProjection: a.unresolvedPreservation,
      unsupportedAdditions: { reviewStatus: grade.unsupportedReviewStatus,
        count: grade.unsupportedReviewStatus === "assessed" ? a.unsupportedAdditions.length : null },
      criterionToFinalStatus: a.criterionToFinalStatus,
      closureSemanticReview: tableReview ? "retained_in_qa076_closure_review" : "not_applicable",
      finalArtifactBytes: a.parsed.finalArtifactBytes, closureBytes: a.parsed.closureBytes, terminalBytes: a.parsed.terminalBytes
    };
  });
  const arms = Object.fromEntries(["E", "F"].map(arm => {
    const rows = results.filter(row => row.treatment === arm);
    return [arm, { scheduled: rows.length, delivered: rows.filter(row => row.delivered).length,
      fullPass: rows.filter(row => row.fullRequiredDeliverablePass).length,
      criticalPass: rows.filter(row => row.criticalCriteriaPass).length,
      allSourceReturns: rows.filter(row => row.requiredReading === "complete").length,
      finalSchemaPass: rows.filter(row => row.finalSchemaValid).length,
      commonManipulationPass: rows.filter(row => row.commonManipulationValid).length,
      unsupportedClaimsAssessed: rows.reduce((n, row) => n + (row.unsupportedAdditions.count ?? 0), 0),
      unsupportedUnscorableRuns: rows.filter(row => row.unsupportedAdditions.count === null).length,
      overclaimedCriteria: rows.flatMap(row => row.criterionToFinalStatus).filter(row => row.comparison === "overclaimed").length,
      meanElapsedMilliseconds: mean(rows.map(row => row.elapsedMilliseconds)), medianElapsedMilliseconds: median(rows.map(row => row.elapsedMilliseconds)),
      meanClosureBytes: mean(rows.map(row => row.closureBytes)), meanTerminalBytes: mean(rows.map(row => row.terminalBytes)) }];
  }));
  const signal = arms.F.fullPass === 3 && arms.E.fullPass <= 1 && results.every(row => row.commonManipulationValid) &&
    results.filter(row => row.treatment === "F").every(row => row.closureProtocol === "structurally_valid" &&
      row.correctContentPreservationCriterionProjection.every(item => item.status === "pass") &&
      row.unresolvedPreservationCriterionProjection === "pass" && row.unsupportedAdditions.count === 0);
  const diagnostic = closure.unblindedFormatDiagnostic;
  assert.equal(diagnostic.answerSha256, report.results[diagnostic.slot].answerSha256);
  assert.ok(report.results[diagnostic.slot].finalAnswer.endsWith(diagnostic.terminalSuffix));
  assert.equal(diagnostic.primaryVerdictChanged, false);
  return { version: 1, identity: "qa-076-criterion-closure-assessment-v1", sourceCommit: report.sourceCommit,
    reportSha256: audit.reportSha256, firstAssessmentSha256: digest(`${prefix}first-assessment.json`),
    closureReviewSha256: digest(`${prefix}closure-review.json`), consumedInvocations: report.results.length,
    results, arms, candidateWithinTaskSignal: signal,
    interpretation: signal ? "candidate_within_task_only" : "no_prespecified_incremental_signal",
    limitations: ["One evaluator-authored synthetic task, three attempts per arm; no product or population claim.",
      "First semantic judgments hide arms/tables, but the implementation assistant knows its reference task; not independent human evaluation.",
      "Frozen preservation metrics project whole criteria. Failure may reflect a different claim in that criterion, not loss of the named fact; no literal fact-loss rate is inferred.",
      "Invalid final framing remains a non-pass. Missing extracted artifact is semantically unscorable, not zero unsupported additions.",
      "Source returns attest bytes, not comprehension. Requested model/settings are pinned; provider model/compute are not independently attested.",
      "No retry, tuned continuation, production protocol change or automatic next experiment is authorized."] };
}

if (process.argv.includes("--audit-qa076-assessment")) {
  const result = buildClosureAssessment(), content = JSON.stringify(result, null, 2) + "\n";
  if (existsSync(assessmentPath)) assert.equal(readFileSync(assessmentPath, "utf8"), content);
  else writeFileSync(assessmentPath, content, { flag: "wx" });
  process.stdout.write(JSON.stringify({ arms: result.arms, candidateWithinTaskSignal: result.candidateWithinTaskSignal }, null, 2) + "\n");
}
