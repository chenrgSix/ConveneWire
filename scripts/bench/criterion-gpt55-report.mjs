import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hash } from "./evidence-access-reader.mjs";
import { loadQa077, auditQa077, reportPath } from "./criterion-gpt55-run.mjs";
import { inspectClosureRun } from "./criterion-closure.mjs";
import { validateFirstJudgments } from "./criterion-closure-report.mjs";

const prefix = "docs/acceptance/evidence/qa-077-";
export const assessmentPath = `${prefix}assessment.json`;
const read = file => JSON.parse(readFileSync(file, "utf8"));
const digest = file => hash(readFileSync(file));
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function buildQa077Assessment() {
  const audit = auditQa077(), report = read(reportPath), { replay } = loadQa077();
  const first = read(`${prefix}first-assessment.json`), exported = read(`${prefix}final-only.json`), closure = read(`${prefix}closure-review.json`);
  validateFirstJudgments(first, exported);
  assert.equal(first.reportSha256, audit.reportSha256);
  assert.equal(first.finalOnlyExportSha256, digest(`${prefix}final-only.json`));
  assert.equal(first.scoringSha256, digest("docs/acceptance/fixtures/qa-076/scoring.json"));
  assert.equal(closure.firstAssessmentSha256, digest(`${prefix}first-assessment.json`));
  assert.equal(closure.reportSha256, audit.reportSha256);
  assert.ok(Date.parse(first.recordedAt) <= Date.parse(closure.recordedAt));
  assert.deepEqual(closure.rows.map(row => row.slot), [1, 2, 5]);
  const results = report.results.map(row => {
    const grade = first.reviews.find(item => item.review.finalArtifactSha256 === row.screening.assessment.parsed.finalArtifactSha256);
    assert.ok(grade);
    const checked = inspectClosureRun(replay, row, grade.review), a = checked.assessment;
    const table = closure.rows.find(item => item.slot === row.slot);
    if (table) {
      assert.equal(table.runId, row.runId); assert.equal(table.answerSha256, row.answerSha256);
      assert.equal(table.closureSha256, hash(a.parsed.closure.raw));
      assert.deepEqual(table.criterionChecks.map(item => item.criterionKey), replay.fixture.task.criteria.map(item => item.criterionKey));
      for (const [index, item] of table.criterionChecks.entries()) {
        const actual = a.parsed.closure.value.criterionChecks[index];
        assert.equal(item.assertedStatus, actual.status); assert.deepEqual(item.evidenceRefs, actual.evidenceRefs);
        assert.deepEqual(item.missing, actual.missing); assert.equal(item.sourceRelevance, "relevant");
        assert.ok(item.sourceRelevanceReason && item.reason);
        assert.ok(item.evidenceRefs.every(ref => checked.fullSourcesBeforeAnswer.includes(ref)));
        assert.equal(item.missingAssessment, a.criteria[index].status === "pass" ? "adequate" : "omits_final_defect");
      }
    }
    return {
      slot: row.slot, runId: row.runId, treatment: row.treatment, repetition: row.repetition, blindId: grade.blindId,
      requestedModel: row.requestedModel, observedProviderModel: row.observedProviderModel, reasoningEffort: row.reasoningEffort,
      answerSha256: row.answerSha256, finalArtifactSha256: a.parsed.finalArtifactSha256,
      outcome: row.outcome, delivered: checked.delivered, elapsedMilliseconds: row.elapsedMilliseconds,
      setup: checked.setup, readerCatalogObserved: checked.catalogObserved, sourceAccessGrantValid: checked.sourceAccessGrantValid,
      evidenceUseRuleSupplied: checked.evidenceUseRuleSupplied, actualReaderReturns: checked.actualReaderReturns,
      requiredReading: checked.requiredReading, sourceReadCounts: checked.counts, fullSourcesBeforeAnswer: checked.fullSourcesBeforeAnswer,
      commonManipulationValid: checked.commonManipulationValid, closureProtocol: checked.closureProtocol,
      finalSchemaValid: a.parsed.finalSchemaValid, formatErrors: a.parsed.errors,
      fullRequiredDeliverablePass: checked.fullRequiredDeliverablePass, criticalCriteriaPass: checked.criticalCriteriaPass,
      criteria: a.criteria, correctContentPreservationCriterionProjection: a.correctContentPreservation,
      unresolvedPreservationCriterionProjection: a.unresolvedPreservation,
      unsupportedAdditions: { reviewStatus: grade.unsupportedReviewStatus,
        count: grade.unsupportedReviewStatus === "assessed" ? a.unsupportedAdditions.length : null },
      criterionToFinalStatus: a.criterionToFinalStatus, closureSemanticReview: table ? "retained_in_qa077_closure_review" : "not_applicable",
      finalArtifactBytes: a.parsed.finalArtifactBytes, closureBytes: a.parsed.closureBytes, terminalBytes: a.parsed.terminalBytes
    };
  });
  const arms = Object.fromEntries(["E", "F"].map(arm => {
    const rows = results.filter(row => row.treatment === arm);
    return [arm, { scheduled: rows.length, delivered: rows.filter(row => row.delivered).length,
      fullPass: rows.filter(row => row.fullRequiredDeliverablePass).length, criticalPass: rows.filter(row => row.criticalCriteriaPass).length,
      allSourceReturns: rows.filter(row => row.requiredReading === "complete").length,
      finalSchemaPass: rows.filter(row => row.finalSchemaValid).length,
      commonManipulationPass: rows.filter(row => row.commonManipulationValid).length,
      unsupportedClaimsAssessed: rows.reduce((n, row) => n + (row.unsupportedAdditions.count ?? 0), 0),
      unsupportedUnscorableRuns: rows.filter(row => row.unsupportedAdditions.count === null).length,
      overclaimedCriteria: rows.flatMap(row => row.criterionToFinalStatus).filter(row => row.comparison === "overclaimed").length,
      meanElapsedMilliseconds: mean(rows.map(row => row.elapsedMilliseconds)), medianElapsedMilliseconds: median(rows.map(row => row.elapsedMilliseconds)),
      meanClosureBytes: mean(rows.map(row => row.closureBytes)), meanTerminalBytes: mean(rows.map(row => row.terminalBytes)) }];
  }));
  const candidate = arms.F.fullPass === 3 && arms.E.fullPass <= 1 && results.every(row => row.commonManipulationValid) &&
    results.filter(row => row.treatment === "F").every(row => row.closureProtocol === "structurally_valid" &&
      row.correctContentPreservationCriterionProjection.every(item => item.status === "pass") &&
      row.unresolvedPreservationCriterionProjection === "pass" && row.unsupportedAdditions.count === 0);
  return { version: 1, identity: "qa-077-gpt55-assessment-v1", sourceCommit: report.sourceCommit,
    reportSha256: audit.reportSha256, firstAssessmentSha256: digest(`${prefix}first-assessment.json`),
    closureReviewSha256: digest(`${prefix}closure-review.json`), consumedInvocations: report.results.length,
    results, arms, candidateWithinTaskSignal: candidate,
    interpretation: candidate ? "candidate_within_task_only" : "no_prespecified_incremental_signal",
    limitations: ["Same known evaluator-authored task, three runs per arm. Prior GPT-5.4-mini comparison is historical/descriptive, not randomized causal model evidence.",
      "Implementation-assistant semantic grading hides arm/table until first judgments persist; it is not independent human evaluation.",
      "Two full-delivery failures concern duplicate-test rejection versus unresolved wording. They are not unsafe deletion, wrong byte totals or lost uncertainty.",
      "Accounting conservation over the fully specified inventory is accepted without requiring a new literal numeric test vector; this interpretation is explicit in first judgments.",
      "Preservation metrics retain the frozen whole-criterion projection; no literal fact-loss rate is inferred.",
      "Returns prove bytes, not comprehension; requested model and effort are pinned but provider model/compute are not independently attested.",
      "No productization, follow-on calls, retry or same-case prompt tuning follows from this consumed plan."] };
}

if (process.argv.includes("--audit-qa077-assessment")) {
  const result = buildQa077Assessment(), content = JSON.stringify(result, null, 2) + "\n";
  if (existsSync(assessmentPath)) assert.equal(readFileSync(assessmentPath, "utf8"), content);
  else writeFileSync(assessmentPath, content, { flag: "wx" });
  process.stdout.write(JSON.stringify({ arms: result.arms, candidateWithinTaskSignal: result.candidateWithinTaskSignal }, null, 2) + "\n");
}
