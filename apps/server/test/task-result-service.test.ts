import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { createTestResources } from "../../../scripts/test/resources.mjs";

import Database from "better-sqlite3";
import Ajv2020 from "ajv/dist/2020.js";

import type { ResultAcceptanceEvidence, ResultProposal } from "@convene-wire/contracts/task-result";

import { createServerApp } from "../src/app.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { RunRepository } from "../src/run/run-repository.js";
import { AgentTaskService } from "../src/task/agent-task-service.js";
import { ResultRepository } from "../src/task/result-repository.js";
import { ResultService } from "../src/task/result-service.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";

const now = "2026-08-28T14:00:00.000Z";

async function setup(t: TestContext) {
  const resources = await createTestResources(t, "convene-wire-result-");
  const directory = resources.directory;
  const databasePath = path.join(directory, "server.sqlite");
  const app = await createServerApp({ databasePath, clock: () => now, logger: false });
  const bootstrap = await app.inject({
    method: "POST",
    url: "/api/bootstrap",
    payload: { userId: "user_result_owner_0001", displayName: "Result Owner" }
  });
  const authorization = `Bearer ${bootstrap.json().session.token as string}`;
  const team = await app.inject({
    method: "POST",
    url: "/api/teams",
    headers: { authorization },
    payload: { name: "Result Team" }
  });
  const teamId = team.json().team.teamId as string;
  const ownerMemberId = team.json().owner.memberId as string;
  const room = await app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/rooms`,
    headers: { authorization },
    payload: { name: "results" }
  });
  const roomId = room.json().roomId as string;
  const agent = await app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/manual-agents`,
    headers: { authorization },
    payload: { name: "Reviewer", role: "Primary" }
  });
  const secondAgent = await app.inject({
    method: "POST",
    url: `/api/teams/${teamId}/manual-agents`,
    headers: { authorization },
    payload: { name: "Verifier", role: "Contributor" }
  });
  return {
    app,
    authorization,
    databasePath,
    teamId,
    ownerMemberId,
    roomId,
    agentId: agent.json().agent.agentId as string,
    secondAgentId: secondAgent.json().agent.agentId as string
  };
}

async function createActiveTask(input: Awaited<ReturnType<typeof setup>>) {
  const created = await input.app.inject({
    method: "POST",
    url: `/api/rooms/${input.roomId}/tasks`,
    headers: { authorization: input.authorization },
    payload: {
      title: "Deliver a reviewed change",
      goal: "Produce evidence and receive an explicit review.",
      lifecycleState: "ready",
      completionPolicy: "accepted_result_required",
      criteria: [{
        criterionKey: "criterion_verified0001",
        description: "The delivery has durable Artifact evidence.",
        required: true,
        ordinal: 1
      }],
      assignments: [
        { agentId: input.agentId, role: "primary" },
        { agentId: input.secondAgentId, role: "contributor" }
      ]
    }
  });
  assert.equal(created.statusCode, 200);
  const task = created.json();
  const activated = await input.app.inject({
    method: "POST",
    url: `/api/tasks/${task.taskId as string}/control`,
    headers: { authorization: input.authorization },
    payload: {
      operationId: "op_activate_result_task_0001",
      expectedTaskRevision: 1,
      lifecycleState: "active"
    }
  });
  assert.equal(activated.statusCode, 200);
  return activated.json();
}

async function createCompletedRun(
  input: Awaited<ReturnType<typeof setup>>,
  taskId: string
) {
  const routed = await input.app.inject({
    method: "POST",
    url: `/api/rooms/${input.roomId}/messages`,
    headers: { authorization: input.authorization },
    payload: {
      taskId,
      content: "Produce the verified Result.",
      mentionAgentId: input.agentId
    }
  });
  assert.equal(routed.statusCode, 200);
  const runId = routed.json().runs[0].runId as string;
  const database = new Database(input.databasePath);
  try {
    const runs = new RunRepository(database);
    runs.applyEvent(runId, { type: "status", sequence: 1, status: "working" }, now);
    runs.applyReply(runId, {
      type: "reply",
      sequence: 2,
      content: "Verified delivery."
    }, now);
    runs.applyEvent(runId, { type: "status", sequence: 3, status: "completed" }, now);
  } finally {
    database.close();
  }
  return {
    runId,
    messageId: routed.json().message.messageId as string
  };
}

