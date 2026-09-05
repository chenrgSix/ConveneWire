import assert from "node:assert/strict";
import test from "node:test";
import { finalAnswerReviewChecklist, finalizationTask } from "../../apps/server/src/discussion/finalization-instructions.js";
import { fallbackCoverageProbe, replayInput, reviewedTaskInput, reviewPacket } from "./discussion-review-packet.js";

test("document-owned packet balances categories and keeps scoring out of prompts", () => {
  assert.equal(reviewPacket.cases.length, 6);
  assert.equal(reviewPacket.replays.length, 3);
  assert.equal(new Set([...reviewPacket.cases, ...reviewPacket.replays].map(({ id }) => id)).size, 9);
  for (const category of ["code_review", "problem_diagnosis", "solution_comparison"]) {
    assert.deepEqual(reviewPacket.cases.filter((sample) => sample.category === category)
      .map(({ complexity }) => complexity).sort(), ["multi_perspective", "simple_control"]);
  }
  for (const sample of reviewPacket.cases) {
    const input = reviewedTaskInput(sample);
    assert.ok(input.includes(sample.prompt));
    assert.ok(input.includes(finalAnswerReviewChecklist));
    assert.ok([...input].length < 8_000);
    assert.equal(sample.rubric.length, 4);
    for (const criterion of sample.rubric) assert.ok(!input.includes(criterion.text));
  }
});

test("replay pairs change only the documented finalization task", () => {
  assert.equal(finalizationTask("final_answer"), reviewPacket.legacyFinalizationTask + "\n" + finalAnswerReviewChecklist);
  for (const sample of reviewPacket.replays) {
    const old = replayInput(sample, "legacy");
    const revised = replayInput(sample, "reviewed");
    assert.equal(revised, old + "\n" + finalAnswerReviewChecklist);
    for (const contribution of sample.contributions) assert.ok(old.includes(contribution));
    for (const criterion of sample.rubric) assert.ok(!old.includes(criterion.text));
  }
});

test("offline fallback probe retains review but exposes ordinal expertise loss", () => {
  const [late, early] = fallbackCoverageProbe();
  assert.deepEqual(late!.broad, ["Implementation", "Docs", "Security", "Reviewer"]);
  assert.deepEqual(late!.topN, ["Implementation", "Reviewer"]);
  assert.deepEqual(late!.topNMissingExpertise, ["Security"]);
  assert.deepEqual(early!.topN, ["Security", "Reviewer"]);
  assert.deepEqual(early!.topNMissingExpertise, []);
  for (const probe of [late!, early!]) {
    assert.deepEqual(probe.broadMissingExpertise, []);
    assert.equal(probe.answerQualityMeasured, false);
    assert.equal(probe.actualRuns, 0);
  }
});
