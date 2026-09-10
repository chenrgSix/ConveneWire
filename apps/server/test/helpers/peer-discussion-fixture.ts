import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import type Database from "better-sqlite3";
import type { PeerProofPayload, PeerRunDelivery, PeerRunEvent, PeerRuntimeChallenge } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript, peerRunDeliveryReceiptDigest } from "@convene-wire/contracts/peer-proof";
import { BridgeConnectionRegistry } from "../../src/bridge/bridge-connection-registry.js";
import { CoreRepository } from "../../src/data/core-repository.js";
import { DiscussionOrchestrator } from "../../src/discussion/discussion-orchestrator.js";
import { DiscussionRepository } from "../../src/discussion/discussion-repository.js";
import { PeerRunAuthority } from "../../src/peer/run-authority.js";
import { PeerRunDeliveryService } from "../../src/peer/run-delivery.js";
import { PeerRuntimeSessions } from "../../src/peer/runtime-sessions.js";
import { AgentService } from "../../src/registry/agent-service.js";
import { MemberDeviceService } from "../../src/registry/member-device-service.js";
import { DeliveryService } from "../../src/run/delivery-service.js";
import { RunRepository } from "../../src/run/run-repository.js";
import { AuthService } from "../../src/security/auth-service.js";
import { AuthorityService } from "../../src/security/authority-service.js";
import { PeerAdmissionService } from "../../src/security/peer-admission-service.js";
import { ContextPlanner } from "../../src/task/context-planner.js";
import { AgentTaskRepository } from "../../src/task/task-repository.js";
import { MessageService } from "../../src/team-room/message-service.js";
import { peerAgentFixture } from "./peer-agent-fixture.js";
import { now, ownerMember, roomId, secret, teamId } from "./peer-fixture.js";

const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });

export async function peerDiscussionFixture(t: Parameters<typeof peerAgentFixture>[0]) {
  const f = await peerAgentFixture(t), clock = { value: now };
  f.offer.grant.capabilities.supportsResume = true;
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now), peerAgentId = accepted.projection.projectionAgentId;
  const device = new MemberDeviceService(f.core, f.auth).registerOwnDevice(f.actor, teamId, "Host local Bridge", now);
  const localAgent = new AgentService(f.core, f.auth).publishAgent(f.actor, { teamId, deviceId: device.deviceId,
    name: "Host contributor", role: "Reviewer", integrationMode: "managed", capabilities: {
      supportsStart: true, supportsStreaming: true, supportsInterrupt: true, supportsHandoff: false,
      supportsResume: false, supportsTaskContextIsolation: true
    }, runtimePolicy: { filesystemAccess: "read-only" }, now });
  const tasks = new AgentTaskRepository(f.database), original = tasks.getDefaultForRoom(roomId)!;
  const task = tasks.create({ ...original, taskId: "task_peerdiscussion001", isDefault: false,
    taskDisplayNumber: tasks.nextDisplayNumber(teamId), assignments: [
      { agentId: peerAgentId, role: "primary", assignedByMemberId: ownerMember, assignedAt: now },
      { agentId: localAgent.agentId, role: "contributor", assignedByMemberId: ownerMember, assignedAt: now }
    ] });

  const open = (database: Database.Database) => {
    const core = new CoreRepository(database), auth = new AuthService(database, () => clock.value);
    const identity = new AuthorityService(database, f.identity.browserOrigin);
    const admission = new PeerAdmissionService(database, auth, identity), authority = new PeerRunAuthority(database, admission, identity);
    const runs = new RunRepository(database), tasks = new AgentTaskRepository(database), messages = new MessageService(core, auth);
    const repository = new DiscussionRepository(database), sessions = new PeerRuntimeSessions(admission, identity);
    f.resources.defer(() => sessions.close());
    const deliveries = new PeerRunDeliveryService(database, admission, identity, authority, sessions, runs);
    const orchestrator = new DiscussionOrchestrator(core, messages, repository, runs, auth, tasks, () => clock.value,
      undefined, {}, (agentId, roomId, at) => authority.canParticipateInDiscussion(agentId, roomId, at));
    const deviceDelivery = new DeliveryService(database, core, runs, new ContextPlanner(database, core, tasks),
      new BridgeConnectionRegistry(), () => clock.value);
    const proof = (purpose: PeerProofPayload["purpose"], subject: unknown, overrides: Partial<PeerProofPayload> = {}) => {
      const payload: PeerProofPayload = { ...f.signed().proof.payload, purpose, subjectDigest: peerDigest(subject),
        operationId: "op_discussionfixture001", nonce: secret(), issuedAt: clock.value,
        expiresAt: new Date(Date.parse(clock.value) + 30_000).toISOString(), ...overrides };
      return { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") };
    };
    const receive = (runId: string) => {
      deliveries.dispatch(runId, clock.value);
      const session = sessions.open(f.token, { send() {}, close() {} }, clock.value);
      const challenge = session.challenge(clock.value).payload as PeerRuntimeChallenge, binding = challenge.binding;
      session.receive(Buffer.from(JSON.stringify({ protocolVersion: "peer.v1", type: "peer.runtime.authenticate",
        messageId: "msg_peerdiscussion001", timestamp: clock.value, payload: { schemaVersion: 1,
          bindingDigest: peerDigest(binding), proof: proof("peer.connect", { phase: "authenticate", binding },
            { operationId: binding.operationId, nonce: challenge.nonce }) } })), clock.value);
      const intent = { schemaVersion: 1, binding, knownRuns: [] };
      const delivery = deliveries.poll(f.token, { schemaVersion: 1, intent, proof: proof("run.poll", intent) }, clock.value).delivery;
      assert.equal(delivery?.request.binding.runId, runId);
      return delivery!;
    };
    const event = (delivery: PeerRunDelivery, event: PeerRunEvent) => {
      const subject = { schemaVersion: 1, binding: delivery.request.binding, capabilityId: delivery.settlement.capabilityId, event };
      return deliveries.event(f.token, { ...subject, proof: proof("run.event", subject) }, clock.value);
    };
    const settle = (delivery: PeerRunDelivery, state: "completed" | "failed" | "canceled" | "outcome_unknown" | "delivery_denied") => {
      const subject = { schemaVersion: 1, settlement: { schemaVersion: 1, capabilityId: delivery.settlement.capabilityId,
        operationId: "op_discussionsettle001", bindingDigest: peerDigest(delivery.request.binding), sequence: 1, state,
        receiptDigest: peerRunDeliveryReceiptDigest(delivery) } };
      return deliveries.settle(delivery.settlement.token, { ...subject, proof: proof("run.settlement", subject) }, clock.value);
    };
    return { database, core, auth, identity, admission, authority, runs, tasks, messages, repository, sessions,
      deliveries, orchestrator, deviceDelivery, receive, event, settle };
  };
  const initial = open(f.database);
  return { ...f, ...initial, accepted, clock, peerAgentId, localAgent, task,
    create: () => initial.orchestrator.create(f.actor, { roomId, taskId: task.taskId, goal: "Retain one authoritative outcome.",
      participantAgentIds: [localAgent.agentId, peerAgentId], outputMode: "final_answer" }),
    restart: () => { initial.sessions.close(); return open(f.reopen().database); } };
}
