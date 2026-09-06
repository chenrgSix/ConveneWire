import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceEvidenceInstruction } from "../src/discussion/acceptance-evidence-instructions.js";
import type { DiscussionAcceptanceEvidence } from "../src/task/acceptance-evidence-service.js";

function evidence(count: number): DiscussionAcceptanceEvidence {
  return {
    taskId: "task_evidence0001", definitionRevision: 2, criteriaRevision: 2,
    omittedResults: 3, runsWithoutCurrentResults: 1, artifacts: [],
    criteria: Array.from({ length: count }, (_, index) => ({
      criterion: { criterionKey: `criterion_${String(index).padStart(8, "0")}`,
        description: "Check the exact output 🧪. ".repeat(15), required: true, ordinal: index + 1 },
      candidate: null, diagnostics: [], contributions: [{
        resultId: `result_${String(index).padStart(8, "0")}`, resultVersion: index + 1,
        state: "proposed", proposedBy: { kind: "member", memberId: "member_owner0001" },
        claim: { criterionKey: `criterion_${String(index).padStart(8, "0")}`, coverage: "unresolved",
          explanation: "Assumed token=abcdefghijklmnop requires verification.", evidenceRefIds: [] }, sources: []
      }]
    }))
  };
}

test("bounded criterion index prioritizes requirement coverage and discloses every omitted entry", () => {
  const value = evidence(100);
  const text = acceptanceEvidenceInstruction(value, 1500);
  assert.ok([...text].length <= 1500);
  assert.equal(text.isWellFormed(), true);
  const shown = text.match(/^criterion_\d+/gmu)?.length ?? 0;
  assert.ok(shown > 0 && shown < 100);
  assert.match(text, new RegExp(`Index omissions: ${100 - shown} criteria; 100 contribution entries`, "u"));
  assert.match(text, /history limit: 3/u);
  assert.match(text, /not proven absent/u);
});

test("criterion index redacts secrets and distinguishes unsupported contributions from verification", () => {
  const text = acceptanceEvidenceInstruction(evidence(1), 6000);
  assert.match(text, /\[REDACTED\]/u);
  assert.doesNotMatch(text, /abcdefghijklmnop/u);
  assert.match(text, /\[proposed; unresolved\]/u);
  assert.match(text, /checks=none recorded/u);
  assert.match(text, /Index omissions: 0 criteria; 0 contribution entries/u);
  assert.match(text, /Source IDs do not grant source access/u);
  assert.equal(acceptanceEvidenceInstruction(evidence(0), 6000), "");
  assert.match(acceptanceEvidenceInstruction(evidence(1), 100), /omitted by instruction limit/u);
});
