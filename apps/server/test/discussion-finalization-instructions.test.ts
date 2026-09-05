import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { finalAnswerReviewChecklist, finalizationTask } from "../src/discussion/finalization-instructions.js";
import type { DiscussionOutputMode } from "../src/discussion/discussion-types.js";

test("production review checklist matches the authoritative ADR verbatim", async () => {
  const document = await readFile(new URL(
    "../../../docs/adr/0044-review-final-answers-and-test-discussion-value.md", import.meta.url), "utf8");
  const checklist = document.match(/```text\n([\s\S]*?)\n```/u)?.[1];
  assert.equal(finalAnswerReviewChecklist, checklist);
});

test("every output mode retains its final answer request and bounded review requirements", () => {
  const modes: DiscussionOutputMode[] = ["none", "summary", "final_answer", "artifact", "decision_record", "unresolved_issues"];
  for (const mode of modes) {
    const instruction = finalizationTask(mode);
    assert.ok(instruction.startsWith(`Produce the final ${mode.replaceAll("_", " ")} now.`));
    assert.ok(instruction.includes(finalAnswerReviewChecklist));
    assert.ok([...instruction].length < 2_000);
    assert.doesNotMatch(instruction, /reviewerApproved.*true|approve.*execution|<convenewire-plan-proposal>/u);
  }
});