async function createArtifact(
  input: Awaited<ReturnType<typeof setup>>,
  taskId: string,
  title = "Verified tests"
) {
  const response = await input.app.inject({
    method: "POST",
    url: `/api/tasks/${taskId}/artifacts`,
    headers: { authorization: input.authorization },
    payload: {
      type: "test_result",
      workspaceRef: "workspace_result",
      title,
      summary: "Focused tests passed with durable evidence."
    }
  });
  assert.equal(response.statusCode, 200, JSON.stringify(response.json()));
  return response.json().artifact.artifactId as string;
}

function proposal(input: {
  operationId: string;
  taskId: string;
  taskRevision: number;
  definitionRevision: number;
  criteriaRevision: number;
  artifactId: string;
  runId: string;
  supersedesResultId?: string | null;
  nextActionKey?: string;
}): ResultProposal {
  return {
    operationId: input.operationId,
    taskId: input.taskId,
    definitionRevision: input.definitionRevision,
    criteriaRevision: input.criteriaRevision,
    proposedAtTaskRevision: input.taskRevision,
    supersedesResultId: input.supersedesResultId ?? null,
    outcome: "satisfied",
    summary: "The bounded work is complete and verified.",
    risks: [],
    openQuestions: [],
    nextActions: input.nextActionKey
      ? [{
          nextActionKey: input.nextActionKey,
          description: "Verify the follow-up compatibility boundary."
        }]
      : [],
    sources: [{
      evidenceRefId: "evidence_artifact0001",
      kind: "artifact",
      artifactId: input.artifactId
    }, {
      evidenceRefId: "evidence_runevent0001",
      kind: "run_event",
      runId: input.runId,
      sequence: 3
    }],
    criterionClaims: [{
      criterionKey: "criterion_verified0001",
      coverage: "satisfied",
      explanation: "The persisted test Artifact verifies the criterion.",
      evidenceRefIds: ["evidence_artifact0001"]
    }]
  };
}

