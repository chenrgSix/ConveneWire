import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { evidenceToolDefinition, hash } from "./evidence-access-reader.mjs";
import { makeAccess } from "./evidence-access-runtime.mjs";
import { loadReplay, treatmentInstruction } from "./evidence-access-replay.js";

const ajv = new Ajv({ allErrors: true }); addFormats(ajv);
const receiptValid = ajv.compile(JSON.parse(readFileSync("docs/acceptance/fixtures/qa-072-read-receipt.schema.json", "utf8")));
type Replay = ReturnType<typeof loadReplay>;

function covers(ranges: Array<{ start: number; end: number }>, allowed: { start: number; end: number }) {
  let end = allowed.start;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start > end) break;
    end = Math.max(end, range.end);
  }
  return end >= allowed.end;
}

export function inspectManipulation(replay: Replay, row: any, expectedInstruction = treatmentInstruction(row.treatment, replay)) {
  const expected = makeAccess(replay, row, row.observedAt);
  const catalog = (row.readerLifecycle ?? []).filter((event: any) => event.stage === "tools_listed");
  const catalogObserved = catalog.length > 0;
  const catalogValid = catalogObserved && catalog.every((event: any) => event.runId === row.runId &&
    event.definitionSha256 === hash(JSON.stringify(evidenceToolDefinition(expected.bundle))) &&
    Date.parse(event.observedAt) >= Date.parse(row.observedAt) && Date.parse(event.observedAt) <= Date.parse(row.endedAt));
  const grantValid = row.treatment !== "A" && JSON.stringify(row.grant) === JSON.stringify(expected.control.grant);
  const instructionValid = row.instructionSha256 === hash(expectedInstruction);
  const configurationValid = row.requestedModel === replay.fixture.runtime.model && row.reasoningEffort === replay.fixture.runtime.reasoningEffort;
  const counts = { returned: 0, denied: 0, failed: 0, invalid: 0, truncated: 0, beforeAnswer: 0 };
  const coverage = new Map<string, Array<{ start: number; end: number }>>();
  const sourceReads: any[] = [];
  for (const returned of row.reads ?? []) {
    const receipt = returned.receipt;
    const doc = replay.documents.find(doc => doc.evidenceRef === receipt?.evidenceRef);
    try {
      assert.ok(receiptValid(receipt));
      for (const key of ["experimentId", "authorityId", "taskId", "roomId", "runId"]) assert.equal(receipt[key], expected.bundle[key]);
      assert.ok(Date.parse(receipt.observedAt) >= Date.parse(row.observedAt) && Date.parse(receipt.observedAt) <= Date.parse(row.endedAt));
      if (receipt.status === "returned") {
        assert.ok(grantValid && doc);
        assert.ok(Date.parse(receipt.observedAt) < Date.parse(row.grant.expiresAt));
        assert.equal(receipt.revision, doc.revision); assert.equal(receipt.sourceContentSha256, doc.contentSha256);
        const requested = receipt.requestedRange, range = receipt.returnedRange;
        assert.ok(requested.start >= doc.allowedRange.start && requested.end <= doc.allowedRange.end && requested.end > requested.start);
        assert.equal(range.start, requested.start); assert.ok(range.end <= requested.end && range.end > range.start);
        assert.equal(receipt.truncated, range.end !== requested.end);
        assert.equal(returned.content, Buffer.from(doc.content).subarray(range.start, range.end).toString("utf8"));
        assert.equal(receipt.contentSha256, hash(returned.content));
        assert.equal(receipt.returnedBytes, Buffer.byteLength(returned.content));
        assert.equal(receipt.returnedBytes, range.end - range.start);
        assert.ok(receipt.returnedBytes <= replay.fixture.runtime.maximumReturnBytes);
        counts.returned++; if (receipt.truncated) counts.truncated++;
        if (row.finalAnswerAt && Date.parse(receipt.observedAt) <= Date.parse(row.finalAnswerAt)) {
          counts.beforeAnswer++;
          coverage.set(doc.evidenceRef, [...coverage.get(doc.evidenceRef) ?? [], range]);
        }
      } else {
        assert.equal(returned.content, null);
        if (receipt.status === "denied") counts.denied++; else counts.failed++;
      }
      sourceReads.push({ evidenceRef: receipt.evidenceRef, status: receipt.status, failureReason: receipt.failureReason,
        requestedRange: receipt.requestedRange, returnedRange: receipt.returnedRange, returnedBytes: receipt.returnedBytes,
        truncated: receipt.truncated, observedAt: receipt.observedAt });
    } catch { counts.invalid++; sourceReads.push({ status: "invalid_receipt" }); }
  }
  const fullSourcesBeforeAnswer = replay.documents.filter(doc => covers(coverage.get(doc.evidenceRef) ?? [], doc.allowedRange)).map(doc => doc.evidenceRef);
  const setupValid = instructionValid && configurationValid && counts.invalid === 0 && (row.treatment === "A" ?
    row.evidenceAccess?.configured === false && !catalogObserved && row.grant === null && (row.reads ?? []).length === 0 :
    row.evidenceAccess?.configured === true && catalogValid && grantValid);
  const delivered = row.outcome === "completed" && row.turnCompleted === true && (row.failures ?? []).length === 0 &&
    typeof row.finalAnswer === "string" && row.finalAnswer.trim().length > 0 && Boolean(row.finalAnswerAt);
  return { slot: row.slot, treatment: row.treatment, repetition: row.repetition, runId: row.runId,
    setup: setupValid ? "passed" : "failed", catalogObserved, catalogValid, sourceAccessGrantValid: grantValid,
    instructionValid, configurationValid, evidenceUseRuleSupplied: row.treatment === "C" && instructionValid,
    actualReaderReturns: counts.returned, counts, fullSourcesBeforeAnswer,
    requiredReading: row.treatment === "A" ? "not_applicable" : row.treatment === "B" ? "optional" :
      fullSourcesBeforeAnswer.length === replay.documents.length ? "complete" : "incomplete",
    sourceReads, delivered, outcome: row.outcome, elapsedMilliseconds: row.elapsedMilliseconds };
}

