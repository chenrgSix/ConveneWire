import { readFileSync } from "node:fs";
import { finalAnswerReviewChecklist, finalizationTask } from "../../apps/server/src/discussion/finalization-instructions.js";
import { selectDiscussionParticipants } from "../../apps/server/src/discussion/discussion-participant-selector.js";
import { defaultDiscussionPolicy, emptyProgressSnapshot, type DiscussionRecord } from "../../apps/server/src/discussion/discussion-types.js";

export interface Criterion { id: string; kind: string; text: string }
export interface ReviewCase {
  id: string; category: string; complexity: string; prompt: string; rubric: Criterion[];
}
export interface ReplayCase {
  id: string; purpose: string; task: string; contributions: string[]; rubric: Criterion[];
}
export const reviewPacketPath = "docs/acceptance/fixtures/qa-067-discussion-cases.json";
export const reviewPacket = JSON.parse(readFileSync(new URL(`../../${reviewPacketPath}`, import.meta.url), "utf8")) as {
  version: number; identity: string; commonInstruction: string; legacyFinalizationTask: string;
  replays: ReplayCase[]; cases: ReviewCase[];
  fallbackProbes: Array<{ id: string; eligible: string[]; requiredReviewer: string; limit: number;
    neededExpertise: string[]; reason: string }>;
};

export function reviewedTaskInput(sample: ReviewCase): string {
  return `${reviewPacket.commonInstruction}\n\n${sample.prompt}\n\n${finalAnswerReviewChecklist}`;
}

export function replayInput(sample: ReplayCase, arm: "legacy" | "reviewed"): string {
  const task = arm === "legacy" ? reviewPacket.legacyFinalizationTask : finalizationTask("final_answer");
  return `${reviewPacket.commonInstruction}\n\n## Goal\n${sample.task}\n\n` +
    `## Fixed participant contributions\n${sample.contributions.map((text, index) =>
      `Participant ${index + 1}: ${text}`).join("\n\n")}\n\n## Your Task\n${task}`;
}

export function fallbackCoverageProbe() {
  return reviewPacket.fallbackProbes.map((probe) => {
    const id = (name: string) => `agent_probe_${name}`;
    const candidates = probe.eligible.map((name, ordinal) => ({
      participant: { discussionId: "discussion_probe", ordinal, agentId: id(name),
        role: name === probe.requiredReviewer ? "reviewer" as const : "participant" as const },
      agentRole: "", taskRole: null, reportedQuestionIds: []
    }));
    const discussion = { mode: "review", currentWave: 1,
      policy: { ...defaultDiscussionPolicy, participantSelectionMode: "question_focused",
        focusedParticipantLimit: probe.limit, requireReviewer: true },
      progress: { ...emptyProgressSnapshot(), openQuestions: [{ id: "question_unmatched",
        question: "Unclassified concern", importance: "high" }] }
    } as DiscussionRecord;
    const broad = selectDiscussionParticipants({ discussion, candidates, finalization: false })
      .participants.map(({ agentId }) => probe.eligible.find((name) => id(name) === agentId)!);
    // Experimental ordinal fallback only; this is never injected into production selection.
    const topN = probe.eligible.slice(0, probe.limit);
    if (!topN.includes(probe.requiredReviewer)) topN[topN.length - 1] = probe.requiredReviewer;
    return { ...probe, broad, topN, broadMissingExpertise: probe.neededExpertise.filter((name) => !broad.includes(name)),
      topNMissingExpertise: probe.neededExpertise.filter((name) => !topN.includes(name)),
      actualRuns: 0, modelInvocations: 0, answerQualityMeasured: false };
  });
}
