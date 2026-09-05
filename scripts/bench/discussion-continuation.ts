import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { reviewPacket, reviewPacketPath } from "./discussion-review-packet.js";

export const continuationPath = "docs/acceptance/fixtures/qa-068-discussion-continuation.json";
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url));
export const continuationManifest = JSON.parse(read(continuationPath).toString()) as {
  version: number; identity: string; packetIdentity: string; packetSha256: string;
  priorEvidencePath: string; priorEvidenceSha256: string;
  retainedCompleteCaseIds: string[]; caseIds: string[]; model: string; reasoningEffort: string;
  maximumInvocations: number; maximumModelWorkSeconds: number; maximumProcessSeconds: number;
  stopOnFirstRuntimeFailure: boolean;
};

export function loadReviewContinuation(manifest = continuationManifest) {
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest(read(reviewPacketPath)), manifest.packetSha256, "Task packet changed");
  assert.equal(reviewPacket.identity, manifest.packetIdentity);
  const priorBytes = read(manifest.priorEvidencePath);
  assert.equal(digest(priorBytes), manifest.priorEvidenceSha256, "Prior evidence changed");
  const prior = JSON.parse(priorBytes.toString()) as {
    synthetic: boolean; packetIdentity: string; model: string; reasoningEffort: string;
    results: Array<{ caseId: string; arm: string; runtimeSucceeded: boolean; finalAnswer: string | null }>;
  };
  assert.equal(prior.synthetic, false);
  assert.equal(prior.packetIdentity, manifest.packetIdentity);
  assert.equal(prior.model, manifest.model);
  assert.equal(prior.reasoningEffort, manifest.reasoningEffort);
  const complete = reviewPacket.cases.filter((sample) => ["single_agent", "discussion"].every((arm) =>
    prior.results.some((result) => result.caseId === sample.id && result.arm === arm &&
      result.runtimeSucceeded && !!result.finalAnswer))).map(({ id }) => id);
  assert.deepEqual(manifest.retainedCompleteCaseIds, complete);
  const samples = reviewPacket.cases.filter(({ id }) => !complete.includes(id));
  assert.deepEqual(manifest.caseIds, samples.map(({ id }) => id), "Continuation must cover exactly the incomplete pairs");
  assert.equal(manifest.maximumInvocations, samples.length * 4);
  assert.equal(manifest.maximumInvocations, 20);
  assert.equal(manifest.maximumModelWorkSeconds, 1200);
  assert.equal(manifest.maximumProcessSeconds, 300);
  assert.equal(manifest.stopOnFirstRuntimeFailure, true);
  return { manifest, samples };
}
