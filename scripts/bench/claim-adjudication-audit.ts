// Experiment artifacts only. No Result persistence, model grader or acceptance action.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { loadReplay, renderReplay, sha256, type ReplayFixture } from "./evidence-access-replay.js";
import { inspectManipulation } from "./evidence-screening-audit.js";

export const fixturePath = "docs/acceptance/fixtures/qa-075-claim-adjudication.json";
export const schemaPath = "docs/acceptance/fixtures/qa-075-disposition.schema.json";
export type Target = { claimId: string; criterionKey: string; claim: string };
type Fixture = Omit<ReplayFixture, "order"> & {
  order: Array<{ slot: number; treatment: "C" | "D"; repetition: number; runId: string }>;
  targetClaims: Target[]; sharedOutputInstruction: string; adjudicationInstruction: string;
};
const schemaValid = new Ajv({ allErrors: true }).compile(JSON.parse(readFileSync(schemaPath, "utf8")));
export function loadQa075() {
  const replay = loadReplay(fixturePath), fixture = replay.fixture as unknown as Fixture;
  const prior = loadReplay();
  const { identity, authorization, order, runtime, targetClaims, sharedOutputInstruction, adjudicationInstruction, ...content } = fixture;
  const { identity: oldId, authorization: oldAuth, order: oldOrder, runtime: oldRuntime, ...oldContent } = prior.fixture;
  assert.deepEqual(content, oldContent, "Original diagnostic inputs must stay unchanged");
  assert.deepEqual(runtime, { ...oldRuntime, maximumFinalizerInvocations: 6 });
  assert.equal(identity, "qa-075-windows-claim-adjudication-v1");
  assert.equal(authorization, "owner-authorized-qa075-six-fresh-finalizer-invocations");
  assert.deepEqual(order, ["C", "D", "D", "C", "C", "D"].map((treatment, slot) =>
    ({ slot, treatment, repetition: Math.floor(slot / 2) + 1, runId: `run_qa075_windows_${slot + 1}` })));
  assert.equal(targetClaims.length, 2); assert.equal(new Set(targetClaims.map(row => row.claimId)).size, 2);
  for (const target of targetClaims) assert.ok(fixture.task.criteria.some(row => row.criterionKey === target.criterionKey));
  assert.ok(sharedOutputInstruction && adjudicationInstruction);
  // The original renderer consumes no treatment schedule. Keep its original type/API.
  return { ...replay, adjudication: fixture };
}
export type Replay = ReturnType<typeof loadQa075>;
export function instruction(arm: "C" | "D", replay = loadQa075()) {
  assert.ok(arm === "C" || arm === "D");
  const fixture = replay.adjudication;
  const common = `${renderReplay(replay)}\n\n## Evidence-use requirement\n${fixture.useInstruction}` +
    `\n\n## Common target propositions and terminal output\n${fixture.sharedOutputInstruction}\n` + JSON.stringify(fixture.targetClaims, null, 2);
  return arm === "C" ? common : `${common}\n\n## Claim disposition requirement\n${fixture.adjudicationInstruction}`;
}

