import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test from "node:test";
import type { PeerProof, PeerProofPayload, PeerRunDelivery, PeerRunEvent, PeerRunEventRequest, PeerRunPollRequest,
  PeerRunSettlementRequest, PeerRuntimeChallenge } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript, peerRunDeliveryReceiptDigest } from "@convene-wire/contracts/peer-proof";
import { PeerRunDeliveryService } from "../src/peer/run-delivery.js";
import { PeerRuntimeSessions } from "../src/peer/runtime-sessions.js";
import { PeerRunAuthority } from "../src/peer/run-authority.js";
import { RunRepository } from "../src/run/run-repository.js";
import { SqliteTransactionBoundary } from "../src/data/sqlite-transaction-boundary.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { AuthService } from "../src/security/auth-service.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { executionFixture } from "./helpers/peer-run-fixture.js";
import { denied, now, ownerMember, secret } from "./helpers/peer-fixture.js";

const at = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });

async function deliveryFixture(t: Parameters<typeof executionFixture>[0]) {
  const f = await executionFixture(t), sessions = new PeerRuntimeSessions(f.admission, f.identity);
  const deliveries = new PeerRunDeliveryService(f.database, f.admission, f.identity, f.authority, sessions, f.runs);
  t.after(() => sessions.close());
  const proof = (purpose: PeerProofPayload["purpose"], subject: unknown, time = now, overrides: Partial<PeerProofPayload> = {}): PeerProof => {
    const payload: PeerProofPayload = { ...f.signed().proof.payload, purpose, subjectDigest: peerDigest(subject),
      operationId: "op_peerdelivery001", nonce: secret(), issuedAt: time, expiresAt: new Date(Date.parse(time) + 30000).toISOString(), ...overrides };
    return { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") };
  };
  const connect = (registry = sessions, time = now) => {
    const session = registry.open(f.token, { send() {}, close() {} }, time);
    const challenge = session.challenge(time).payload as PeerRuntimeChallenge, b = challenge.binding;
    const input = { schemaVersion: 1, bindingDigest: peerDigest(b), proof: proof("peer.connect", { phase: "authenticate", binding: b }, time,
      { operationId: b.operationId, nonce: challenge.nonce }) };
    session.receive(Buffer.from(JSON.stringify({ protocolVersion: "peer.v1", type: "peer.runtime.authenticate", messageId: "msg_peerdelivery001", timestamp: time, payload: input })), time);
    return b;
  };
  const binding = connect();
  const poll = (knownRuns: PeerRunPollRequest["intent"]["knownRuns"] = [], time = now, current = binding): PeerRunPollRequest => {
    const intent = { schemaVersion: 1, binding: current, knownRuns };
    return { schemaVersion: 1, intent, proof: proof("run.poll", intent, time) };
  };
  const offer = () => {
    const receipt = deliveries.poll(f.token, poll(), now);
    assert.ok(receipt.delivery);
    return receipt.delivery;
  };
  const event = (delivery: PeerRunDelivery, event: PeerRunEvent, time = now): PeerRunEventRequest => {
    const subject = { schemaVersion: 1, binding: delivery.request.binding, capabilityId: delivery.settlement.capabilityId, event };
    return { ...subject, proof: proof("run.event", subject, time) };
  };
  const settlement = (delivery: PeerRunDelivery, state: PeerRunSettlementRequest["settlement"]["state"] = "completed", time = now): PeerRunSettlementRequest => {
    const subject = { schemaVersion: 1, settlement: { schemaVersion: 1, capabilityId: delivery.settlement.capabilityId,
      operationId: "op_peersettlement001", bindingDigest: peerDigest(delivery.request.binding), sequence: 1, state,
      receiptDigest: peerRunDeliveryReceiptDigest(delivery) } };
    return { ...subject, proof: proof("run.settlement", subject, time) };
  };
  return { ...f, sessions, deliveries, proof, connect, poll, offer, event, settlement };
}

test("Host commits one receipt and recoverable settlement capability before Peer delivery", async t => {
  const f = await deliveryFixture(t), request = f.poll(), receipt = f.deliveries.poll(f.token, request, now);
  assert.ok(receipt.delivery);
  const delivery = receipt.delivery, { proof, ...subject } = receipt;
  verifyPeerProof(proof, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey }, {
    purpose: "run.poll", audienceNodeId: f.membership.participantNodeId, operationId: request.proof.payload.operationId,
    nonce: request.proof.payload.nonce, subjectDigest: peerDigest(subject) }, now);
  assert.equal(delivery.request.binding.runId, f.run.runId);
  assert.notEqual(delivery.settlement.token, f.token);
  const row = f.database.prepare("SELECT * FROM peer_run_deliveries").get();
  assert.equal(JSON.stringify(row).includes(delivery.settlement.token), false);
  assert.equal(f.runs.getRun(f.run.runId)!.state, "queued");
  assert.deepEqual(f.deliveries.poll(f.token, f.poll(), now).delivery, delivery);
  assert.equal(f.deliveries.poll(f.token, f.poll([{ runId: f.run.runId, requestDigest: delivery.request.binding.requestDigest }]), now).delivery, null);
  assert.throws(() => f.deliveries.poll(f.token, f.poll([{ runId: f.run.runId, requestDigest: "b".repeat(64) }]), now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.deliveries.poll(f.token, { ...f.poll(), intent: { ...f.poll().intent, binding: { ...f.poll().intent.binding, connectionId: "peerconnection_foreign001" } } }, now), denied("SCOPE_DENIED"));
  assert.throws(() => f.database.prepare("UPDATE peer_run_deliveries SET expires_at = expires_at").run(), /immutable/u);
  assert.throws(() => f.database.prepare("DELETE FROM peer_run_deliveries").run(), /retained/u);
  const { database } = f.reopen();
  const identity = new AuthorityService(database, "https://host.example.test"), auth = new AuthService(database, () => now);
  const admission = new PeerAdmissionService(database, auth, identity), sessions = new PeerRuntimeSessions(admission, identity);
  t.after(() => sessions.close());
  const reopened = new PeerRunDeliveryService(database, admission, identity, new PeerRunAuthority(database, admission, identity), sessions, new RunRepository(database));
  assert.deepEqual(reopened.poll(f.token, f.poll([], now, f.connect(sessions)), now).delivery, delivery);
  assert.equal((database.prepare("SELECT count(*) AS n FROM run_deliveries").get() as { n: number }).n, 0);
});

test("a Participant denial before start settles the Host's pending cancellation cause", async t => {
  for (const cause of ["requester", "deadline", "authorization_lost", "none"] as const) {
    await t.test(cause, async t => {
      const f = await deliveryFixture(t), delivery = f.offer();
      if (cause === "requester") f.deliveries.cancel(f.run.runId, ownerMember, "Stop waiting", now);
      if (cause === "deadline") {
        f.database.prepare("UPDATE runs SET deadline_at = ? WHERE run_id = ?").run(now, f.run.runId);
        f.deliveries.sweep(now);
      }
      if (cause === "authorization_lost") {
        f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
        f.deliveries.sweep(now);
      }
      const request = f.settlement(delivery, "delivery_denied");
      f.deliveries.settle(delivery.settlement.token, request, now);
      f.deliveries.settle(delivery.settlement.token, request, now);
      assert.equal(f.runs.getRun(f.run.runId)?.state, cause === "requester" ? "canceled" : cause === "deadline" ? "expired" : "failed");
      assert.equal(f.runs.listEvents(f.run.runId).length, 1);
      assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_run_settlements").get() as { n: number }).n, 1);
    });
  }
});

test("Host applies ordered Peer events and exact terminal retries without duplicating Room output", async t => {
  const f = await deliveryFixture(t), delivery = f.offer();
  const send = (event: PeerRunEvent, time = now) => f.deliveries.event(f.token, f.event(delivery, event, time), time);
  assert.throws(() => send({ type: "reply", sequence: 3, content: "early" }), denied("PAYLOAD_CONFLICT"));
  send({ type: "status", sequence: 1, status: "delivered" });
  assert.throws(() => send({ type: "reply", sequence: 2, content: "before working" }), denied("STALE_AUTHORIZATION"));
  send({ type: "status", sequence: 2, status: "working", session: { disposition: "started", contextCursor: delivery.request.payload.session.contextCursor } });
  const event: PeerRunEvent = { type: "reply", sequence: 3, content: "完成 token=topsecretvalue123", assessment: { confidence: 0.875, goalSatisfied: true } };
  const receipt = send(event);
  assert.equal(receipt.eventDigest, peerDigest(event));
  send(event, at(2));
  assert.throws(() => send({ ...event, content: "different" }), denied("PAYLOAD_CONFLICT"));
  send({ type: "status", sequence: 4, status: "completed" });
  send({ type: "status", sequence: 4, status: "completed" }, at(40));
  assert.equal(f.runs.getRun(f.run.runId)!.state, "completed");
  assert.equal(f.runs.listEvents(f.run.runId).length, 4);
  const replies = f.runs.listEvents(f.run.runId).filter(x => x.event.type === "reply");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]!.event.type === "reply" && replies[0]!.event.content.includes("topsecretvalue123"), false);
  const stored = JSON.stringify(f.database.prepare("SELECT * FROM peer_run_events").all());
  assert.equal(stored.includes("topsecretvalue123"), false);
  assert.throws(() => send({ type: "reply", sequence: 5, content: "late" }, at(40)), denied("STALE_AUTHORIZATION"));
});

