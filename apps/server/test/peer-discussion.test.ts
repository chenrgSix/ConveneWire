import assert from "node:assert/strict";
import test from "node:test";
import { verifyPeerRunRequest } from "@convene-wire/contracts/peer-proof";
import { peerDiscussionFixture } from "./helpers/peer-discussion-fixture.js";
import { denied, now, roomId, otherRoomId } from "./helpers/peer-fixture.js";

const assessment = { goalSatisfied: true, confidence: 0.96, newInformationAdded: true,
  disagreementRemaining: "none" as const, recommendation: "finish" as const };
const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();

test("mixed Device and Peer Discussion freezes each Wave and one remote Finalizer across reopen", async t => {
  const f = await peerDiscussionFixture(t), created = f.create(), discussionId = created.discussion.discussionId;
  const localRun = created.scheduledRuns.find(run => run.targetAgentId === f.localAgent.agentId)!;
  const peerRun = created.scheduledRuns.find(run => run.targetAgentId === f.peerAgentId)!;
  const local = f.deviceDelivery.dispatch(localRun.runId)!, remote = f.receive(peerRun.runId);
  verifyPeerRunRequest(remote.request);
  assert.equal(remote.request.payload.session.resumePolicy, "start_new");
  assert.equal(f.runs.getContextFence(localRun.runId)!.triggerSequence, f.runs.getContextFence(peerRun.runId)!.triggerSequence);
  assert.equal(local.payload.session.contextCursor, remote.request.payload.session.contextCursor);
  assert.deepEqual(local.payload.contextMessages.map(m => m.messageId), remote.request.payload.contextMessages.map(m => m.messageId));
  assert.equal(remote.request.payload.instruction.includes("Recent Room Transcript"), true);
  f.event(remote, { type: "status", sequence: 1, status: "delivered" });
  f.event(remote, { type: "status", sequence: 2, status: "working" });
  f.event(remote, { type: "reply", sequence: 3, content: "Remote accepted evidence", assessment });
  f.event(remote, { type: "status", sequence: 4, status: "completed" });
  assert.equal(f.orchestrator.sweepDueWaves().length, 0);
  assert.equal(f.repository.getWave(created.waves[0]!.waveId)?.state, "open");
  f.runs.applyEvent(localRun.runId, { type: "status", sequence: 1, status: "working" }, now);
  f.runs.applyReply(localRun.runId, { type: "reply", sequence: 2, content: "Local accepted evidence", assessment }, now);
  f.runs.applyEvent(localRun.runId, { type: "status", sequence: 3, status: "completed" }, now);
  // Neither terminal callback is required: committed outcomes are reconciled.
  const scheduled = f.orchestrator.sweepDueWaves();
  assert.equal(scheduled.length, 1);
  const final = scheduled[0]!;
  assert.equal(final.targetAgentId, f.peerAgentId);
  const frozen = f.authority.freeze(final.runId, now);
  assert.equal(frozen.payload.session.resumePolicy, "start_new");
  assert.match(frozen.payload.instruction, /Remote accepted evidence/u);
  assert.match(frozen.payload.instruction, /Local accepted evidence/u);
  assert.equal(frozen.payload.instruction, final.instruction);
  f.messages.createMemberMessage(f.actor, { roomId, taskId: f.task.taskId, content: "Later unrelated Room input", now });
  const r = f.restart();
  r.orchestrator.recover();
  assert.deepEqual(r.authority.freeze(final.runId, now), frozen);
  assert.equal(JSON.stringify(frozen).includes("Later unrelated Room input"), false);
  const deliveredFinal = r.receive(final.runId);
  r.event(deliveredFinal, { type: "status", sequence: 1, status: "delivered" });
  r.event(deliveredFinal, { type: "status", sequence: 2, status: "working" });
  r.event(deliveredFinal, { type: "reply", sequence: 3, content: "Final shared answer" });
  r.settle(deliveredFinal, "completed");
  r.orchestrator.sweepDueWaves();
  r.settle(deliveredFinal, "completed");
  r.event(remote, { type: "status", sequence: 4, status: "completed" });
  assert.equal(r.orchestrator.sweepDueWaves().length, 0);
  const result = r.orchestrator.get(f.actor, discussionId);
  assert.equal(result.discussion.state, "completed");
  assert.equal(result.waves.length, 2);
  assert.equal(result.turns.filter(turn => turn.kind === "finalization").length, 1);
  const provenance = r.database.prepare(`SELECT json_extract(p.request_json, '$.binding.authorityNodeId') AS host,
      json_extract(p.request_json, '$.binding.participantNodeId') AS participant, message.message_id
    FROM discussion_turns t JOIN peer_run_requests p ON p.run_id = t.run_id
    JOIN run_reply_message_projections message ON message.run_id = t.run_id WHERE t.run_id = ?`).get(peerRun.runId);
  assert.deepEqual(provenance, { host: r.identity.nodeId, participant: f.membership.participantNodeId,
    message_id: result.turns.find(turn => turn.runId === peerRun.runId)!.outputMessageId });
  assert.equal((r.database.prepare("SELECT count(*) AS n FROM run_deliveries WHERE run_id = ?").get(final.runId) as { n: number }).n, 0);
});

