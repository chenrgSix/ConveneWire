import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { setup } from "./evidence-disclosure-fixture.js";
import { DiscussionOrchestrator } from "../src/discussion/discussion-orchestrator.js";
import { DiscussionRepository } from "../src/discussion/discussion-repository.js";
import { DiscussionDisclosureEvidence } from "../src/discussion/discussion-disclosure-evidence.js";
import { ResultRepository } from "../src/task/result-repository.js";
import { ResultService } from "../src/task/result-service.js";
import { AgentTaskService } from "../src/task/agent-task-service.js";
import { MessageService } from "../src/team-room/message-service.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { EvidenceDisclosureService } from "../src/task/evidence-disclosure-service.js";
import type { EvidenceDisclosureIntent } from "@convene-wire/contracts/task-result";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type Fixture = Awaited<ReturnType<typeof setup>>;

function orchestrator(s: Fixture) {
  const results = new ResultRepository(s.db);
  const resultService = new ResultService(s.db, results,
    new AgentTaskService(s.tasks, s.core, s.auth), s.tasks, s.runRepo, s.core, s.auth);
  return new DiscussionOrchestrator(s.core, new MessageService(s.core, s.auth),
    new DiscussionRepository(s.db), s.runRepo, s.auth, s.tasks, s.now, undefined,
    { results, acceptance: resultService.acceptanceEvidence, disclosures: new DiscussionDisclosureEvidence(s.db, results) });
}