function block(text: string, tag: string) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const start = text.indexOf(open), end = text.indexOf(close);
  const valid = start >= 0 && end >= start + open.length && text.split(open).length === 2 && text.split(close).length === 2;
  return { valid, start, end: end + close.length, content: valid ? text.slice(start + open.length, end).trim() : "" };
}
export function parseArtifacts(text: string, arm: "C" | "D", targets: Target[]) {
  const final = block(text, "final-answer"), table = block(text, "claim-disposition");
  const errors: string[] = [];
  if (!final.valid || !final.content) errors.push("missing_or_malformed_final_block");
  let disposition: any = null;
  if (arm === "C") {
    if (text.includes("<claim-disposition>")) errors.push("unexpected_C_disposition");
  } else {
    if (!table.valid) errors.push("missing_or_malformed_disposition_block");
    if (table.valid && (!final.valid || table.end > final.start)) errors.push("disposition_not_before_final");
    if (table.valid) {
      try { disposition = JSON.parse(table.content); } catch { errors.push("invalid_disposition_json"); }
      if (!schemaValid(disposition)) errors.push("disposition_schema_failed");
      else {
        assert.ok(disposition);
        const ids = disposition.criterionChecks.map((row: any) => row.claimId);
        if (new Set(ids).size !== targets.length || targets.some(target => !ids.includes(target.claimId))) errors.push("target_coverage_failed");
        for (const check of disposition.criterionChecks) {
          const target = targets.find(target => target.claimId === check.claimId);
          if (!target || check.criterionKey !== target.criterionKey || check.claim !== target.claim) errors.push("target_identity_failed");
        }
        const expected = disposition.criterionChecks.filter((row: any) => row.disposition === "unresolved").map((row: any) => row.claimId).sort();
        if (JSON.stringify([...disposition.unresolved].sort()) !== JSON.stringify(expected)) errors.push("unresolved_list_mismatch");
      }
    }
  }
  return { finalBlockValid: final.valid && Boolean(final.content), finalDiagnosis: final.content,
    diagnosisSha256: sha256(final.content), diagnosisWords: final.content ? final.content.split(/\s+/u).length : 0,
    diagnosisBytes: Buffer.byteLength(final.content), terminalBytes: Buffer.byteLength(text),
    dispositionBytes: table.valid ? Buffer.byteLength(table.content) : 0, disposition, errors };
}
export function inspectQa075(replay: Replay, row: any) {
  const reading = inspectManipulation(replay, row, instruction(row.treatment, replay));
  // D has the same frozen use rule. The historical auditor's default A/B/C behavior stays intact.
  const artifacts = parseArtifacts(row.finalAnswer ?? "", row.treatment, replay.adjudication.targetClaims);
  const bindingErrors: string[] = [];
  if (row.treatment === "D" && artifacts.errors.length === 0) {
    for (const check of artifacts.disposition.criterionChecks) for (const ref of check.evidenceRefs) {
      if (!reading.fullSourcesBeforeAnswer.includes(ref)) bindingErrors.push(`${check.claimId}:${ref}:no_full_current_run_return`);
    }
  }
  const commonValid = reading.setup === "passed" && reading.delivered && reading.requiredReading === "complete" && artifacts.finalBlockValid;
  const formatValid = artifacts.errors.length === 0 && bindingErrors.length === 0;
  return { ...reading, evidenceUseRuleSupplied: reading.instructionValid, commonValid,
    artifacts, bindingErrors, outputWordInstructionMet: artifacts.finalBlockValid && artifacts.diagnosisWords < replay.fixture.runtime.answerWordInstruction,
    dispositionProtocol: row.treatment === "C" ? "not_required" : commonValid && formatValid ? "structurally_valid" : "failed",
    // Human semantic review is required; never substitute schema validity for this fourth check.
    semanticConsistency: "requires_frozen_rubric_review" };
}
export function screenQa075(replay: Replay, report: any) {
  const results = report.results.map((row: any) => inspectQa075(replay, row));
  const repetitions = [1, 2, 3].map(repetition => {
    const pair = results.filter((row: any) => row.repetition === repetition);
    return { repetition, commonComparisonValid: pair.length === 2 && pair.every((row: any) => row.commonValid),
      dispositionProtocol: pair.find((row: any) => row.treatment === "D")?.dispositionProtocol ?? "missing" };
  });
  return { version: 1, identity: replay.fixture.identity, results, repetitions,
    allCommonChecksPassed: repetitions.every(row => row.commonComparisonValid),
    retention: "All attempts retained; semantic contradictions and D protocol failures never exclude an outcome." };
}
export function blindQa075(screen: ReturnType<typeof screenQa075>) {
  return [...screen.results].sort((a, b) => a.artifacts.diagnosisSha256.localeCompare(b.artifacts.diagnosisSha256) || a.slot - b.slot)
    .map((row, index) => ({ blindId: `answer-${index + 1}`, diagnosisSha256: row.artifacts.diagnosisSha256,
      scorable: row.delivered && row.artifacts.finalBlockValid, finalDiagnosis: row.artifacts.finalDiagnosis }));
}