test("Result acceptance atomically completes its Task and survives response loss", async (t) => {
  const context = await setup(t);
  let app = context.app;
  try {
    const task = await createActiveTask(context);
    const run = await createCompletedRun(context, task.taskId as string);
    const artifactId = await createArtifact(context, task.taskId as string);
    const resultProposal = proposal({
      operationId: "op_propose_result_0001",
      taskId: task.taskId,
      taskRevision: 2,
      definitionRevision: 1,
      criteriaRevision: 1,
      artifactId,
      runId: run.runId
    });
    const proposed = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: resultProposal
    });
    assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.json()));
    assert.equal(proposed.json().resultVersion, 1);
    assert.equal(proposed.json().state, "proposed");
    const repeated = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: resultProposal
    });
    assert.deepEqual(repeated.json(), proposed.json());
    const proposalMessages = await app.inject({
      method: "GET",
      url: `/api/rooms/${context.roomId}/messages?limit=100&tail=true`,
      headers: { authorization: context.authorization }
    });
    const proposalSummaries = proposalMessages.json().items.filter(
      ({ senderType }: { senderType: string }) => senderType === "system"
    );
    assert.equal(proposalSummaries.length, 1);
    assert.match(proposalSummaries[0].content, /Result v1 proposed for \[TASK-2\]/u);
    assert.doesNotMatch(proposalSummaries[0].content, /bounded work is complete/u);

    const taskAfterProposal = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(taskAfterProposal.json().taskRevision, 3);
    assert.equal(taskAfterProposal.json().attentionReasons[0].reason, "needs_approval");

    const foreignTask = await app.inject({
      method: "POST",
      url: `/api/rooms/${context.roomId}/tasks`,
      headers: { authorization: context.authorization },
      payload: { title: "Foreign", goal: "Keep evidence isolated." }
    });
    const foreignArtifactId = await createArtifact(
      context,
      foreignTask.json().taskId as string,
      "Foreign evidence"
    );
    const foreignProposal = {
      ...resultProposal,
      operationId: "op_foreign_result_0001",
      proposedAtTaskRevision: 3,
      sources: [{
        evidenceRefId: "evidence_foreign0001",
        kind: "artifact",
        artifactId: foreignArtifactId
      }],
      criterionClaims: [{
        ...resultProposal.criterionClaims[0],
        evidenceRefIds: ["evidence_foreign0001"]
      }]
    };
    const foreign = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: foreignProposal
    });
    assert.equal(foreign.statusCode, 400);
    assert.match(foreign.json().error.message, /same Task scope/u);

    const reviewCommand = {
      operationId: "op_review_result_0001",
      decision: "accepted",
      expectedTaskRevision: 3,
      expectedReviewRevision: 0,
      reason: "Required evidence is durable and sufficient.",
      completeTask: true
    };
    const accepted = await app.inject({
      method: "POST",
      url: `/api/results/${proposed.json().resultId as string}/review-decisions`,
      headers: { authorization: context.authorization },
      payload: reviewCommand
    });
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.json()));
    assert.equal(accepted.json().result.state, "accepted");
    assert.equal(accepted.json().taskRevisionBefore, 3);
    assert.equal(accepted.json().taskRevisionAfter, 4);
    assert.equal(accepted.json().completedTask, true);
    const acceptedReplay = await app.inject({
      method: "POST",
      url: `/api/results/${proposed.json().resultId as string}/review-decisions`,
      headers: { authorization: context.authorization },
      payload: reviewCommand
    });
    assert.deepEqual(acceptedReplay.json(), accepted.json());
    const reviewedMessages = await app.inject({
      method: "GET",
      url: `/api/rooms/${context.roomId}/messages?limit=100&tail=true`,
      headers: { authorization: context.authorization }
    });
    const reviewedSummaries = reviewedMessages.json().items.filter(
      ({ senderType }: { senderType: string }) => senderType === "system"
    );
    assert.equal(reviewedSummaries.length, 2);
    assert.match(
      reviewedSummaries[1].content,
      /Result v1 accepted for \[TASK-2\].*Task completed/u
    );
    assert.doesNotMatch(reviewedSummaries[1].content, /durable and sufficient/u);

    const completedTask = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(completedTask.json().lifecycleState, "completed");
    assert.equal(completedTask.json().completionResultId, proposed.json().resultId);
    assert.equal(completedTask.json().taskRevision, 4);

    const writer = new Database(context.databasePath);
    try {
      assert.throws(() => writer.prepare(`
        UPDATE task_results SET summary = 'mutated' WHERE result_id = ?
      `).run(proposed.json().resultId), /immutable/u);
      assert.throws(() => writer.prepare(`
        DELETE FROM result_reviews WHERE result_id = ?
      `).run(proposed.json().resultId), /immutable/u);
    } finally {
      writer.close();
    }

    await app.close();
    app = await createServerApp({
      databasePath: context.databasePath,
      clock: () => now,
      logger: false
    });
    const recovered = await app.inject({
      method: "GET",
      url: `/api/results/${proposed.json().resultId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().state, "accepted");
    assert.equal(recovered.json().review.reviewRevision, 1);
  } finally {
    await app.close();
  }
});

test("concurrent Result review and Task definition edit keep one revision-consistent winner", async (t) => {
  const context = await setup(t);
  let app = context.app;
  try {
    const task = await createActiveTask(context);
    const run = await createCompletedRun(context, task.taskId as string);
    const artifactId = await createArtifact(context, task.taskId as string);
    const proposed = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: proposal({
        operationId: "op_race_result_proposal_0001",
        taskId: task.taskId,
        taskRevision: 2,
        definitionRevision: 1,
        criteriaRevision: 1,
        artifactId,
        runId: run.runId
      })
    });
    assert.equal(proposed.statusCode, 200, proposed.body);
    const currentResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(currentResponse.statusCode, 200);
    const current = currentResponse.json();
    assert.equal(current.taskRevision, 3);

    const reviewCommand = {
      operationId: "op_race_review_accept_0001",
      decision: "accepted",
      expectedTaskRevision: 3,
      expectedReviewRevision: 0,
      reason: "Accept only if the reviewed definition remains current.",
      completeTask: true
    };
    const definitionCommand = {
      operationId: "op_race_definition_edit_0001",
      expectedTaskRevision: 3,
      title: current.title,
      goal: "Require a newly revised definition before completion.",
      ownerMemberId: current.ownerMemberId,
      completionPolicy: current.completionPolicy,
      priority: current.priority,
      dueAt: current.dueAt,
      criteria: current.criteria.map((criterion: {
        criterionKey: string;
        required: boolean;
        ordinal: number;
      }) => ({
        criterionKey: criterion.criterionKey,
        description: "The revised definition requires fresh durable evidence.",
        required: criterion.required,
        ordinal: criterion.ordinal
      })),
      assignments: current.assignments.map((assignment: {
        agentId: string;
        role: string;
      }) => ({ agentId: assignment.agentId, role: assignment.role })),
      budgetPolicy: current.budgetPolicy
    };
    const [reviewed, edited] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/results/${proposed.json().resultId as string}/review-decisions`,
        headers: { authorization: context.authorization },
        payload: reviewCommand
      }),
      app.inject({
        method: "PUT",
        url: `/api/tasks/${task.taskId as string}/definition`,
        headers: { authorization: context.authorization },
        payload: definitionCommand
      })
    ]);
    assert.deepEqual(
      [reviewed.statusCode, edited.statusCode].sort((left, right) => left - right),
      [200, 400]
    );

    const expectedWinner = reviewed.statusCode === 200 ? "review" : "definition";
    const beforeRestartTask = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    const beforeRestartResult = await app.inject({
      method: "GET",
      url: `/api/results/${proposed.json().resultId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(beforeRestartTask.statusCode, 200);
    assert.equal(beforeRestartResult.statusCode, 200);
    if (expectedWinner === "review") {
      assert.equal(beforeRestartTask.json().lifecycleState, "completed");
      assert.equal(beforeRestartTask.json().definitionRevision, 1);
      assert.equal(beforeRestartResult.json().state, "accepted");
    } else {
      assert.equal(beforeRestartTask.json().lifecycleState, "active");
      assert.equal(beforeRestartTask.json().definitionRevision, 2);
      assert.equal(beforeRestartResult.json().state, "proposed");
    }

    await app.close();
    app = await createServerApp({
      databasePath: context.databasePath,
      clock: () => now,
      logger: false
    });
    const reopenedTask = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    const reopenedResult = await app.inject({
      method: "GET",
      url: `/api/results/${proposed.json().resultId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.deepEqual(reopenedTask.json(), beforeRestartTask.json());
    assert.deepEqual(reopenedResult.json(), beforeRestartResult.json());
  } finally {
    await app.close();
  }
});