async function start(s: Fixture) {
  const registry = new MemberDeviceService(s.core, s.auth);
  const device = registry.registerOwnDevice(s.a.principal, s.a.device.teamId, "Finalizer", s.now());
  const credential = s.auth.issueDeviceCredential(device.deviceId, s.now());
  const principal = s.auth.authenticateDevice(credential.secret, s.now());
  const agent = s.agents.publishDeviceAgent(principal, { agentId: "agent_disclosure_finalizer0001",
    name: "Finalizer", role: "Reviewer", runtimeScopeId: hash("Finalizer"),
    capabilities: { supportsStart: true, supportsInterrupt: true, supportsResume: false,
      supportsStreaming: false, supportsHandoff: false }, now: s.now() });
  s.teams.replaceRoomParticipants(s.a.principal, s.room.roomId, {
    memberIds: [s.a.device.ownerMemberId, s.b.device.ownerMemberId],
    agentIds: [s.a.agent.agentId, s.b.agent.agentId, agent.agentId]
  }, s.now());
  const task = new AgentTaskService(s.tasks, s.core, s.auth).create(s.a.principal, {
    roomId: s.room.roomId, title: "Authorized evidence review", goal: "Combine approved sources",
    criteria: [{ criterionKey: "criterion_approved_sources", description: "Cite approved Code and Operations evidence; preserve unknown state.", required: true, ordinal: 1 }],
    assignments: [{ agentId: s.a.agent.agentId, role: "contributor" },
      { agentId: s.b.agent.agentId, role: "contributor" }, { agentId: agent.agentId, role: "primary" }]
  }, s.now());
  new AgentTaskService(s.tasks, s.core, s.auth).updateControl(s.a.principal, task.taskId,
    { operationId: "op_discussion_activate0001", expectedTaskRevision: task.taskRevision, lifecycleState: "active" }, s.now());
  const response = await s.request("POST", `/api/rooms/${s.room.roomId}/discussions`, s.a.session.secret, {
    goal: "Combine authorized Code and Operations evidence. Preserve unavailable sources and uncertainty.",
    taskId: task.taskId,
    participantAgentIds: [s.a.agent.agentId, s.b.agent.agentId, agent.agentId], mode: "review",
    outputMode: "final_answer", policy: { initialLeaseTurns: 1, automaticMaxTurns: 1,
      hardMaxTurns: 3, waveTimeoutSeconds: 120, participantSelectionMode: "all_eligible" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const view = response.json();
  const repository = new DiscussionRepository(s.db);
  const turns = repository.listTurns(view.discussion.discussionId);
  const normal = turns.find(turn => turn.speakerAgentId === agent.agentId)!;
  const normalRun = s.runRepo.getRun(normal.runId!)!;
  s.runRepo.applyEvent(normalRun.runId, { type: "status", sequence: 1, status: "working" }, s.now());
  s.core.appendMessage({ messageId: "msg_disclosure_public_reply0001", roomId: s.room.roomId,
    taskId: normalRun.taskId, senderType: "agent", senderId: agent.agentId,
    parentMessageId: normal.inputMessageId, content: "Public review contribution; private source state is unknown.", mentions: [], createdAt: s.now() });
  s.runRepo.applyEvent(normalRun.runId, { type: "reply", sequence: 2, content: "Public review contribution; private source state is unknown." }, s.now());
  s.runRepo.applyEvent(normalRun.runId, { type: "status", sequence: 3, status: "completed" }, s.now());
  orchestrator(s).onRunTerminal(normalRun.runId);
  function complete(owner: Fixture["a"], content: string) {
    const turn = turns.find(item => item.speakerAgentId === owner.agent.agentId)!;
    const run = s.runRepo.getRun(turn.runId!)!;
    s.runRepo.applyEvent(run.runId, { type: "status", sequence: 1, status: "delivered" }, s.now());
    s.eventService.applyStatus(owner.devicePrincipal, { runId: run.runId, traceId: run.traceId,
      agentId: owner.agent.agentId, sequence: 2, status: "working" }, s.now());
    s.eventService.applyStatus(owner.devicePrincipal, { runId: run.runId, traceId: run.traceId,
      agentId: owner.agent.agentId, sequence: 3, status: "completed" }, s.now());
    orchestrator(s).onRunTerminal(run.runId);
    const task = s.tasks.get(run.taskId)!;
    const intent: EvidenceDisclosureIntent = { version: 1, operationId: `op_${run.runId}_release`,
      deviceId: owner.device.deviceId, agentId: owner.agent.agentId, runId: run.runId,
      taskId: task.taskId, roomId: task.roomId, definitionRevision: task.definitionRevision,
      criteriaRevision: task.criteriaRevision, source: { evidenceRef: `evidence_${run.runId}`,
        revision: hash("snapshot"), contentSha256: hash("snapshot"), start: 0, end: 8 },
      contentSha256: hash(content), contentBytes: Buffer.byteLength(content), audience: "room_members",
      expiresAt: new Date(Date.parse(s.now()) + 3600000).toISOString() };
    return { turn, run, intent, content };
  }
  async function release(owner: Fixture["a"], item: ReturnType<typeof complete>) {
    const approval = await s.approve(owner, item.intent);
    assert.equal(approval.statusCode, 200, approval.body);
    const published = await s.publish(owner, approval.json().grantId, item.content);
    assert.equal(published.statusCode, 200, published.body);
    return published.json();
  }
  async function finish() {
    const result = await s.request("POST", `/api/discussions/${view.discussion.discussionId}/actions`, s.a.session.secret, { action: "finish" });
    assert.equal(result.statusCode, 200, result.body);
    for (const run of orchestrator(s).sweepDueWaves()) s.delivery.dispatch(run.runId);
    const final = repository.listTurns(view.discussion.discussionId).find(turn => turn.kind === "finalization");
    assert.ok(final, JSON.stringify(repository.get(view.discussion.discussionId)));
    return s.runRepo.getRun(final.runId!)!;
  }
  return { repository, discussionId: view.discussion.discussionId, agent, device, credential, principal, complete, release, finish };
}

test("private turns wait for consent and admit exact released Results into the shared Finalizer", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "Code digest is checked before activation."), b = d.complete(s.b, "Operations snapshot is incomplete; retirement must wait.");
  assert.equal(d.repository.getTurn(a.turn.turnId)?.terminalReason, "awaiting_owner_disclosure");
  assert.equal(d.repository.getTurn(a.turn.turnId)?.state, "working");
  assert.equal(d.repository.listWaves(d.discussionId)[0]?.state, "open");
  const rb = await d.release(s.b, b), ra = await d.release(s.a, a);
  assert.deepEqual(d.repository.getTurn(a.turn.turnId)?.assessment, { newEvidenceRefs: [ra.result.resultId] });
  assert.equal(d.repository.getTurn(a.turn.turnId)?.terminalReason, "disclosure_released");
  const final = await d.finish();
  assert.equal(final.targetAgentId, d.agent.agentId);
  for (const item of [a, b]) {
    assert.ok(final.instruction.includes(item.content));
    assert.ok(final.instruction.includes(item.intent.source.evidenceRef));
    assert.ok(final.instruction.includes(item.intent.contentSha256));
    assert.equal(s.runRepo.listEvents(item.run.runId).some(event => JSON.stringify(event).includes(item.content)), false);
  }
  assert.ok(final.instruction.includes(ra.result.resultId) && final.instruction.includes(rb.result.resultId));
  assert.ok(final.instruction.includes("criterion_approved_sources"));
  assert.ok(final.instruction.includes('"inclusion":"complete"'));
  assert.equal(ra.result.state, "proposed");
  assert.equal(ra.result.review, null);
  assert.equal(d.repository.get(d.discussionId)?.progress.reviewerApproved, false);
  // Public final delivery uses the production Bridge payload and stays frozen offline.
  const delivery = s.delivery.dispatch(final.runId)!;
  assert.equal(delivery.payload.instruction, final.instruction);
  assert.equal(delivery.sendCount, 0);
  const replay = await s.publish(s.a, ra.grant.grantId, a.content);
  assert.equal(replay.statusCode, 200);
  await s.restart();
  assert.equal(d.repository.listTurns(d.discussionId).filter(turn => turn.kind === "finalization").length, 1);
  assert.equal(s.runRepo.getRun(final.runId)?.instruction, final.instruction);
  // Complete the public output through the existing event service and orchestrator.
  s.delivery.accept(d.principal, final.runId, final.traceId, d.agent.agentId, 1, s.now());
  s.eventService.applyStatus(d.principal, { runId: final.runId, traceId: final.traceId,
    agentId: d.agent.agentId, sequence: 2, status: "working" }, s.now());
  s.eventService.applyReply(d.principal, { runId: final.runId, traceId: final.traceId,
    agentId: d.agent.agentId, sequence: 3, content: "Authorized Code evidence is available; Operations remains incomplete." }, s.now());
  s.eventService.applyStatus(d.principal, { runId: final.runId, traceId: final.traceId,
    agentId: d.agent.agentId, sequence: 4, status: "completed" }, s.now());
  orchestrator(s).onRunTerminal(final.runId);
  assert.equal(d.repository.get(d.discussionId)?.state, "completed");
  assert.notEqual(s.tasks.get(final.taskId)?.lifecycleState, "completed");
});

test("withheld or revoked evidence closes at deadline and late publication never rewrites the Finalizer", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "Code observation approved."), b = d.complete(s.b, "Operations withheld until separately approved.");
  await d.release(s.a, a);
  const grant = (await s.approve(s.b, b.intent)).json();
  assert.equal((await s.request("POST", `/api/evidence-disclosures/${grant.grantId}/revoke`, s.b.session.secret, { expectedRevision: 1 })).statusCode, 200);
  assert.equal((await s.publish(s.b, grant.grantId, b.content)).statusCode, 403);
  s.setNow(d.repository.listWaves(d.discussionId)[0]!.deadlineAt);
  orchestrator(s).sweepDueWaves();
  assert.equal(d.repository.getTurn(b.turn.turnId)?.terminalReason, "disclosure_unavailable");
  const final = await d.finish();
  assert.ok(final.instruction.includes(a.content));
  assert.equal(final.instruction.includes(b.content), false);
  assert.ok(final.instruction.includes("Evidence unavailable (disclosure_unavailable)"));
  const late = { ...b, intent: { ...b.intent, operationId: `${b.intent.operationId}_late` } };
  await d.release(s.b, late);
  orchestrator(s).onRunTerminal(b.run.runId);
  assert.equal(d.repository.getTurn(b.turn.turnId)?.state, "failed");
  assert.equal(s.runRepo.getRun(final.runId)?.instruction, final.instruction);
  assert.equal(s.delivery.dispatch(final.runId)?.payload.instruction, final.instruction);
});

