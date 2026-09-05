import assert from "node:assert/strict";
import test from "node:test";
import { continuationManifest, loadReviewContinuation } from "./discussion-continuation.js";
import { reviewPacket } from "./discussion-review-packet.js";

test("continuation pins evidence and covers exactly the five incomplete pairs", () => {
  const { manifest, samples } = loadReviewContinuation();
  assert.deepEqual(samples, reviewPacket.cases.slice(1));
  assert.equal(manifest.maximumInvocations, 20);
  assert.deepEqual(manifest.retainedCompleteCaseIds, ["grant-review-cross-domain"]);
  assert.equal(reviewPacket.cases.indexOf(samples[0]!), 1);
});

test("changed evidence, omitted cases and expanded quota fail before Runtime setup", () => {
  for (const change of [
    { packetSha256: "changed" }, { priorEvidenceSha256: "changed" },
    { caseIds: continuationManifest.caseIds.slice(1) },
    { retainedCompleteCaseIds: [...continuationManifest.retainedCompleteCaseIds, "selector-review-simple-v2"] },
    { maximumInvocations: 30 }, { model: "different-model" }, { stopOnFirstRuntimeFailure: false }
  ]) assert.throws(() => loadReviewContinuation({ ...continuationManifest, ...change }));
});
