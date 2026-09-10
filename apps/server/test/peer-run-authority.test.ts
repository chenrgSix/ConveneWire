import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test from "node:test";
import type { PeerAdmission, PeerExecutionBinding } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript, verifyPeerRunRequest } from "@convene-wire/contracts/peer-proof";
import { PeerRunAuthority } from "../src/peer/run-authority.js";
import { createServerApp } from "../src/app.js";
import { RunRepository } from "../src/run/run-repository.js";
import { RunService } from "../src/run/run-service.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";
import { MessageService } from "../src/team-room/message-service.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { AuthService } from "../src/security/auth-service.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { now, ownerMember, roomId, secret, denied } from "./helpers/peer-fixture.js";

async function executionFixture(t: Parameters<typeof peerAgentFixture>[0]) {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now);
  const runs = new RunRepository(f.database), tasks = new AgentTaskRepository(f.database);
  const defaultTask = tasks.getDefaultForRoom(roomId)!;
  assert.ok(defaultTask);
  const task = tasks.create({ ...defaultTask, taskId: "task_peerrunfixture001", isDefault: false,
    taskDisplayNumber: tasks.nextDisplayNumber(defaultTask.teamId), assignments: [{ agentId: accepted.projection.projectionAgentId,
      role: "primary", assignedByMemberId: ownerMember, assignedAt: now }] });
  const messages = new MessageService(f.core, f.auth);
  const message = messages.createMemberMessage(f.actor, { roomId, taskId: task.taskId, content: "Peer execution fixture", now,
    mentions: [{ targetType: "agent", targetAgentId: accepted.projection.projectionAgentId, displayLabel: "Participant Writer" }] });
  const run = new RunService(f.core, runs, f.auth, tasks).createRunsForMessage(f.actor, message.messageId, now)[0]!;
  assert.ok(run);
  const authority = new PeerRunAuthority(f.database, f.admission, f.identity);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });
  const request = (binding: PeerExecutionBinding, at = now): PeerAdmission => {
    const payload = { ...f.signed().proof.payload, purpose: "run.admission" as const,
      operationId: "op_runadmission001", nonce: secret(), subjectDigest: peerDigest(binding), issuedAt: at,
      expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { schemaVersion: 1, binding: structuredClone(binding), proof: { payload,
      signature: sign(null, peerProofTranscript(payload), key).toString("base64url") } };
  };
  return { ...f, accepted, messages, run, runs, tasks, authority, request };
}

test("Host freezes its actual Peer Run once and refreshes only exact current admission", async t => {
  const f = await executionFixture(t);
  const request = f.authority.freeze(f.run.runId, now);
  verifyPeerRunRequest(request);
  assert.equal(request.binding.peerId, f.membership.peerId);
  assert.equal(request.payload.taskId, f.run.taskId);
  assert.equal(request.payload.contextManifest.target.runtimeKind, "not_recorded");
  assert.equal(request.payload.contextManifest.permissions.filesystemAccess, "local-policy");
  assert.equal("deviceId" in request.payload.contextManifest.target, false);
  assert.equal("deliveryAttemptId" in request.payload, false);
  const input = f.request(request.binding), receipt = f.authority.authorize(f.token, input, now);
  assert.deepEqual(receipt.binding, request.binding);
  verifyPeerProof(receipt.proof, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey }, {
    purpose: "run.admission", audienceNodeId: f.membership.participantNodeId,
    operationId: input.proof.payload.operationId, nonce: input.proof.payload.nonce, subjectDigest: peerDigest(request.binding)
  }, now);
  const refreshedAt = "2026-09-10T02:01:00.000Z";
  const refreshed = f.authority.authorize(f.token, f.request(request.binding, refreshedAt), refreshedAt);
  assert.notEqual(refreshed.proof.signature, receipt.proof.signature);
  assert.deepEqual(refreshed.binding, request.binding);
  f.messages.createMemberMessage(f.actor, { roomId, content: "Later context must not enter this request", now: refreshedAt });
  assert.deepEqual(f.authority.freeze(f.run.runId, refreshedAt), request);
  assert.throws(() => f.database.prepare("UPDATE peer_run_requests SET request_json = request_json WHERE run_id = ?").run(f.run.runId), /immutable/u);
  assert.throws(() => f.database.prepare("DELETE FROM peer_run_requests WHERE run_id = ?").run(f.run.runId), /retained/u);
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_run_requests").get() as { n: number }).n, 1);
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM run_deliveries").get() as { n: number }).n, 0);
  const { database } = f.reopen();
  const identity = new AuthorityService(database, "https://host.example.test");
  const admission = new PeerAdmissionService(database, new AuthService(database, () => refreshedAt), identity);
  const reopened = new PeerRunAuthority(database, admission, identity);
  assert.deepEqual(reopened.get(f.run.runId), request);
  assert.deepEqual(reopened.authorize(f.token, f.request(request.binding, refreshedAt), refreshedAt).binding, request.binding);
  assert.deepEqual(reopened.freeze(f.run.runId, "2027-01-01T00:00:00.000Z"), request);
  assert.throws(() => reopened.authorize(f.token, f.request(request.binding, "2027-01-01T00:00:00.000Z"), "2027-01-01T00:00:00.000Z"));
});