export function screenReport(replay: Replay, report: any) {
  const rows = report.results.map((row: any) => inspectManipulation(replay, row));
  const actualReaderReturns = rows.reduce((sum: number, row: any) => sum + row.actualReaderReturns, 0);
  const comparisons: Record<string, any> = {};
  for (const [question, left, right] of [["Q1", "A", "B"], ["Q2", "B", "C"]]) {
    const repetitions = [1, 2, 3].map(repetition => {
      const a = rows.find((row: any) => row.treatment === left && row.repetition === repetition);
      const b = rows.find((row: any) => row.treatment === right && row.repetition === repetition);
      const reasons = [];
      if (!a || !b) reasons.push("missing_attempt");
      if (a?.setup !== "passed" || b?.setup !== "passed") reasons.push("setup_failed");
      if (!a?.delivered || !b?.delivered) reasons.push("run_not_delivered");
      if (question === "Q1" && !(b?.counts.beforeAnswer > 0)) reasons.push("B_no_return_before_answer");
      if (question === "Q2" && b?.requiredReading !== "complete") reasons.push("C_required_reading_incomplete");
      return { repetition, eligible: reasons.length === 0, reasons };
    });
    comparisons[question] = { eligibleForStableInterpretation: repetitions.every(row => row.eligible), repetitions };
  }
  return { version: 1, identity: replay.fixture.identity, actualReaderReturns,
    exposureGate: actualReaderReturns > 0 ? "observed" : "manipulation_failed",
    qualityAssessment: actualReaderReturns > 0 ? "separate_item_review_permitted" : "unscorable_manipulation_failed",
    comparisons, results: rows };
}

export function blindAnswers(report: any, screening: ReturnType<typeof screenReport>) {
  return [...report.results].sort((a, b) => a.answerSha256.localeCompare(b.answerSha256) || a.slot - b.slot)
    .map((row, index) => ({ blindId: `answer-${index + 1}`, answerSha256: row.answerSha256,
      scorable: screening.actualReaderReturns > 0 && row.outcome === "completed" && Boolean(row.finalAnswer),
      finalAnswer: row.finalAnswer }));
}
