import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { PeerProofPayload, PeerRuntimeChallenge, PeerRuntimeMessage } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { peerSecretHash } from "../src/data/peer-membership-repository.js";
import { PeerRuntimeSessions } from "../src/peer/runtime-sessions.js";
import { AuthService } from "../src/security/auth-service.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { fixture, now, ownerMember, denied, secret } from "./helpers/peer-fixture.js";

const participantKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 7)]), format: "der", type: "pkcs8" });
const later = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
const frame = (type: string, payload: unknown, at = now) => Buffer.from(JSON.stringify({ protocolVersion: "peer.v1", type,
  messageId: "msg_runtimefixture001", timestamp: at, payload }));
function authentication(challenge: PeerRuntimeChallenge, change: Partial<PeerProofPayload> = {}, phase = "authenticate") {
  const b = challenge.binding;
  const payload: PeerProofPayload = { schemaVersion: 1, purpose: "peer.connect", signerNodeId: b.participant.nodeId,
    signerPublicKey: b.participant.publicKey, audienceNodeId: b.host.nodeId, operationId: b.operationId, nonce: challenge.nonce,
    subjectDigest: peerDigest({ phase, binding: b }), issuedAt: now, expiresAt: later(30), ...change };
  return { schemaVersion: 1, bindingDigest: peerDigest(b), proof: { payload, signature: sign(null, peerProofTranscript(payload), participantKey).toString("base64url") } };
}

async function runtimeFixture(t: TestContext) {
  const f = await fixture(t), i = f.invite();
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const membership = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  const auth = new AuthService(f.database, () => now);
  const admission = new PeerAdmissionService(f.database, auth, f.identity);
  const sessions = new PeerRuntimeSessions(admission, f.identity);
  t.after(() => sessions.close());
  const open = () => {
    const sent: PeerRuntimeMessage[] = [];
    let closed = false;
    const session = sessions.open(i.machineToken, { send: raw => sent.push(JSON.parse(raw)), close: () => { closed = true; } }, now);
    const challenge = session.challenge(now).payload as PeerRuntimeChallenge;
    return { session, challenge, sent, get closed() { return closed; } };
  };
  return { ...f, i, membership, auth, admission, sessions, open };
}

test("Peer Runtime requires reciprocal phase-bound Node proof before becoming available", async t => {
  const f = await runtimeFixture(t), c = f.open(), binding = c.challenge.binding;
  assert.equal(f.sessions.get(f.membership.peerId, now), undefined);
  verifyPeerProof(c.challenge.proof, binding.host, { purpose: "peer.connect", audienceNodeId: binding.participant.nodeId,
    operationId: binding.operationId, nonce: c.challenge.nonce, subjectDigest: peerDigest({ phase: "challenge", binding }) }, now);
  assert.equal(binding.credentialId, f.i.machine.credentialId);
  assert.equal(binding.memberId, f.membership.memberId);
  c.session.receive(frame("peer.runtime.authenticate", authentication(c.challenge)), now);
  assert.equal(f.sessions.get(f.membership.peerId, now), c.session);
  const ready = c.sent[0]!;
  assert.equal(ready.type, "peer.runtime.ready");
  assert.equal(ready.payload.bindingDigest, peerDigest(binding));
  verifyPeerProof(ready.payload.proof!, binding.host, { purpose: "peer.connect", audienceNodeId: binding.participant.nodeId,
    operationId: binding.operationId, nonce: c.challenge.nonce, subjectDigest: peerDigest({ phase: "ready", binding }) }, now);
  for (const value of [c.challenge, ready]) assert.equal(JSON.stringify(value).includes(f.i.machineToken), false);
  const heartbeat = { schemaVersion: 1, bindingDigest: peerDigest(binding), sequence: 1 };
  c.session.receive(frame("peer.runtime.heartbeat", heartbeat), later(5));
  assert.deepEqual(c.sent[1]!.payload, heartbeat);
  assert.equal(c.sent[1]!.type, "peer.runtime.acknowledged");
  assert.equal(c.closed, false);
});

test("Peer Runtime denies wrong signer, audience, phase, nonce, operation and stale proof", async t => {
  const f = await runtimeFixture(t);
  for (const mutation of ["signer", "audience", "nonce", "operation", "purpose", "phase", "expired"] as const) {
    const c = f.open();
    const changes: Partial<PeerProofPayload> = {};
    if (mutation === "signer") changes.signerPublicKey = secret();
    if (mutation === "audience") changes.audienceNodeId = c.challenge.binding.participant.nodeId;
    if (mutation === "nonce") changes.nonce = secret();
    if (mutation === "operation") changes.operationId = "op_foreignconnection001";
    if (mutation === "purpose") changes.purpose = "human.entry";
    if (mutation === "expired") { changes.issuedAt = later(-60); changes.expiresAt = later(-30); }
    assert.throws(() => c.session.receive(frame("peer.runtime.authenticate", authentication(c.challenge, changes, mutation === "phase" ? "challenge" : "authenticate")), now));
    assert.equal(c.closed, true, mutation);
    assert.equal(f.sessions.get(f.membership.peerId, now), undefined);
  }
});

