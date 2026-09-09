import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CoreRepository } from "../src/data/core-repository.js";
import { openDatabase } from "../src/data/database.js";
import { migrateDatabase } from "../src/data/migration-runner.js";
import {
  RollingRoomMemoryRepository
} from "../src/memory/rolling-room-memory-repository.js";
import { RunRepository } from "../src/run/run-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { MessageService } from "../src/team-room/message-service.js";
import { TeamRoomService } from "../src/team-room/team-room-service.js";
import { AgentTaskService } from "../src/task/agent-task-service.js";
import { ArtifactRepository } from "../src/task/artifact-repository.js";
import { ContextPlanner } from "../src/task/context-planner.js";
import { TaskArtifactService } from "../src/task/task-artifact-service.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";

const now = "2026-08-25T12:00:00.000Z";

test("Context Planner builds stable provenance projections and bounded relevant events", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "convene-wire-context-"));
  const databasePath = path.join(directory, "server.sqlite");
  await migrateDatabase(databasePath);
  const database = openDatabase(databasePath);
  try {
    const core = new CoreRepository(database);
    const auth = new AuthService(database);
    const teams = new TeamRoomService(core, auth);
    const messages = new MessageService(core, auth);
    const taskRepository = new AgentTaskRepository(database);
    const tasks = new AgentTaskService(taskRepository, core, auth);
    const artifacts = new TaskArtifactService(
      new ArtifactRepository(database),
      taskRepository,
      new RunRepository(database),
      core,
      auth
    );
    const planner = new ContextPlanner(database, core, taskRepository);
    const created = teams.createTeamForUser({
      userId: "user_context_owner",
      userDisplayName: "Alice",
      teamName: "Context Team",
      now
    });
    const session = auth.issueWebSession(
      created.owner.userId ?? "",
      now,
      "2026-08-25T13:00:00.000Z"
    );
    const principal = auth.authenticateWebSession(session.secret, now);
    const room = teams.createRoom(principal, created.team.teamId, "engineering", now);
    const task = tasks.create(principal, {
      roomId: room.roomId,
      title: "OAuth migration",
      goal: "Migrate OAuth without breaking existing clients."
    }, now);
    const otherTask = tasks.create(principal, {
      roomId: room.roomId,
      title: "CI repair",
      goal: "Repair CI independently."
    }, now);

    for (let index = 1; index <= 20; index += 1) {
      messages.createMemberMessage(principal, {
        roomId: room.roomId,
        taskId: task.taskId,
        content: `OAuth evidence ${index}`,
        now
      });
    }
    for (let index = 1; index <= 20; index += 1) {
      messages.createMemberMessage(principal, {
        roomId: room.roomId,
        taskId: otherTask.taskId,
        content: `CI evidence ${index}`,
        now
      });
    }
    const rollingMemory = new RollingRoomMemoryRepository(database);
    rollingMemory.enable(room.roomId, now);
    const lease = rollingMemory.acquireLease({
      roomId: room.roomId,
      leaseToken: "lease_context_planner_0001",
      now,
      leaseExpiresAt: "2026-08-25T12:05:00.000Z"
    });
    assert.ok(lease);
    const checkpointMessages = core.listMessagesRange(room.roomId, 0, 30, 30);
    rollingMemory.commitCheckpoint({
      checkpoint: {
        checkpointId: "checkpoint_context_planner_0001",
        roomId: room.roomId,
        parentCheckpointId: null,
        inputFromSequenceExclusive: 0,
        throughSequence: 30,
        summary: "OAuth work and CI repair are both in progress.",
        provenance: [checkpointMessages[0]!.messageId],
        sourceMessageCount: 30,
        sourceDigest: "a".repeat(64),
        promptVersion: 1,
        modelFingerprint: "test-reducer-v1",
        buildKind: "incremental",
        createdAt: now
      },
      expectedGeneration: lease.generation,
      leaseToken: lease.leaseToken!,
      now
    });
    const trigger = messages.createMemberMessage(principal, {
      roomId: room.roomId,
      taskId: task.taskId,
      content: "Continue OAuth work.",
      now
    });

    const first = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId
    }, now);
    assert.equal(first.contextPlan.roomMemory.revision, 1);
    assert.equal(first.contextPlan.taskMemory.revision, 1);
    assert.match(first.contextPlan.taskMemory.summary, /OAuth migration/u);
    assert.doesNotMatch(first.contextPlan.taskMemory.summary, /CI evidence/u);
    assert.ok(first.contextPlan.taskMemory.sourceMessageIds.length > 0);
    assert.ok(first.contextPlan.taskMemory.sourceMessageIds.every((messageId) =>
      core.getMessage(messageId)?.taskId === task.taskId
    ));
    assert.ok(first.contextMessages.length <= 18);
    assert.equal(first.contextMessages.at(-1)?.messageId, trigger.messageId);
    assert.ok(first.contextMessages.every((message) => message.taskId === task.taskId));
    assert.doesNotMatch(JSON.stringify(first), /CI evidence|OAuth work and CI repair/u);
    assert.ok(first.contextMessages.some((message) =>
      message.taskId === task.taskId && message.messageId !== trigger.messageId
    ));
    assert.equal(first.roomContextBundle, undefined, "automatic Room checkpoints must not cross Tasks");
    assert.deepEqual(first.contextPlan.roomMemory.sourceMessageIds, []);

    const sourceArtifact = artifacts.create(principal, task.taskId, {
      type: "commit",
      workspaceRef: "workspace_oauth",
      repository: "convene-wire/network",
      commitSha: "21f9e8c",
      title: "OAuth implementation",
      summary: "Focused OAuth tests passed."
    }, now);

    const repeated = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId
    }, now);
    assert.equal(repeated.contextPlan.roomMemory.revision, 1);
    assert.equal(repeated.contextPlan.taskMemory.revision, 1);
    const resultEvidence = repeated.contextPlan.resultEvidence;
    assert.ok(resultEvidence);
    assert.equal(resultEvidence.revision, 1);
    assert.deepEqual({
      deliveryKind: resultEvidence.deliveryKind,
      fromRevision: resultEvidence.fromRevision,
      throughRevision: resultEvidence.throughRevision,
      hasMore: resultEvidence.hasMore
    }, {
      deliveryKind: "bootstrap",
      fromRevision: 0,
      throughRevision: 1,
      hasMore: false
    });
    assert.deepEqual(resultEvidence.artifactRefs[0], {
      artifactId: resultEvidence.artifactRefs[0]?.artifactId,
      artifactRevision: 1,
      type: "commit",
      workspaceRef: "workspace_oauth",
      repository: "convene-wire/network",
      commitSha: "21f9e8c",
      title: "OAuth implementation",
      summary: "Focused OAuth tests passed.",
      createdByMemberId: created.owner.memberId,
      createdAt: now
    });
    assert.throws(() => database.prepare(`
      UPDATE task_artifact_refs SET summary = 'rewritten'
      WHERE artifact_id = ?
    `).run(resultEvidence.artifactRefs[0]?.artifactId), /immutable/u);

    for (let index = 2; index <= 31; index += 1) {
      artifacts.create(principal, task.taskId, {
        type: "test_result",
        workspaceRef: "workspace_oauth",
        title: `OAuth verification ${index}`,
        summary: `Verification evidence ${index}.`,
        ...(index === 2
          ? {
              relations: [{
                type: "derives_from" as const,
                targetArtifactId: sourceArtifact.artifact.artifactId
              }]
            }
          : {})
      }, now);
    }
    const firstDelta = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId,
      resultEvidenceAfterRevision: 1
    }, now).contextPlan.resultEvidence;
    assert.ok(firstDelta);
    assert.deepEqual(
      firstDelta.artifactRefs[0]?.relations?.map((relation) => ({
        type: relation.type,
        targetArtifactId: relation.targetArtifactId
      })),
      [{
        type: "derives_from",
        targetArtifactId: sourceArtifact.artifact.artifactId
      }]
    );
    const relationId = firstDelta.artifactRefs[0]?.relations?.[0]?.relationId;
    assert.ok(relationId);
    assert.throws(() => database.prepare(`
      UPDATE task_artifact_relations SET relation_type = 'reviews'
      WHERE relation_id = ?
    `).run(relationId), /immutable/u);
    assert.throws(() => database.prepare(`
      DELETE FROM task_artifact_relations WHERE relation_id = ?
    `).run(relationId), /immutable/u);
    assert.throws(() => database.prepare(`
      INSERT INTO task_artifact_relations (
        relation_id, source_artifact_id, target_artifact_id, task_id, room_id,
        relation_type, created_by_member_id, created_by_agent_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 'reviews', ?, NULL, ?)
    `).run(
      "relation_reverse_12345678",
      sourceArtifact.artifact.artifactId,
      firstDelta.artifactRefs[0]?.artifactId,
      task.taskId,
      room.roomId,
      created.owner.memberId,
      now
    ), /older evidence/u);
    assert.deepEqual({
      deliveryKind: firstDelta.deliveryKind,
      fromRevision: firstDelta.fromRevision,
      throughRevision: firstDelta.throughRevision,
      hasMore: firstDelta.hasMore,
      revisions: firstDelta.artifactRefs.map(({ artifactRevision }) =>
        artifactRevision
      )
    }, {
      deliveryKind: "delta",
      fromRevision: 1,
      throughRevision: 21,
      hasMore: true,
      revisions: Array.from({ length: 20 }, (_, index) => index + 2)
    });
    const secondDelta = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId,
      resultEvidenceAfterRevision: 21
    }, now).contextPlan.resultEvidence;
    assert.ok(secondDelta);
    assert.deepEqual({
      fromRevision: secondDelta.fromRevision,
      throughRevision: secondDelta.throughRevision,
      hasMore: secondDelta.hasMore,
      revisions: secondDelta.artifactRefs.map(({ artifactRevision }) =>
        artifactRevision
      )
    }, {
      fromRevision: 21,
      throughRevision: 31,
      hasMore: false,
      revisions: Array.from({ length: 10 }, (_, index) => index + 22)
    });

    const nextTrigger = messages.createMemberMessage(principal, {
      roomId: room.roomId,
      taskId: task.taskId,
      content: "Verify the next OAuth delta.",
      now
    });
    const advanced = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: nextTrigger.sequence,
      triggerMessageId: nextTrigger.messageId
    }, now);
    assert.equal(advanced.contextPlan.roomMemory.revision, 1);
    assert.equal(advanced.contextPlan.taskMemory.revision, 2);
    const persistedTask = taskRepository.get(task.taskId);
    assert.equal(persistedTask?.summaryRevision, 2);
    assert.deepEqual(
      persistedTask?.summaryProvenanceMessageIds,
      advanced.contextPlan.taskMemory.sourceMessageIds
    );

    const historical = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId
    }, now);
    assert.deepEqual(historical.contextPlan.roomMemory, advanced.contextPlan.roomMemory);
    assert.equal(historical.contextPlan.taskMemory.projectionKind, "historical");
    assert.ok(
      historical.contextPlan.taskMemory.sourceCursor <
        advanced.contextPlan.taskMemory.sourceCursor
    );
    const canonicalTask = taskRepository.get(task.taskId);
    assert.equal(
      canonicalTask?.summarySourceSequence,
      advanced.contextPlan.taskMemory.sourceCursor
    );
    assert.equal(
      canonicalTask?.summaryRevision,
      advanced.contextPlan.taskMemory.revision
    );
    const laterLease = rollingMemory.acquireLease({
      roomId: room.roomId,
      leaseToken: "lease_context_planner_0002",
      now,
      leaseExpiresAt: "2026-08-25T12:05:00.000Z"
    });
    assert.ok(laterLease);
    rollingMemory.commitCheckpoint({
      checkpoint: {
        checkpointId: "checkpoint_context_planner_0002",
        roomId: room.roomId,
        parentCheckpointId: "checkpoint_context_planner_0001",
        inputFromSequenceExclusive: 30,
        throughSequence: 35,
        summary: "A newer checkpoint that an older Run must not observe.",
        provenance: [core.listMessagesRange(room.roomId, 30, 35, 5)[0]!.messageId],
        sourceMessageCount: 5,
        sourceDigest: "c".repeat(64),
        promptVersion: 1,
        modelFingerprint: "test-reducer-v1",
        buildKind: "incremental",
        createdAt: "2026-08-25T12:01:00.000Z"
      },
      expectedGeneration: laterLease.generation,
      leaseToken: laterLease.leaseToken!,
      now: "2026-08-25T12:01:00.000Z"
    });
    taskRepository.update(task.taskId, {
      title: "Newer task title",
      goal: "A newer goal must not leak into an older Run.",
      state: "review",
      primaryAgentId: task.primaryAgentId,
      workspaceRef: task.workspaceRef,
      updatedAt: "2026-08-25T12:01:00.000Z"
    });
    const fenced = planner.plan({
      roomId: room.roomId,
      taskId: task.taskId,
      throughSequence: trigger.sequence,
      triggerMessageId: trigger.messageId,
      contextFence: {
        runId: "run_context_fence_test_0001",
        roomId: room.roomId,
        taskId: task.taskId,
        triggerSequence: trigger.sequence,
        roomLongTermMemoryRevision: 0,
        taskLongTermMemoryRevision: 0,
        taskArtifactRevision: 1,
        taskSummaryRevision: 1,
        taskState: task.state,
        taskTitle: task.title,
        taskGoal: task.goal,
        fenceKind: "captured",
        capturedAt: now
      }
    }, "2026-08-25T12:02:00.000Z");
    assert.match(fenced.contextPlan.taskMemory.summary, /OAuth migration/u);
    assert.doesNotMatch(fenced.contextPlan.taskMemory.summary, /Newer task title/u);
    assert.equal(fenced.contextPlan.taskMemory.projectionKind, "historical");
    assert.deepEqual(
      fenced.contextPlan.resultEvidence?.artifactRefs.map(
        ({ artifactRevision }) => artifactRevision
      ),
      [1]
    );
    assert.equal(fenced.roomContextBundle, undefined);
    assert.throws(() => database.prepare(`
      UPDATE agent_tasks SET summary_source_sequence = 0 WHERE task_id = ?
    `).run(task.taskId), /cannot regress/u);
  } finally {
    database.close();
  }
});

