// Experiment-only input adapter. Production rendering and Result projection shape stay unchanged.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DiscussionEvidenceService } from "../../apps/server/src/discussion/discussion-evidence-service.js";
import type { CoreRepository, MessageRecord } from "../../apps/server/src/data/core-repository.js";
import type { DiscussionRepository } from "../../apps/server/src/discussion/discussion-repository.js";
import type { RunRepository } from "../../apps/server/src/run/run-repository.js";
import type { DiscussionRecord, DiscussionTurn, DiscussionWave } from "../../apps/server/src/discussion/discussion-types.js";
import type { TaskCriterion } from "../../apps/server/src/task/task-repository.js";

export const fixturePath = "docs/acceptance/fixtures/qa-072-evidence-access-use.json";
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export interface EvidenceSource {
  evidenceRef: string; revision: string; contentSha256: string;
  source: { commit: string; path: string; startLine: number; endLine: number; sha256: string };
  allowedRange: { start: number; end: number };
}
export interface ReplayFixture {
  version: number; identity: string; caseId: string; authorization: string;
  provenance: Array<{ path: string; sha256: string }>;
  historicalResultIndex: number;
  contributions: Array<{ answerIndex: number; agent: string; sha256: string }>;
  task: { taskId: string; roomId: string; definitionRevision: number; criteriaRevision: number;
    goal: string; criteria: TaskCriterion[] };
  progress: DiscussionRecord["progress"];
  sources: EvidenceSource[]; sourceSelectionRule: string;
  commonInstruction: string; useInstruction: string;
  runtime: { model: string; reasoningEffort: string; maximumFinalizerInvocations: number;
    timeoutMilliseconds: number; answerWordInstruction: number; maximumAnswerBytes: number;
    maximumReadCalls: number; maximumReturnBytes: number; retries: number };
  order: Array<{ slot: number; treatment: "A" | "B" | "C"; repetition: number; runId: string }>;
}
export function loadReplay(inputPath = fixturePath) {
  const fixture = JSON.parse(readFileSync(inputPath, "utf8")) as ReplayFixture;
  const originals = fixture.provenance.map((pin) => {
    const bytes = readFileSync(pin.path);
    assert.equal(sha256(bytes), pin.sha256, "Historical input changed");
    return JSON.parse(bytes.toString());
  });
  const sample = originals[0].cases.find((item: { id: string }) => item.id === fixture.caseId);
  const retained = originals[1].results[fixture.historicalResultIndex];
  assert.equal(retained.caseId, fixture.caseId);
  assert.equal(retained.arm, "discussion");
  const contributions = fixture.contributions.map((pin) => {
    const reply = retained.answers[pin.answerIndex] as { agent: string; content: string };
    assert.equal(reply.agent, pin.agent);
    assert.equal(sha256(reply.content), pin.sha256);
    return reply;
  });
  assert.equal(fixture.sourceSelectionRule, "all-original-case-sources-in-packet-order");
  assert.deepEqual(fixture.sources.map((source) => source.evidenceRef), sample.documents.map((doc: { id: string }) => doc.id));
  const documents = fixture.sources.map((source, index) => {
    const original = sample.documents[index];
    assert.deepEqual(source.source, original.source);
    assert.equal(source.revision, original.source.commit);
    assert.equal(source.contentSha256, sha256(original.content));
    assert.deepEqual(source.allowedRange, { start: 0, end: Buffer.byteLength(original.content) });
    return { ...source, content: original.content as string };
  });
  return { fixture, contributions, documents };
}