test("Peer replacement closes the old connection only after fresh authentication", async t => {
  const f = await runtimeFixture(t), old = f.open();
  old.session.receive(frame("peer.runtime.authenticate", authentication(old.challenge)), now);
  const attempted = f.open();
  assert.throws(() => f.open(), denied("SCOPE_DENIED"), "one Peer exhausted other connections with pending handshakes");
  assert.throws(() => attempted.session.receive(frame("peer.runtime.authenticate", authentication(old.challenge)), now));
  assert.equal(old.closed, false);
  assert.equal(f.sessions.get(f.membership.peerId, now), old.session);
  const replacement = f.open();
  replacement.session.receive(frame("peer.runtime.authenticate", authentication(replacement.challenge)), now);
  assert.equal(old.closed, true);
  assert.equal(f.sessions.get(f.membership.peerId, now), replacement.session);
  old.session.close();
  assert.equal(f.sessions.get(f.membership.peerId, now), replacement.session, "old close removed the replacement");
});

test("Peer Runtime rejects duplicate, out-of-order, substituted and Device frames", async t => {
  const f = await runtimeFixture(t);
  for (const mutation of ["duplicate", "out of order", "binding", "Device", "large", "re-authenticate"] as const) {
    const c = f.open();
    c.session.receive(frame("peer.runtime.authenticate", authentication(c.challenge)), now);
    const heartbeat = { schemaVersion: 1, bindingDigest: peerDigest(c.challenge.binding), sequence: 1 };
    let bytes = frame("peer.runtime.heartbeat", heartbeat);
    if (mutation === "duplicate") c.session.receive(bytes, now);
    if (mutation === "out of order") bytes = frame("peer.runtime.heartbeat", { ...heartbeat, sequence: 2 });
    if (mutation === "binding") bytes = frame("peer.runtime.heartbeat", { ...heartbeat, bindingDigest: "a".repeat(64) });
    if (mutation === "Device") bytes = frame("bridge.heartbeat", { deviceId: "device_forbidden001" });
    if (mutation === "large") bytes = Buffer.alloc(32 * 1024 + 1);
    if (mutation === "re-authenticate") bytes = frame("peer.runtime.authenticate", authentication(c.challenge));
    assert.throws(() => c.session.receive(bytes, now), mutation);
    assert.equal(c.closed, true);
  }
});

test("Peer Runtime expires missing proof and heartbeat, and revocation fences an established session", async t => {
  const f = await runtimeFixture(t), pending = f.open();
  f.sessions.sweep(later(30));
  assert.equal(pending.closed, true);
  const idle = f.open();
  idle.session.receive(frame("peer.runtime.authenticate", authentication(idle.challenge)), now);
  assert.equal(f.sessions.get(f.membership.peerId, later(20)), undefined);
  assert.equal(idle.closed, true);
  const revoked = f.open();
  revoked.session.receive(frame("peer.runtime.authenticate", authentication(revoked.challenge)), now);
  f.store.revokeMembership(f.membership.membershipId, now);
  assert.equal(f.sessions.get(f.membership.peerId, now), undefined);
  assert.equal(revoked.closed, true);
  assert.throws(() => f.open(), denied("UNAUTHENTICATED"));
});

test("Peer machine credentials remain bound to the issued Host origin and never select human or Device authority", async t => {
  const f = await runtimeFixture(t);
  const moved = new PeerAdmissionService(f.database, f.auth, f.identity, "https://moved.example.test");
  assert.throws(() => moved.authenticateMachine(f.i.machineToken, now), denied("UNAUTHENTICATED"));
  assert.equal(f.admission.authenticateMachine(f.i.machineToken, now).peerId, f.membership.peerId);
  const transport = { send() {}, close() {} };
  const user = f.auth.issueWebSession(f.membership.userId, now, later(3600));
  assert.throws(() => f.sessions.open(user.secret, transport, now), denied("UNAUTHENTICATED"));
  f.sessions.close();
  assert.throws(() => f.sessions.open(f.i.machineToken, transport, now), denied("SCOPE_DENIED"));
});