test("Task context reuses only requested accepted Results and explicit public knowledge", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "convene-wire-context-sources-"));
  const databasePath = path.join(directory, "server.sqlite");
  await migrateDatabase(databasePath);
  const database = openDatabase(databasePath);
  try {
    const core = new CoreRepository(database); const auth = new AuthService(database);
    const teams = new TeamRoomService(core, auth); const messages = new MessageService(core, auth);
    const taskRepository = new AgentTaskRepository(database);
    const tasks = new AgentTaskService(taskRepository, core, auth);
    const created = teams.createTeamForUser({ userId: "user_context_sources", userDisplayName: "Alice", teamName: "Sources", now });
    const session = auth.issueWebSession(created.owner.userId!, now, "2026-08-25T13:00:00.000Z");
    const principal = auth.authenticateWebSession(session.secret, now);
    const room = teams.createRoom(principal, created.team.teamId, "project", now);
    const otherRoom = teams.createRoom(principal, created.team.teamId, "elsewhere", now);
    const current = tasks.create(principal, { roomId: room.roomId, title: "Current", goal: "Current goal" }, now);
    const { ResultRepository } = await import("../src/task/result-repository.js");
    const results = new ResultRepository(database);
    function source(title: string, sourceRoom = room.roomId, accepted = true, at = now) {
      const task = tasks.create(principal, { roomId: sourceRoom, title, goal: title }, now);
      database.prepare("UPDATE agent_tasks SET lifecycle_state = 'active', state = 'working' WHERE task_id = ?").run(task.taskId);
      messages.createMemberMessage(principal, { roomId: sourceRoom, taskId: task.taskId, content: `RAW_${title}`, now });
      const result = results.create({ roomId: sourceRoom, actor: { kind: "member", memberId: created.owner.memberId }, now,
        proposal: { operationId: `op_${task.taskId}`, taskId: task.taskId, definitionRevision: task.definitionRevision, criteriaRevision: task.criteriaRevision,
          proposedAtTaskRevision: task.taskRevision, supersedesResultId: null, outcome: "satisfied", summary: `ACCEPTED_${title}`,
          risks: [], openQuestions: [], sources: [], criterionClaims: [], nextActions: [{ nextActionKey: "next_followup_0001", description: "Follow the accepted result" }] } });
      if (accepted) results.review({ resultId: result.resultId, memberId: created.owner.memberId, now: at,
        command: { operationId: `op_review_${task.taskId}`, expectedReviewRevision: 0, expectedTaskRevision: task.taskRevision + 1,
          decision: "accepted", reason: "Verified", completeTask: false } });
      return { task, result };
    }
    const approved = source("approved"); const unrelated = source("unrequested");
    const unaccepted = source("proposed", room.roomId, false);
    const foreign = source("foreign", otherRoom.roomId);
    const future = source("future", room.roomId, true, "2026-08-25T12:10:00.000Z");
    const planner = new ContextPlanner(database, core, taskRepository);
    function plan(content: string, task = current) {
      const message = messages.createMemberMessage(principal, { roomId: room.roomId, taskId: task.taskId, content, now });
      return planner.plan({ roomId: room.roomId, taskId: task.taskId, throughSequence: message.sequence, triggerMessageId: message.messageId }, now);
    }
    const ordinary = JSON.stringify(plan("Continue this Task"));
    assert.equal(ordinary.includes("ACCEPTED_"), false);
    assert.equal(ordinary.includes("RAW_"), false);
    const cited = plan(`Use TASK-${approved.task.taskDisplayNumber}; compare TASK-${unaccepted.task.taskDisplayNumber}, TASK-${foreign.task.taskDisplayNumber}, TASK-${future.task.taskDisplayNumber}.`);
    const text = JSON.stringify(cited);
    assert.ok(text.includes("ACCEPTED_approved"));
    assert.ok(text.includes(approved.result.resultId));
    assert.ok(text.includes(`workTask=${approved.task.taskId}`));
    for (const excluded of ["RAW_", "ACCEPTED_unrequested", "ACCEPTED_proposed", "ACCEPTED_foreign", "ACCEPTED_future"]) assert.equal(text.includes(excluded), false, excluded);
    assert.ok(cited.contextMessages.every(message => message.taskId === current.taskId));
    const childId = results.createChildSource({ resultId: unrelated.result.resultId, nextActionKey: "next_followup_0001", operationId: "op_child_sources_0001", memberId: created.owner.memberId, now,
      createChild: (description) => tasks.create(principal, { roomId: room.roomId, title: "Child", goal: description }, now).taskId });
    assert.ok(JSON.stringify(plan("Continue", taskRepository.get(childId)!)).includes("ACCEPTED_unrequested"));
    const { MemoryEntryRepository } = await import("../src/task/memory-entry-repository.js");
    const { LongTermMemoryService } = await import("../src/task/long-term-memory-service.js");
    const memory = new LongTermMemoryService(database, new MemoryEntryRepository(database), new ArtifactRepository(database), taskRepository, core, new RunRepository(database), auth);
    const sourceMessage = core.listTaskMessagesThrough(approved.task.taskId, Number.MAX_SAFE_INTEGER, 1)[0]!;
    memory.createRoom(principal, room.roomId, { type: "convention", content: "PUBLIC_CONVENTION", sourceMessageIds: [sourceMessage.messageId] }, now);
    memory.createTask(principal, approved.task.taskId, { type: "plan", content: "FOREIGN_PRIVATE_PLAN", sourceMessageIds: [sourceMessage.messageId] }, now);
    const shared = JSON.stringify(plan("Continue without other Task references"));
    assert.ok(shared.includes("PUBLIC_CONVENTION"));
    assert.equal(shared.includes("FOREIGN_PRIVATE_PLAN"), false);
    assert.equal(shared.includes("RAW_approved"), false);
  } finally { database.close(); }
});