test("Result corrections preserve typed sources, actor limits, and child provenance", async (t) => {
  const context = await setup(t);
  try {
    const task = await createActiveTask(context);
    const run = await createCompletedRun(context, task.taskId as string);
    const artifactId = await createArtifact(context, task.taskId as string);
    const memory = await context.app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/memory-entries`,
      headers: { authorization: context.authorization },
      payload: {
        type: "progress",
        content: "The verification evidence is ready.",
        sourceMessageIds: [run.messageId]
      }
    });
    assert.equal(memory.statusCode, 200, JSON.stringify(memory.json()));
    const discussion = await context.app.inject({
      method: "POST",
      url: `/api/rooms/${context.roomId}/discussions`,
      headers: { authorization: context.authorization },
      payload: {
        taskId: task.taskId,
        goal: "Review the evidence lineage.",
        participantAgentIds: [context.agentId, context.secondAgentId]
      }
    });
    assert.equal(discussion.statusCode, 200, JSON.stringify(discussion.json()));
    const firstProposal: ResultProposal = {
      ...proposal({
        operationId: "op_result_lineage_0001",
        taskId: task.taskId,
        taskRevision: 2,
        definitionRevision: 1,
        criteriaRevision: 1,
        artifactId,
        runId: run.runId
      }),
      sources: [{
        evidenceRefId: "evidence_artifact0001",
        kind: "artifact",
        artifactId
      }, {
        evidenceRefId: "evidence_runevent0001",
        kind: "run_event",
        runId: run.runId,
        sequence: 3
      }, {
        evidenceRefId: "evidence_message0001",
        kind: "message",
        messageId: run.messageId
      }, {
        evidenceRefId: "evidence_memory0001",
        kind: "memory",
        memoryId: memory.json().memoryId
      }, {
        evidenceRefId: "evidence_discuss0001",
        kind: "discussion",
        discussionId: discussion.json().discussion.discussionId
      }]
    };
    const first = await context.app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: firstProposal
    });
    assert.equal(first.statusCode, 200, JSON.stringify(first.json()));
    assert.deepEqual(
      first.json().proposal.sources.map((source: { kind: string }) => source.kind),
      ["artifact", "run_event", "message", "memory", "discussion"]
    );

    const changed = await context.app.inject({
      method: "PUT",
      url: `/api/tasks/${task.taskId as string}/definition`,
      headers: { authorization: context.authorization },
      payload: {
        operationId: "op_change_result_task_0001",
        expectedTaskRevision: 3,
        title: task.title,
        goal: "Produce current evidence after the definition change.",
        ownerMemberId: task.ownerMemberId,
        completionPolicy: task.completionPolicy,
        priority: task.priority,
        dueAt: null,
        criteria: [{
          criterionKey: "criterion_verified0001",
          description: "The current delivery has durable Artifact evidence.",
          required: true,
          ordinal: 1
        }],
        assignments: [
          { agentId: context.agentId, role: "primary" },
          { agentId: context.secondAgentId, role: "contributor" }
        ],
        budgetPolicy: task.budgetPolicy
      }
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().taskRevision, 4);
    assert.equal(changed.json().definitionRevision, 2);
    assert.equal(changed.json().criteriaRevision, 2);
    const staleAccept = await context.app.inject({
      method: "POST",
      url: `/api/results/${first.json().resultId as string}/review-decisions`,
      headers: { authorization: context.authorization },
      payload: {
        operationId: "op_accept_stale_result_0001",
        decision: "accepted",
        expectedTaskRevision: 4,
        expectedReviewRevision: 0,
        reason: "This must fail after definition drift.",
        completeTask: false
      }
    });
    assert.equal(staleAccept.statusCode, 400);
    assert.match(staleAccept.json().error.message, /stale/iu);

    const secondProposal = proposal({
      operationId: "op_result_lineage_0002",
      taskId: task.taskId,
      taskRevision: 4,
      definitionRevision: 2,
      criteriaRevision: 2,
      artifactId,
      runId: run.runId,
      supersedesResultId: first.json().resultId,
      nextActionKey: "next_followup0001"
    });
    const second = await context.app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: secondProposal
    });
    assert.equal(second.statusCode, 200, JSON.stringify(second.json()));
    assert.equal(second.json().resultVersion, 2);
    const superseded = await context.app.inject({
      method: "GET",
      url: `/api/results/${first.json().resultId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(superseded.json().state, "superseded");
    const accepted = await context.app.inject({
      method: "POST",
      url: `/api/results/${second.json().resultId as string}/review-decisions`,
      headers: { authorization: context.authorization },
      payload: {
        operationId: "op_accept_current_result_0001",
        decision: "accepted",
        expectedTaskRevision: 5,
        expectedReviewRevision: 0,
        reason: "Accept the current Result but keep the parent Task active.",
        completeTask: false
      }
    });
    assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.json()));
    assert.equal(accepted.json().result.state, "accepted");

    const childCommand = {
      operationId: "op_child_from_result_0001",
      nextActionKey: "next_followup0001",
      title: "Verify compatibility follow-up",
      ownerMemberId: context.ownerMemberId
    };
    const child = await context.app.inject({
      method: "POST",
      url: `/api/results/${second.json().resultId as string}/follow-up-tasks`,
      headers: { authorization: context.authorization },
      payload: childCommand
    });
    assert.equal(child.statusCode, 200, JSON.stringify(child.json()));
    assert.equal(child.json().parentTaskId, task.taskId);
    assert.equal(child.json().roomId, context.roomId);
    const childReplay = await context.app.inject({
      method: "POST",
      url: `/api/results/${second.json().resultId as string}/follow-up-tasks`,
      headers: { authorization: context.authorization },
      payload: childCommand
    });
    assert.equal(childReplay.json().taskId, child.json().taskId);

    const database = new Database(context.databasePath);
    try {
      const core = new CoreRepository(database);
      const auth = new AuthService(database);
      const taskRepository = new AgentTaskRepository(database);
      const runRepository = new RunRepository(database);
      const resultService = new ResultService(
        database,
        new ResultRepository(database),
        new AgentTaskService(taskRepository, core, auth),
        taskRepository,
        runRepository,
        core,
        auth
      );
      const current = taskRepository.get(task.taskId)!;
      const agentProposal = proposal({
        operationId: "op_manual_agent_result_0001",
        taskId: task.taskId,
        taskRevision: current.taskRevision,
        definitionRevision: current.definitionRevision,
        criteriaRevision: current.criteriaRevision,
        artifactId,
        runId: run.runId
      });
      const agentResult = resultService.proposeManualAgent({
        credentialId: "credential_manual_result_0001",
        userId: "user_result_owner_0001",
        sessionId: "session_manual_result_0001",
        memberId: context.ownerMemberId,
        teamId: context.teamId,
        agentId: context.agentId
      }, {
        runId: run.runId,
        proposal: agentProposal
      }, now);
      assert.deepEqual(agentResult.proposedBy, {
        kind: "manual_agent",
        agentId: context.agentId,
        runId: run.runId
      });
      assert.throws(() => resultService.proposeManagedAgent({
        credentialId: "credential_spoof_result_0001",
        deviceId: "device_spoof_result_0001",
        ownerMemberId: context.ownerMemberId,
        teamId: context.teamId
      }, {
        agentId: context.agentId,
        runId: run.runId,
        proposal: {
          ...agentProposal,
          operationId: "op_spoof_agent_result_0001",
          proposedAtTaskRevision: current.taskRevision + 1
        }
      }, now), /authenticated Device/u);
      assert.deepEqual(database.prepare(`
        SELECT source_result_id, next_action_key FROM task_result_sources
        WHERE child_task_id = ?
      `).get(child.json().taskId), {
        source_result_id: second.json().resultId,
        next_action_key: "next_followup0001"
      });
    } finally {
      database.close();
    }
  } finally {
    await context.app.close();
  }
});