export function renderReplay(replay = loadReplay()): string {
  const { fixture, contributions } = replay;
  const scope = fixture.task;
  const discussionId = "discussion_qa072_windows";
  const waveId = "wave_qa072_prior", finalWaveId = "wave_qa072_final";
  const goal = `${fixture.commonInstruction}\n\n${scope.goal}\n\nFixed evidence manifest (UTF-8 byte ranges, end exclusive):\n` +
    fixture.sources.map(({ evidenceRef, revision, contentSha256, source, allowedRange }) =>
      JSON.stringify({ evidenceRef, revision, contentSha256, path: source.path,
        sourceLines: [source.startLine, source.endLine], range: allowedRange })).join("\n");
  const messages = [
    { messageId: "msg_qa072_root", senderType: "member", senderId: "member_qa072_owner", content: goal },
    ...contributions.map((reply, index) => ({ messageId: `msg_qa072_contribution_${index}`,
      senderType: "agent", senderId: `agent_qa072_${reply.agent}`, content: reply.content })),
    { messageId: "msg_qa072_seal", senderType: "system", senderId: discussionId,
      content: "第 1 轮已收敛。\n- Solver: completed\n- Reviewer: completed" }
  ].map((message, index) => ({ ...message, ...scope, sequence: index + 1 })) as unknown as MessageRecord[];
  const participants = contributions.map(({ agent }, ordinal) => ({ discussionId, ordinal,
    agentId: `agent_qa072_${agent}`, role: agent === "Reviewer" ? "reviewer" : "participant" }));
  const priorTurns = contributions.map((_, index) => ({ turnId: `turn_qa072_${index}`, waveId,
    kind: "discussion", state: "completed", runId: `run_qa072_contributor_${index}`,
    outputMessageId: `msg_qa072_contribution_${index}`, assessment: { newEvidenceRefs: [] } }));
  // The recorded contributors emitted prose, not Results. Mirror the existing
  // no-Result projection; do not fabricate claims or persist a second model.
  const acceptance = { forDiscussion: (taskId: string, roomId: string, acceptedRuns: readonly string[], offered: readonly string[]) => {
    assert.equal(taskId, scope.taskId); assert.equal(roomId, scope.roomId);
    assert.equal(acceptedRuns.length, 2); assert.deepEqual(offered, []);
    return { taskId, definitionRevision: scope.definitionRevision, criteriaRevision: scope.criteriaRevision,
      criteria: scope.criteria.map((criterion) => ({ criterion, candidate: null, contributions: [], diagnostics: [] })),
      artifacts: [], omittedResults: 0, runsWithoutCurrentResults: 2 };
  } };
  const core = { getAgent: (agentId: string) => ({ name: agentId.replace("agent_qa072_", "") }),
    getMember: () => ({ displayName: "Benchmark Owner" }),
    getMessage: (messageId: string) => messages.find((message) => message.messageId === messageId) };
  const repository = { listParticipants: () => participants, listTurns: () => priorTurns,
    listWaves: () => [{ waveId, ordinal: 1 }, { waveId: finalWaveId, ordinal: 2 }],
    listWaveSeals: () => [{ waveId, acceptedMembers: priorTurns.map(({ turnId }) => ({ turnId })) }] };
  const renderer = new DiscussionEvidenceService(core as unknown as CoreRepository,
    repository as unknown as DiscussionRepository, {} as RunRepository,
    () => "2026-09-06T00:00:00.000Z", { acceptance });
  const instruction = renderer.buildInstruction({ discussionId, taskId: scope.taskId, roomId: scope.roomId,
    rootMessageId: "msg_qa072_root", mode: "review", outputMode: "final_answer", goal,
    progress: fixture.progress, budget: { leaseEndTurn: 1, turnsUsed: 1 } } as DiscussionRecord,
  { waveId: finalWaveId, ordinal: 2, expectedMembers: 1 } as DiscussionWave,
  { kind: "finalization", waveMemberOrdinal: 0, speakerAgentId: "agent_qa072_Reviewer",
    inputMessageId: "msg_qa072_seal" } as DiscussionTurn);
  for (const reply of contributions) assert.ok(instruction.includes(reply.content), "Contribution truncated or rewritten");
  assert.ok(!instruction.includes("truncated"), "Fixture exceeds instruction budget");
  return instruction;
}

export function treatmentInstruction(treatment: "A" | "B" | "C", replay = loadReplay()) {
  const base = renderReplay(replay);
  return treatment === "C" ? `${base}\n\n## Evidence-use requirement\n${replay.fixture.useInstruction}` : base;
}