test("revoked business authority cannot publish content but one bounded capability settles local truth", async t => {
  const f = await deliveryFixture(t), delivery = f.offer(), capability = delivery.settlement.token;
  f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
  assert.throws(() => f.deliveries.event(f.token, f.event(delivery, { type: "status", sequence: 1, status: "delivered" }), now), denied("UNAUTHENTICATED"));
  const input = f.settlement(delivery);
  assert.throws(() => f.deliveries.settle(f.token, input, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.deliveries.poll(capability, f.poll(), now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.authority.authorize(capability, f.request(delivery.request.binding), now), denied("UNAUTHENTICATED"));
  const receipt = f.deliveries.settle(capability, input, now);
  assert.deepEqual(receipt.settlement, input.settlement);
  assert.equal(f.runs.getRun(f.run.runId)!.state, "completed");
  assert.equal(f.runs.listEvents(f.run.runId).filter(e => e.event.type === "reply").length, 0);
  f.deliveries.settle(capability, f.settlement(delivery, "completed", at(40)), at(40));
  assert.equal(f.runs.listEvents(f.run.runId).length, 1);
  assert.throws(() => f.deliveries.settle(capability, f.settlement(delivery, "failed"), now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.deliveries.settle(capability, f.settlement(delivery, "completed", at(604800)), at(604800)), denied("EXPIRED"));
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_run_settlements").get() as { n: number }).n, 1);
  assert.throws(() => f.database.prepare("UPDATE peer_run_settlements SET created_at = created_at").run(), /immutable/u);
});

test("possibly delivered cancellation stays pending then unknown and cannot be reopened by late settlement", async t => {
  const f = await deliveryFixture(t), delivery = f.offer();
  const canceled = f.deliveries.cancel(f.run.runId, ownerMember, "Stop now", now);
  assert.equal(canceled.state, "queued");
  assert.throws(() => f.authority.authorize(f.token, f.request(delivery.request.binding), now), denied("STALE_AUTHORIZATION"));
  f.deliveries.cancel(f.run.runId, ownerMember, "changed reason", at(10));
  assert.equal((f.database.prepare("SELECT reason FROM peer_run_cancellations").get() as { reason: string }).reason, "Stop now");
  assert.deepEqual(f.deliveries.sweep(at(29)), []);
  assert.deepEqual(f.deliveries.sweep(at(30)), [f.run.runId]);
  assert.equal(f.runs.getRun(f.run.runId)!.state, "outcome_unknown");
  f.deliveries.settle(delivery.settlement.token, f.settlement(delivery, "completed", at(40)), at(40));
  assert.equal(f.runs.getRun(f.run.runId)!.state, "outcome_unknown");
  assert.equal(f.runs.listEvents(f.run.runId).length, 1);
});

test("undelivered Peer cancellation is final and grant loss fences a delivered Run", async t => {
  const before = await deliveryFixture(t);
  assert.equal(before.deliveries.cancel(before.run.runId, ownerMember, "Never start", now).state, "canceled");
  assert.equal((before.database.prepare("SELECT count(*) AS n FROM peer_run_deliveries").get() as { n: number }).n, 0);
  const f = await deliveryFixture(t), delivery = f.offer();
  f.admission.revokeMembership(f.actor, f.membership.membershipId, now);
  assert.deepEqual(f.deliveries.sweep(now), [f.run.runId]);
  assert.deepEqual(f.deliveries.sweep(at(31)), [f.run.runId]);
  assert.equal(f.runs.getRun(f.run.runId)!.state, "outcome_unknown");
  assert.throws(() => f.deliveries.event(delivery.settlement.token, f.event(delivery, { type: "status", sequence: 1, status: "completed" }), now), denied("UNAUTHENTICATED"));
});

test("Host rolls back delivery and event projections when durable receipt commits fail", async t => {
  const f = await deliveryFixture(t);
  const notifications: number[] = [];
  const observedRuns = new RunRepository(f.database, new SqliteTransactionBoundary(f.database), () => {
    assert.equal(f.database.inTransaction, false, "published an uncommitted change");
    notifications.push((f.database.prepare("SELECT count(*) AS n FROM peer_run_events").get() as { n: number }).n);
  });
  f.deliveries = new PeerRunDeliveryService(f.database, f.admission, f.identity, f.authority, f.sessions, observedRuns);
  f.database.exec("CREATE TRIGGER test_deny_peer_delivery BEFORE INSERT ON peer_run_deliveries BEGIN SELECT RAISE(ABORT, 'fixture delivery failure'); END");
  assert.throws(() => f.offer(), /fixture delivery failure/u);
  assert.equal(f.authority.get(f.run.runId), undefined);
  f.database.exec("DROP TRIGGER test_deny_peer_delivery");
  const delivery = f.offer();
  f.deliveries.event(f.token, f.event(delivery, { type: "status", sequence: 1, status: "delivered" }), now);
  f.deliveries.event(f.token, f.event(delivery, { type: "status", sequence: 2, status: "working" }), now);
  f.database.exec("CREATE TRIGGER test_deny_peer_event BEFORE INSERT ON peer_run_events BEGIN SELECT RAISE(ABORT, 'fixture receipt failure'); END");
  assert.throws(() => f.deliveries.event(f.token, f.event(delivery, { type: "reply", sequence: 3, content: "must roll back" }), now), /fixture receipt failure/u);
  assert.equal(f.runs.listEvents(f.run.runId).length, 2);
  assert.equal(f.runs.getReplyMessageProjection(f.run.runId, 3), undefined);
  assert.deepEqual(notifications, [1, 2]);
});

test("Peer event and settlement transport cannot widen signed scope or carry hidden content", async t => {
  const f = await deliveryFixture(t), delivery = f.offer();
  const base = f.event(delivery, { type: "status", sequence: 1, status: "delivered" });
  for (const mutate of [
    (v: PeerRunEventRequest) => { v.binding = { ...v.binding, peerId: "peer_otherlineage001" }; },
    (v: PeerRunEventRequest) => { v.binding = { ...v.binding, grantRevision: 99 }; },
    (v: PeerRunEventRequest) => { v.capabilityId = "peersettle_unissued001"; },
    (v: PeerRunEventRequest) => { v.event.sequence = 0; },
    (v: PeerRunEventRequest) => { v.proof.payload.purpose = "run.admission"; },
    (v: PeerRunEventRequest) => { v.proof.payload.audienceNodeId = f.membership.participantNodeId; }
  ]) {
    const changed = structuredClone(base); mutate(changed);
    assert.throws(() => f.deliveries.event(f.token, changed, now));
  }
  assert.throws(() => f.deliveries.event(f.token, base, at(31)));
  for (const field of ["reply", "result", "payload", "deviceId", "membership", "expiresAt"]) {
    const changed = f.settlement(delivery);
    Object.assign(changed.settlement, { [field]: "hidden" });
    assert.throws(() => f.deliveries.settle(delivery.settlement.token, changed, now), denied("INVALID_MESSAGE"));
  }
  for (const field of ["bindingDigest", "receiptDigest"] as const) {
    const changed = f.settlement(delivery); changed.settlement[field] = "f".repeat(64);
    changed.proof = f.proof("run.settlement", { schemaVersion: 1, settlement: changed.settlement });
    assert.throws(() => f.deliveries.settle(delivery.settlement.token, changed, now), denied("PAYLOAD_CONFLICT"));
  }
  const second = f.settlement(delivery); second.settlement.sequence = 2;
  assert.throws(() => f.deliveries.settle(delivery.settlement.token, second, now), denied("INVALID_MESSAGE"));
  assert.equal(f.runs.listEvents(f.run.runId).length, 0);
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_run_settlements").get() as { n: number }).n, 0);
});