test("Task completion rejects required claims without Artifact evidence", async (t) => {
  const context = await setup(t);
  try {
    const task = await createActiveTask(context);
    const run = await createCompletedRun(context, task.taskId as string);
    const incomplete: ResultProposal = {
      operationId: "op_result_without_artifact_0001",
      taskId: task.taskId,
      definitionRevision: 1,
      criteriaRevision: 1,
      proposedAtTaskRevision: 2,
      supersedesResultId: null,
      outcome: "satisfied",
      summary: "The assertion lacks the required Artifact evidence.",
      risks: [],
      openQuestions: [],
      nextActions: [],
      sources: [{
        evidenceRefId: "evidence_onlyevent0001",
        kind: "run_event",
        runId: run.runId,
        sequence: 3
      }],
      criterionClaims: [{
        criterionKey: "criterion_verified0001",
        coverage: "satisfied",
        explanation: "A Run event alone is not delivery evidence.",
        evidenceRefIds: ["evidence_onlyevent0001"]
      }]
    };
    const proposed = await context.app.inject({
      method: "POST",
      url: `/api/tasks/${task.taskId as string}/results`,
      headers: { authorization: context.authorization },
      payload: incomplete
    });
    assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.json()));
    const rejectedCompletion = await context.app.inject({
      method: "POST",
      url: `/api/results/${proposed.json().resultId as string}/review-decisions`,
      headers: { authorization: context.authorization },
      payload: {
        operationId: "op_complete_without_artifact_0001",
        decision: "accepted",
        expectedTaskRevision: 3,
        expectedReviewRevision: 0,
        reason: "Attempt completion without Artifact evidence.",
        completeTask: true
      }
    });
    assert.equal(rejectedCompletion.statusCode, 400);
    assert.match(rejectedCompletion.json().error.message, /Artifact evidence/u);
    const unchanged = await context.app.inject({
      method: "GET",
      url: `/api/tasks/${task.taskId as string}`,
      headers: { authorization: context.authorization }
    });
    assert.equal(unchanged.json().lifecycleState, "active");
    assert.equal(unchanged.json().taskRevision, 3);
  } finally {
    await context.app.close();
  }
});

