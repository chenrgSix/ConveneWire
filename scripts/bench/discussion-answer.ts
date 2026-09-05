import type { DiscussionTurn } from "../../apps/server/src/discussion/discussion-types.js";
import type { RunRecord } from "../../apps/server/src/run/run-repository.js";

export function completedFinalAnswer(input: {
  turns: Array<Pick<DiscussionTurn, "kind" | "state" | "runId" | "outputMessageId" | "speakerAgentId">>;
  runs: Array<Pick<RunRecord, "runId" | "state" | "targetAgentId">>;
  messages: Array<{ messageId: string; senderType: string; senderId: string; content: string }>;
}): string | null {
  const turn = input.turns.filter(({ kind }) => kind === "finalization").at(-1);
  if (!turn || turn.state !== "completed" || !turn.runId || !turn.outputMessageId) return null;
  const run = input.runs.find(({ runId }) => runId === turn.runId);
  if (!run || run.state !== "completed" || run.targetAgentId !== turn.speakerAgentId) return null;
  const message = input.messages.find(({ messageId, senderType, senderId }) =>
    messageId === turn.outputMessageId && senderType === "agent" && senderId === turn.speakerAgentId);
  return message?.content || null;
}