test("finish and cancellation converge waiting private turns without running a model again", async t => {
  for (const action of ["finish", "cancel"] as const) {
    const s = await setup(t), d = await start(s);
    const a = d.complete(s.a, "Never authorized A."), b = d.complete(s.b, "Never authorized B.");
    if (action === "finish") {
      const final = await d.finish();
      assert.ok(final.instruction.includes("disclosure_unavailable"));
      assert.equal(final.instruction.includes(a.content), false);
    } else {
      assert.equal((await s.request("POST", `/api/discussions/${d.discussionId}/actions`, s.a.session.secret, { action })).statusCode, 200);
      orchestrator(s).recover();
      assert.equal(d.repository.get(d.discussionId)?.state, "canceled");
      assert.equal(d.repository.getTurn(b.turn.turnId)?.state, "canceled");
      assert.equal(d.repository.listTurns(d.discussionId).length, 3);
    }
  }
});

test("restart reconciles committed publication even without its HTTP scheduling callback", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "Committed independently of callback."), b = d.complete(s.b, "Other owner approved.");
  const grant = (await s.approve(s.a, a.intent)).json();
  const resultService = new ResultService(s.db, new ResultRepository(s.db), new AgentTaskService(s.tasks, s.core, s.auth), s.tasks, s.runRepo, s.core, s.auth);
  const publisher = new EvidenceDisclosureService(s.db, s.auth, s.core, s.runRepo, s.tasks, resultService);
  publisher.publish(s.a.devicePrincipal, { grantId: grant.grantId, expectedRevision: 1, content: a.content }, s.now());
  assert.equal(d.repository.getTurn(a.turn.turnId)?.terminalReason, "awaiting_owner_disclosure");
  await s.restart();
  assert.equal(d.repository.getTurn(a.turn.turnId)?.terminalReason, "disclosure_released");
  await d.release(s.b, b);
  const final = await d.finish();
  assert.ok(final.instruction.includes(a.content));
});