async function acceptanceFixture(t: TestContext) {
  const context = await setup(t);
  t.after(() => context.app.close());
  const task = await createActiveTask(context);
  const run = await createCompletedRun(context, task.taskId);
  const artifactId = await createArtifact(context, task.taskId);
  const request = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
    context.app.inject({ method, url, headers: { authorization: context.authorization },
      ...(payload ? { payload: payload as Record<string, unknown> } : {}) });
  const submit = async (id: string, change?: (value: ResultProposal) => void) => {
    const current = (await request("GET", `/api/tasks/${task.taskId}`)).json();
    const value = proposal({ operationId: `op_acceptance_${id}`, taskId: task.taskId,
      taskRevision: current.taskRevision, definitionRevision: current.definitionRevision,
      criteriaRevision: current.criteriaRevision, artifactId, runId: run.runId });
    change?.(value);
    const response = await request("POST", `/api/tasks/${task.taskId}/results`, value);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const view = async (resultId: string) => {
    const response = await request("GET", `/api/results/${resultId}/acceptance-evidence`);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    const validator = new Ajv2020({ strict: true });
    for (const name of ["work/task-result", "common/identifiers"]) {
      validator.addSchema(JSON.parse(readFileSync(new URL(
        `../../../packages/contracts/schemas/${name}.schema.json`, import.meta.url), "utf8")));
    }
    const validate = validator.getSchema(
      "https://agentroom.dev/schemas/work/task-result.schema.json#/$defs/resultAcceptanceEvidence"
    )!;
    assert.equal(validate(response.json()), true, JSON.stringify(validate.errors));
    return response.json<ResultAcceptanceEvidence>();
  };
  return { ...context, task, artifactId, run, request, submit, view };
}

test("acceptance evidence exposes omitted claims without promoting earlier prose or Artifact claims to verified", async (t) => {
  const f = await acceptanceFixture(t);
  const prior = await f.submit("prior0001");
  const candidate = await f.submit("missing0001", (value) => {
    value.outcome = "partial";
    value.summary = "There is no evidence available.";
    value.criterionClaims = [];
    value.sources = value.sources.filter(({ kind }) => kind === "run_event");
  });
  const before = (await f.request("GET", `/api/tasks/${f.task.taskId}`)).json();
  const evidence = await f.view(candidate.resultId);
  assert.equal(evidence.criteria.length, 1);
  assert.equal(evidence.criteria[0]!.candidate, null);
  assert.equal(evidence.criteria[0]!.contributions[0]!.resultId, prior.resultId);
  assert.deepEqual(evidence.criteria[0]!.diagnostics,
    ["missing_claim", "earlier_evidence_not_referenced"]);
  assert.equal(evidence.artifacts[0]!.artifactId, f.artifactId);
  assert.deepEqual(evidence.artifacts[0]!.candidates, [], "a test_result label is not a verifier receipt");
  assert.deepEqual(await f.view(candidate.resultId), evidence);
  assert.deepEqual((await f.request("GET", `/api/tasks/${f.task.taskId}`)).json(), before);
  assert.equal((await f.request("GET", `/api/results/${candidate.resultId}`)).json().state, "proposed");
  assert.equal((await f.app.inject({ method: "GET",
    url: `/api/results/${candidate.resultId}/acceptance-evidence` })).statusCode, 401);
  const stranger = await f.app.inject({ method: "POST", url: "/api/bootstrap",
    payload: { userId: "user_acceptance_stranger0001", displayName: "Stranger" } });
  const forbidden = await f.app.inject({ method: "GET",
    url: `/api/results/${candidate.resultId}/acceptance-evidence`,
    headers: { authorization: `Bearer ${stranger.json().session.token}` } });
  assert.equal(forbidden.statusCode, 403);
  assert.doesNotMatch(forbidden.body, new RegExp(f.artifactId, "u"));
});

test("acceptance evidence compares exact source identity across Result-local reference names and labels rejected history", async (t) => {
  const f = await acceptanceFixture(t);
  const prior = await f.submit("identity_prior0001");
  const kept = await f.submit("identity_kept0001", (value) => {
    value.sources[0]!.evidenceRefId = "evidence_different0001";
    value.criterionClaims[0]!.evidenceRefIds = ["evidence_different0001"];
  });
  assert.deepEqual((await f.view(kept.resultId)).criteria[0]!.diagnostics, []);
  const otherArtifactId = await createArtifact(f, f.task.taskId, "Different candidate");
  const changed = await f.submit("identity_changed0001", (value) => {
    value.sources[0]!.artifactId = otherArtifactId;
    value.criterionClaims[0]!.coverage = "unresolved";
    value.outcome = "partial";
  });
  assert.deepEqual((await f.view(changed.resultId)).criteria[0]!.diagnostics,
    ["earlier_evidence_not_referenced", "differing_coverage"]);
  for (const result of [prior, kept]) {
    const task = (await f.request("GET", `/api/tasks/${f.task.taskId}`)).json();
    const review = await f.request("POST", `/api/results/${result.resultId}/review-decisions`, {
      operationId: `op_reject_acceptance_${result.resultVersion}`, decision: "rejected",
      expectedTaskRevision: task.taskRevision, expectedReviewRevision: 0,
      reason: "Keep this as rejected history, not supporting evidence.", completeTask: false
    });
    assert.equal(review.statusCode, 200, review.body);
  }
  const after = await f.view(changed.resultId);
  assert.deepEqual(after.criteria[0]!.diagnostics, []);
  assert.ok(after.criteria[0]!.contributions.every(({ state }) => state === "rejected"));
});

test("acceptance evidence retains historical criteria and discloses bounded history across restart", async (t) => {
  const f = await acceptanceFixture(t);
  let last;
  for (let index = 0; index < 12; index++) last = await f.submit(`bounded_${String(index).padStart(8, "0")}`);
  const original = await f.view(last.resultId);
  assert.equal(original.historyLimit, 10);
  assert.equal(original.omittedResults, 1);
  assert.equal(original.criteria[0]!.contributions.length, 10);
  assert.equal(original.criteria[0]!.contributions[0]!.resultVersion, 11);
  const current = (await f.request("GET", `/api/tasks/${f.task.taskId}`)).json();
  const edited = await f.request("PUT", `/api/tasks/${f.task.taskId}/definition`, {
    operationId: "op_acceptance_revise0001", expectedTaskRevision: current.taskRevision,
    title: current.title, goal: current.goal, ownerMemberId: current.ownerMemberId,
    completionPolicy: current.completionPolicy, priority: current.priority, dueAt: current.dueAt,
    criteria: [{ ...current.criteria[0], description: "A new criterion description." }],
    assignments: current.assignments.map(({ agentId, role }: { agentId: string; role: string }) => ({ agentId, role })),
    budgetPolicy: current.budgetPolicy
  });
  assert.equal(edited.statusCode, 200, edited.body);
  const historical = await f.view(last.resultId);
  assert.equal(historical.stale, true);
  assert.equal(historical.criteriaRevision, 1);
  assert.equal(historical.currentCriteriaRevision, 2);
  assert.equal(historical.criteria[0]!.criterion.description, original.criteria[0]!.criterion.description);
  await f.app.close();
  const reopened = await createServerApp({ databasePath: f.databasePath, clock: () => now, logger: false });
  t.after(() => reopened.close());
  const replay = await reopened.inject({ method: "GET",
    url: `/api/results/${last.resultId}/acceptance-evidence`, headers: { authorization: f.authorization } });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), historical);
});