test("Peer selection requires current bilateral scope and denies unsupported quorum and private mixtures", async t => {
  const f = await peerDiscussionFixture(t);
  assert.equal(f.authority.canParticipateInDiscussion(f.peerAgentId, roomId, now), true);
  assert.equal(f.authority.canParticipateInDiscussion(f.peerAgentId, otherRoomId, now), false);
  const input = { roomId, taskId: f.task.taskId, goal: "Capability check", participantAgentIds: [f.localAgent.agentId, f.peerAgentId] };
  assert.throws(() => f.orchestrator.create(f.actor, { ...input, policy: { waveCompletionMode: "read_only_quorum" } }), /quorum/u);
  f.core.updateAgentPublication({ ...f.localAgent, capabilities: { ...f.localAgent.capabilities, ownerPrivateOutput: true } });
  assert.throws(() => f.orchestrator.create(f.actor, input), /shared-output/u);
  f.core.updateAgentPublication(f.localAgent);
  f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
  assert.equal(f.authority.canParticipateInDiscussion(f.peerAgentId, roomId, now), false);
  assert.throws(() => f.orchestrator.create(f.actor, input), /unavailable/u);
  assert.equal(f.repository.listForRoom(roomId).length, 0);
});

test("a partial Wave excludes the failed participant's staged reply from frozen Finalizer context", async t => {
  const f = await peerDiscussionFixture(t), created = f.create(), id = created.discussion.discussionId;
  const peerRun = created.scheduledRuns.find(run => run.targetAgentId === f.peerAgentId)!;
  const localRun = created.scheduledRuns.find(run => run.targetAgentId === f.localAgent.agentId)!;
  const remote = f.receive(peerRun.runId);
  f.event(remote, { type: "status", sequence: 1, status: "delivered" });
  f.event(remote, { type: "status", sequence: 2, status: "working" });
  f.event(remote, { type: "reply", sequence: 3, content: "FAILED-UNACCEPTED-PEER-CLAIM" });
  f.event(remote, { type: "status", sequence: 4, status: "failed" });
  f.orchestrator.control(f.actor, id, { action: "finish" });
  f.runs.applyEvent(localRun.runId, { type: "status", sequence: 1, status: "working" }, now);
  f.runs.applyReply(localRun.runId, { type: "reply", sequence: 2, content: "ACCEPTED-LOCAL-CLAIM", assessment }, now);
  f.runs.applyEvent(localRun.runId, { type: "status", sequence: 3, status: "completed" }, now);
  const [final] = f.orchestrator.sweepDueWaves();
  assert.ok(final);
  assert.equal(f.repository.listWaves(id)[0]!.state, "partial");
  assert.equal(final.targetAgentId, f.peerAgentId);
  const payload = f.authority.freeze(final.runId, now).payload;
  assert.match(payload.instruction, /ACCEPTED-LOCAL-CLAIM/u);
  assert.doesNotMatch(payload.instruction, /FAILED-UNACCEPTED-PEER-CLAIM/u);
  assert.doesNotMatch(JSON.stringify(payload.contextMessages), /FAILED-UNACCEPTED-PEER-CLAIM/u);
});

test("Peer Wave deadlines distinguish a retained delivery from a never-delivered Run", async t => {
  for (const received of [false, true]) await t.test(String(received), async t => {
    const f = await peerDiscussionFixture(t), created = f.create();
    const run = created.scheduledRuns.find(run => run.targetAgentId === f.peerAgentId)!;
    const delivery = received ? f.receive(run.runId) : undefined;
    f.clock.value = run.deadlineAt;
    f.orchestrator.sweepDueWaves();
    assert.equal(f.runs.getRun(run.runId)?.state, received ? "outcome_unknown" : "expired");
    assert.equal(f.repository.listTurns(created.discussion.discussionId).find(turn => turn.runId === run.runId)?.state, "failed");
    if (delivery) {
      f.settle(delivery, "completed");
      assert.equal(f.runs.getRun(run.runId)?.state, "outcome_unknown");
    }
  });
});

test("revocation and cancellation preserve frozen Wave slots and settle without duplicate finalization", async t => {
  for (const mode of ["revoke", "cancel-restart", "private-change"] as const) await t.test(mode, async t => {
    const f = await peerDiscussionFixture(t), created = f.create(), id = created.discussion.discussionId;
    const peerRun = created.scheduledRuns.find(run => run.targetAgentId === f.peerAgentId)!;
    const remote = f.receive(peerRun.runId), originalMembers = created.turns.map(turn => turn.speakerAgentId);
    if (mode === "revoke") {
      f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
      f.deliveries.sweep(now);
      f.clock.value = at(31);
      f.deliveries.sweep(f.clock.value);
    } else if (mode === "private-change") {
      f.core.updateAgentPublication({ ...f.localAgent, capabilities: { ...f.localAgent.capabilities, ownerPrivateOutput: true } });
      assert.throws(() => f.authority.requireCurrent(remote.request.binding, now), denied("UNSUPPORTED_CAPABILITY"));
      f.deliveries.sweep(now);
      f.clock.value = at(31);
      f.deliveries.sweep(f.clock.value);
    } else {
      f.orchestrator.control(f.actor, id, { action: "cancel" });
      assert.throws(() => f.authority.requireCurrent(remote.request.binding, now), denied("STALE_AUTHORIZATION"));
      // Abrupt Host recovery before per-Run cancellation intents were written.
      const r = f.restart();
      r.orchestrator.recover();
      assert.equal(r.runs.getRun(peerRun.runId)?.state, "outcome_unknown");
      assert.deepEqual(r.repository.listTurns(id).map(turn => turn.speakerAgentId), originalMembers);
      assert.equal(r.repository.listWaves(id)[0]!.state, "failed");
      return;
    }
    f.orchestrator.sweepDueWaves();
    assert.equal(f.runs.getRun(peerRun.runId)?.state, "outcome_unknown");
    assert.deepEqual(f.repository.listTurns(id).map(turn => turn.speakerAgentId), originalMembers);
    f.settle(remote, "canceled");
    f.orchestrator.sweepDueWaves();
    assert.equal(f.runs.getRun(peerRun.runId)?.state, "outcome_unknown");
    assert.equal(f.repository.listTurns(id).filter(turn => turn.kind === "finalization").length, 0);
  });
});