test("Peer admission rejects changed pins, stale proof and another machine before issuing authority", async t => {
  const f = await executionFixture(t), frozen = f.authority.freeze(f.run.runId, now);
  for (const field of ["authorityNodeId", "participantNodeId", "peerId", "teamId", "roomId", "projectionAgentId", "localAgentId", "requestDigest", "grantDigest", "acceptanceDigest"] as const) {
    const binding = { ...frozen.binding, [field]: field.endsWith("Digest") ? "b".repeat(64) : frozen.binding[field] + "x" };
    assert.throws(() => f.authority.authorize(f.token, f.request(binding), now), field);
  }
  assert.throws(() => f.authority.authorize(f.token, f.request({ ...frozen.binding, grantRevision: 2 }), now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.authority.authorize(secret(), f.request(frozen.binding), now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.authority.authorize(f.token, f.request(frozen.binding), "2026-09-10T02:00:31.000Z"));
  const changed = f.request(frozen.binding);
  changed.proof.payload.purpose = "agent.export";
  assert.throws(() => f.authority.authorize(f.token, changed, now));
  assert.throws(() => f.authority.authorize(f.token, { ...f.request(frozen.binding), payload: frozen.payload } as PeerAdmission, now), denied("INVALID_MESSAGE"));
  const absent = { ...frozen.binding, runId: "run_nevercreated001" };
  assert.throws(() => f.authority.authorize(f.token, f.request(absent), now));
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_run_requests").get() as { n: number }).n, 1);
});

test("current Room, Task, member, grant and Run authority fence post-wait admission", async t => {
  for (const mode of ["Host revoke", "Participant withdrawal", "Room removal", "requester removal", "Task pause", "Task unassign", "cancellation", "terminal", "deadline"]) {
    await t.test(mode, async t => {
      const f = await executionFixture(t), frozen = f.authority.freeze(f.run.runId, now);
      if (mode === "Host revoke") f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
      if (mode === "Participant withdrawal") f.service.offer(f.token, f.signed({ ...f.offer, grant: { ...f.offer.grant, revision: 2, state: "revoked" } }), now);
      if (mode === "Room removal") f.database.prepare("DELETE FROM room_agent_participants WHERE room_id = ? AND agent_id = ?").run(roomId, f.run.targetAgentId);
      if (mode === "requester removal") f.database.prepare("DELETE FROM room_human_participants WHERE room_id = ? AND member_id = ?").run(roomId, ownerMember);
      if (mode === "Task pause") f.database.prepare("UPDATE agent_tasks SET scheduling_state = 'paused' WHERE task_id = ?").run(f.run.taskId);
      if (mode === "Task unassign") f.database.prepare("DELETE FROM task_agent_assignments WHERE task_id = ? AND agent_id = ?").run(f.run.taskId, f.run.targetAgentId);
      if (mode === "cancellation") f.runs.requestCancellation({ runId: f.run.runId, messageId: "msg_peercancel001",
        requestedByMemberId: ownerMember, reason: "Cancel fixture", now, ackDeadlineAt: "2026-09-10T02:00:10.000Z" });
      if (mode === "terminal") f.runs.applyEvent(f.run.runId, { type: "status", sequence: 1, status: "canceled" }, now);
      const at = mode === "deadline" ? f.run.deadlineAt : now;
      assert.throws(() => f.authority.authorize(f.token, f.request(frozen.binding, at), at));
      assert.deepEqual(f.authority.get(f.run.runId), frozen);
      assert.deepEqual(f.authority.freeze(f.run.runId, at), frozen);
    });
  }
});

test("failed freeze rolls back and an accepted retry cannot rewrite the original context", async t => {
  const f = await executionFixture(t);
  f.database.exec("CREATE TRIGGER reject_peer_run BEFORE INSERT ON peer_run_requests BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END");
  assert.throws(() => f.authority.freeze(f.run.runId, now), /fixture rollback/u);
  assert.equal(f.authority.get(f.run.runId), undefined);
  assert.equal(f.runs.getRun(f.run.runId)?.state, "queued");
  f.database.exec("DROP TRIGGER reject_peer_run");
  const frozen = f.authority.freeze(f.run.runId, now);
  const mutated = structuredClone(frozen); mutated.payload.instruction = "Caller mutation";
  assert.deepEqual(f.authority.get(f.run.runId), frozen);
});

test("Peer HTTP Run admission accepts only signed machine requests and never substitutes content", async t => {
  const f = await executionFixture(t), frozen = f.authority.freeze(f.run.runId, now), origin = f.identity.browserOrigin;
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const input = f.request(frozen.binding);
  const post = (payload: unknown = input, headers: Record<string, string> = {}, url = "/api/peer/runs/admit") =>
    app.inject({ method: "POST", url, headers: { "content-type": "application/json", authorization: `Bearer ${f.token}`, ...headers },
      payload: typeof payload === "string" ? payload : JSON.stringify(payload) });
  const accepted = await post();
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.deepEqual(accepted.json().binding, frozen.binding);
  assert.match(String(accepted.headers["cache-control"]), /no-store/u);
  assert.equal(accepted.body.includes(frozen.payload.instruction), false);
  assert.equal(accepted.body.includes(f.token), false);
  assert.equal((await post(input, { origin })).statusCode, 403);
  assert.equal((await post(input, { cookie: `__Host-agentroom_session=${f.ownerSession.secret}` })).statusCode, 403);
  assert.equal((await post(input, { "x-agentroom-device-id": "device_foreign001" })).statusCode, 403);
  assert.equal((await post(input, {}, "/api/peer/runs/admit?runId=foreign")).statusCode, 403);
  assert.equal((await post(input, { authorization: `Bearer ${f.ownerSession.secret}` })).statusCode, 401);
  assert.equal((await post(input, { authorization: `Bearer ${secret()}` })).statusCode, 401);
  for (const payload of [{ ...input, payload: frozen.payload }, { ...input, deviceId: "device_foreign001" },
    JSON.stringify(input).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    JSON.stringify(input).replace('"grantRevision":1', '"grantRevision":1.0000000000000001')]) {
    assert.equal((await post(payload)).statusCode, 400);
  }
  assert.equal((await post(JSON.stringify(input).replace('"grantRevision":1', '"grantRevision":1.0'))).statusCode, 200);
  const changed = f.request({ ...frozen.binding, requestDigest: "b".repeat(64) });
  assert.equal((await post(changed)).statusCode, 409);
  f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
  assert.equal((await post()).statusCode, 401);
});
