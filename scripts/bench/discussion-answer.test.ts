import assert from "node:assert/strict";
import test from "node:test";
import { completedFinalAnswer } from "./discussion-answer.js";

test("a failed finalizer never promotes a contribution into the final answer", () => {
  const input = { turns: [{ kind: "finalization" as const, state: "failed" as const,
    runId: "run_final", outputMessageId: null, speakerAgentId: "reviewer" }],
  runs: [{ runId: "run_final", state: "outcome_unknown" as const, targetAgentId: "reviewer" }],
  messages: [{ messageId: "msg_contribution", senderType: "agent", senderId: "reviewer", content: "Useful contribution" }] };
  assert.equal(completedFinalAnswer(input), null);
  assert.equal(completedFinalAnswer({ ...input, turns: [] }), null);
});

test("a final answer requires the exact completed Turn, Run and author-bound Message", () => {
  const input = { turns: [{ kind: "finalization" as const, state: "completed" as const,
    runId: "run_final", outputMessageId: "msg_final", speakerAgentId: "reviewer" }],
  runs: [{ runId: "run_final", state: "completed" as const, targetAgentId: "reviewer" }],
  messages: [{ messageId: "msg_final", senderType: "agent", senderId: "reviewer", content: "Final answer" },
    { messageId: "msg_later", senderType: "agent", senderId: "other", content: "Later unrelated contribution" }] };
  assert.equal(completedFinalAnswer(input), "Final answer");
  assert.equal(completedFinalAnswer({ ...input, runs: [{ ...input.runs[0]!, state: "outcome_unknown" }] }), null);
  assert.equal(completedFinalAnswer({ ...input, messages: [{ ...input.messages[0]!, senderId: "other" }] }), null);
  assert.equal(completedFinalAnswer({ ...input, messages: input.messages.slice(1) }), null);
});