test("consumer Room removal blocks an offline final delivery; frozen authority is not a reusable read grant", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "Approved A."), b = d.complete(s.b, "Approved B.");
  await d.release(s.a, a); await d.release(s.b, b);
  const final = await d.finish();
  s.delivery.dispatch(final.runId);
  s.db.prepare("DELETE FROM room_agent_participants WHERE room_id = ? AND agent_id = ?").run(s.room.roomId, d.agent.agentId);
  assert.throws(() => s.delivery.accept(d.principal, final.runId, final.traceId, d.agent.agentId, 1, s.now()), /identity mismatch/u);
  assert.equal(s.delivery.dispatch(final.runId), undefined);
  assert.equal(s.runRepo.getRun(final.runId)?.state, "failed");
});

test("all-private finalization and private quorum fail before scheduling", async t => {
  const s = await setup(t);
  const response = await s.request("POST", `/api/rooms/${s.room.roomId}/discussions`, s.a.session.secret, {
    goal: "Private contribution only", participantAgentIds: [s.a.agent.agentId, s.b.agent.agentId], outputMode: "final_answer"
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body, /shared-output Finalizer/u);
  const quorum = await s.request("POST", `/api/rooms/${s.room.roomId}/discussions`, s.a.session.secret, {
    goal: "Private quorum", participantAgentIds: [s.a.agent.agentId, s.b.agent.agentId], outputMode: "none",
    policy: { waveCompletionMode: "read_only_quorum" }
  });
  assert.equal(quorum.statusCode, 400);
  assert.equal(new DiscussionRepository(s.db).listForRoom(s.room.roomId).length, 0);
});

test("unrelated Results and stale criteria cannot be promoted into canonical private evidence", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "Old Task definition evidence."), b = d.complete(s.b, "Old Operations definition evidence.");
  const ra = await d.release(s.a, a); await d.release(s.b, b);
  const unrelated = s.newRun(s.a);
  const grant = (await s.approve(s.a, unrelated.intent)).json();
  const released = (await s.publish(s.a, grant.grantId, unrelated.content)).json();
  const reader = new DiscussionDisclosureEvidence(s.db, new ResultRepository(s.db));
  assert.equal(reader.admitted(released.result.resultId, a.turn), undefined);
  assert.ok(reader.admitted(ra.result.resultId, a.turn));
  s.db.prepare("UPDATE agent_tasks SET criteria_revision = criteria_revision + 1 WHERE task_id = ?").run(a.run.taskId);
  const final = await d.finish();
  assert.equal(final.instruction.includes(a.content), false);
  assert.equal(final.instruction.includes(unrelated.content), false);
  assert.ok(final.instruction.includes("Evidence unavailable"));
});

