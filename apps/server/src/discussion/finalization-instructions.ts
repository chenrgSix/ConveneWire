import type { DiscussionOutputMode } from "./discussion-types.js";

// Kept byte-identical to the authoritative checklist in ADR-0044.
export const finalAnswerReviewChecklist = [
  "Check the answer against the task's explicit facts, constraints and requested deliverables. Verify requested calculations and edge cases; fill supported omissions.",
  "Treat participant claims as unverified: repetition or agreement is not evidence. Resolve disagreements only when the supplied evidence supports a resolution.",
  "Correct claims contradicted by the supplied evidence, even when several participants repeat them. Preserve supported correct content; do not invent errors or changes merely to appear critical.",
  "Distinguish established facts from assumptions. Keep unsupported conclusions and unresolved issues explicit instead of guessing.",
  "Return the supported final answer, briefly noting material corrections or remaining uncertainty when relevant. Do not output an internal review transcript."
].join("\n");

export function finalizationTask(outputMode: DiscussionOutputMode): string {
  return `Produce the final ${outputMode.replaceAll("_", " ")} now. ` +
    "Synthesize the best supported conclusion, important unresolved issues, and next actions.\n" +
    finalAnswerReviewChecklist;
}