test("a second release and later revocation cannot replace the first admitted Result", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "First immutable Code release."), b = d.complete(s.b, "Operations approved.");
  const first = await d.release(s.a, a);
  const content = "Second Code release must stay outside this turn.";
  await d.release(s.a, { ...a, content, intent: { ...a.intent, operationId: `${a.intent.operationId}_second`,
    contentSha256: hash(content), contentBytes: Buffer.byteLength(content) } });
  await s.request("POST", `/api/evidence-disclosures/${first.grant.grantId}/revoke`, s.a.session.secret, { expectedRevision: 1 });
  await d.release(s.b, b);
  const final = await d.finish();
  assert.ok(final.instruction.includes(a.content));
  assert.equal(final.instruction.includes(content), false);
  assert.deepEqual(d.repository.getTurn(a.turn.turnId)?.assessment?.newEvidenceRefs, [first.result.resultId]);
});

test("a failed admission transaction leaves committed disclosure recoverable exactly once", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "First owner released."), b = d.complete(s.b, "Second owner committed but admission failed.");
  await d.release(s.a, a);
  s.db.exec("CREATE TRIGGER disclosure_decision_failure BEFORE INSERT ON discussion_decisions BEGIN SELECT RAISE(ABORT, 'injected admission failure'); END;");
  const committed = await d.release(s.b, b);
  assert.ok(committed.result.resultId);
  assert.equal(d.repository.getTurn(b.turn.turnId)?.terminalReason, "awaiting_owner_disclosure");
  s.db.exec("DROP TRIGGER disclosure_decision_failure");
  await s.restart();
  assert.deepEqual(d.repository.getTurn(b.turn.turnId)?.assessment?.newEvidenceRefs, [committed.result.resultId]);
  const final = await d.finish();
  assert.ok(final.instruction.includes(b.content));
  assert.equal(d.repository.listTurns(d.discussionId).length, 4);
});

test("Task revision and owner membership changes block frozen disclosure delivery", async t => {
  for (const change of ["criteria", "member", "device", "assignment"] as const) {
    const s = await setup(t), d = await start(s);
    const a = d.complete(s.a, "Code released."), b = d.complete(s.b, "Operations released.");
    await d.release(s.a, a); await d.release(s.b, b);
    const final = await d.finish();
    if (change === "criteria") s.db.prepare("UPDATE agent_tasks SET criteria_revision = criteria_revision + 1 WHERE task_id = ?").run(final.taskId);
    if (change === "member") s.db.prepare("DELETE FROM room_human_participants WHERE room_id = ? AND member_id = ?").run(s.room.roomId, s.a.device.ownerMemberId);
    if (change === "device") s.db.prepare("UPDATE devices SET status = 'revoked' WHERE device_id = ?").run(d.device.deviceId);
    if (change === "assignment") s.db.prepare("DELETE FROM task_agent_assignments WHERE task_id = ? AND agent_id = ?").run(final.taskId, d.agent.agentId);
    assert.equal(s.delivery.dispatch(final.runId), undefined, change);
    assert.equal(s.runRepo.getRun(final.runId)?.state, "failed", change);
  }
});

test("Finalizer failure retains missing private sources in the deterministic fallback", async t => {
  const s = await setup(t), d = await start(s);
  d.complete(s.a, "Unreleased Code candidate."); d.complete(s.b, "Unreleased Operations candidate.");
  const final = await d.finish();
  s.runRepo.applyEvent(final.runId, { type: "status", sequence: 1, status: "failed" }, s.now());
  orchestrator(s).onRunTerminal(final.runId);
  const fallback = s.core.getMessage(`msg_fallback_${d.discussionId.slice(11)}`)!;
  assert.ok(fallback.content.includes("未取得可接纳的私有证据：2 项"));
  assert.ok(fallback.content.includes("仍未解决"));
  assert.equal(fallback.content.includes("Unreleased Code candidate"), false);
});

test("large released sources report truncation and retain required finalization sections", async t => {
  const s = await setup(t), d = await start(s);
  const a = d.complete(s.a, "界".repeat(5000)), b = d.complete(s.b, "Other source " + "x".repeat(16000));
  await d.release(s.a, a); await d.release(s.b, b);
  const final = await d.finish();
  assert.ok([...final.instruction].length <= 20000);
  assert.match(final.instruction, /"inclusion":"truncated"/u);
  assert.ok(final.instruction.includes("## Your Task"));
  assert.ok(final.instruction.includes(a.intent.source.evidenceRef));
  assert.ok(final.instruction.includes(b.intent.source.evidenceRef));
});
