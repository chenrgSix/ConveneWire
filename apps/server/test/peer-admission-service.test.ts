import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { PeerInvitationClaim, PeerInvitationCreateRequest, PeerProofPayload, PeerLeaveIntent, PeerLeaveRequest } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { peerClaimDigest } from "../src/data/peer-membership-repository.js";
import { AuthService, AuthorizationError } from "../src/security/auth-service.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { PeerAdmissionService, peerJoinReceiptDigest, peerHumanReceiptDigest } from "../src/security/peer-admission-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { peerLeaveReceiptDigest } from "../src/security/peer-departure-service.js";
import { fixture, now, expiry, ownerId, teamId, roomId, otherRoomId, secret, denied } from "./helpers/peer-fixture.js";

export const participantKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 9)]), format: "der", type: "pkcs8" });
export const participant = { nodeId: "node_participant001", publicKey: createPublicKey(participantKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url") };
const create: PeerInvitationCreateRequest = { schemaVersion: 1, operationId: "op_createinvite001", scope: { kind: "room", teamId, roomId }, expiresAt: "2026-09-10T03:00:00.000Z", membershipExpiresAt: expiry };

async function admission(t: TestContext) {
  const f = await fixture(t);
  const auth = new AuthService(f.database, () => now), owner = auth.issueWebSession(ownerId, now, expiry);
  const actor = auth.authenticateWebSession(owner.secret, now);
  const service = new PeerAdmissionService(f.database, auth, f.identity);
  const issued = service.createInvitation(actor, create, now);
  const intent: Omit<PeerInvitationClaim, "challengeId" | "proof"> = { schemaVersion: 1,
    invitationId: issued.invitation.invitationId, invitationDigest: peerDigest(issued.invitation), secret: issued.secret,
    operationId: "op_claiminvite001", participant, localUserId: ownerId, displayName: "Shared name" };
  const claim = (at = now, change = {}) => {
    const pending = { ...intent, ...change };
    const digest = peerClaimDigest(pending as PeerInvitationClaim);
    const challenge = service.challenge({ schemaVersion: 1, invitationId: pending.invitationId, secret: pending.secret,
      participant: pending.participant, operationId: pending.operationId, subjectDigest: digest }, at);
    const payload: PeerProofPayload = { schemaVersion: 1, purpose: "invitation.claim",
      signerNodeId: participant.nodeId, signerPublicKey: participant.publicKey, audienceNodeId: f.identity.nodeId,
      operationId: pending.operationId, nonce: challenge.nonce, subjectDigest: digest, issuedAt: at,
      expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { ...pending, challengeId: challenge.challengeId, proof: { payload,
      signature: sign(null, peerProofTranscript(payload), participantKey).toString("base64url") } };
  };
  return { ...f, auth, actor, owner, service, issued, intent, claim };
}

test("Peer preview and claim sign exact Host/Participant pins and independently issue human and machine secrets", async t => {
  const f = await admission(t);
  const nonce = secret();
  const preview = f.service.preview({ schemaVersion: 1, invitationId: f.intent.invitationId, secret: f.intent.secret,
    participant, operationId: f.intent.operationId, nonce }, now);
  assert.deepEqual(preview.invitation, f.issued.invitation);
  verifyPeerProof(preview.proof, preview.invitation.host, { purpose: "invitation.preview", audienceNodeId: participant.nodeId,
    operationId: f.intent.operationId, nonce, subjectDigest: peerDigest(preview.invitation) }, now);
  const claim = f.claim(), joined = f.service.claim(claim, now), m = joined.runtime.membership;
  assert.notEqual(m.userId, ownerId);
  assert.equal(m.localUserId, ownerId);
  assert.deepEqual(m.scope, create.scope);
  assert.notEqual(joined.human.humanCredential.token, joined.runtime.machineCredential.token);
  const expected = { purpose: "invitation.claim" as const, audienceNodeId: participant.nodeId,
    operationId: claim.operationId, nonce: claim.proof.payload.nonce };
  verifyPeerProof(joined.runtime.proof, f.issued.invitation.host, { ...expected, subjectDigest: peerJoinReceiptDigest(joined.runtime) }, now);
  verifyPeerProof(joined.human.proof, f.issued.invitation.host, { ...expected, subjectDigest: peerHumanReceiptDigest(joined.human) }, now);
  const machine = f.service.authenticateMachine(joined.runtime.machineCredential.token, now);
  assert.equal(machine.audience, "peer.runtime");
  assert.equal(machine.memberId, m.memberId);
  assert.throws(() => f.service.authenticateMachine(joined.human.humanCredential.token, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.authenticateMachine(f.owner.secret, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.auth.authenticateWebSession(joined.runtime.machineCredential.token, now), error => error instanceof AuthorizationError);
  assert.throws(() => f.auth.authenticateWebSession(joined.human.humanCredential.token, now), error => error instanceof AuthorizationError);
  for (const table of ["peer_invitations", "peer_credentials", "peer_human_bindings", "peer_claim_challenges"]) {
    const rows = JSON.stringify(f.database.prepare(`SELECT * FROM ${table}`).all());
    for (const token of [f.issued.secret, joined.runtime.machineCredential.token, joined.human.humanCredential.token]) assert.equal(rows.includes(token), false, table);
  }
  assert.deepEqual(f.database.pragma("foreign_key_check"), []);
});

test("Peer exact retries survive response loss and reopen without duplicate membership or credential renewal", async t => {
  const f = await admission(t);
  assert.deepEqual(f.service.createInvitation(f.actor, create, now), f.issued);
  assert.throws(() => f.service.createInvitation(f.actor, { ...create, scope: { kind: "room", teamId, roomId: otherRoomId } }, now), denied("PAYLOAD_CONFLICT"));
  const original = f.claim(), first = f.service.claim(original, now);
  assert.throws(() => f.service.claim(original, now), denied("STALE_AUTHORIZATION"));
  const later = "2026-09-10T04:00:00.000Z", retry = f.claim(later);
  const reopened = f.reopen();
  const auth = new AuthService(reopened.database, () => later);
  const restored = new PeerAdmissionService(reopened.database, auth, new AuthorityService(reopened.database, f.identity.browserOrigin));
  const second = restored.claim(retry, later);
  assert.deepEqual(second.runtime.membership, first.runtime.membership);
  assert.deepEqual(second.runtime.machineCredential, first.runtime.machineCredential);
  assert.deepEqual(second.human.humanCredential, first.human.humanCredential);
  assert.notEqual(second.runtime.proof.signature, first.runtime.proof.signature);
  assert.equal((reopened.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 1);
  assert.equal((reopened.database.prepare("SELECT count(*) AS n FROM peer_human_bindings").get() as { n: number }).n, 1);
  reopened.store.revokeMembership(first.runtime.membership.membershipId, later);
  assert.throws(() => restored.authenticateMachine(first.runtime.machineCredential.token, later), denied("UNAUTHENTICATED"));
  assert.throws(() => restored.challenge({ schemaVersion: 1, invitationId: retry.invitationId, secret: retry.secret,
    participant, operationId: retry.operationId, subjectDigest: peerClaimDigest(retry) }, later), denied("REVOKED"));
});

test("Peer wrong proof, key, audience, nonce, expired challenge and changed intent fail before side effects", async t => {
  const f = await admission(t);
  const claim = f.claim();
  for (const field of ["purpose", "signerNodeId", "signerPublicKey", "audienceNodeId", "operationId", "nonce", "subjectDigest"] as const) {
    const changed = structuredClone(claim);
    const replacements = { purpose: "peer.connect", signerNodeId: "node_different001", signerPublicKey: "A".repeat(43),
      audienceNodeId: "node_different001", operationId: "op_different001", nonce: secret(), subjectDigest: "a".repeat(64) };
    Object.assign(changed.proof.payload, { [field]: replacements[field] });
    // A valid signature over the wrong context is still denied.
    changed.proof.signature = sign(null, peerProofTranscript(changed.proof.payload), participantKey).toString("base64url");
    assert.throws(() => f.service.claim(changed, now), denied("UNAUTHENTICATED"), field);
  }
  assert.throws(() => f.service.claim({ ...claim, proof: { ...claim.proof, signature: "A".repeat(86) } }, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.claim({ ...claim, displayName: "Changed name" }, now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.service.claim({ ...claim, secret: secret() }, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.service.claim(claim, "2026-09-10T02:00:30.000Z"), denied("STALE_AUTHORIZATION"));
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 0);
  assert.equal((f.database.prepare("SELECT consumed_at FROM peer_claim_challenges WHERE challenge_id = ?").get(claim.challengeId) as { consumed_at: null }).consumed_at, null);
  f.service.claim(claim, now);
  assert.throws(() => f.claim(now, { displayName: "Changed name" }), denied("PAYLOAD_CONFLICT"));
});

test("Peer claim rolls back invitation, new Member, credentials and nonce when receipt persistence fails", async t => {
  const f = await admission(t), claim = f.claim();
  f.database.exec("CREATE TRIGGER fail_peer_human_insert BEFORE INSERT ON peer_human_bindings BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END");
  assert.throws(() => f.service.claim(claim, now), /fixture storage failure/u);
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_memberships").get() as { n: number }).n, 0);
  assert.equal(f.store.getInvitation(claim.invitationId)?.state, "open");
  f.database.exec("DROP TRIGGER fail_peer_human_insert");
  assert.ok(f.service.claim(claim, now));
});

test("Peer invitation cannot survive Host origin change or revoked independent human binding", async t => {
  const f = await admission(t), claim = f.claim();
  const moved = new PeerAdmissionService(f.database, f.auth, f.identity, "https://moved.example.test");
  assert.throws(() => moved.claim(claim, now), denied("SCOPE_DENIED"));
  const joined = f.service.claim(claim, now);
  f.database.prepare("UPDATE peer_human_bindings SET revoked_at = ? WHERE membership_id = ?").run(now, joined.runtime.membership.membershipId);
  assert.throws(() => f.service.claim(f.claim(), now), denied("REVOKED"));
  assert.throws(() => f.database.exec("UPDATE peer_human_bindings SET revoked_at = NULL"), /regain/u);
  f.service.revokeInvitation(f.actor, claim.invitationId, now);
  assert.throws(() => f.service.createInvitation(f.actor, create, now), denied("REVOKED"));
});

function leaveRequest(intent: PeerLeaveIntent, at = now): PeerLeaveRequest {
  const payload: PeerProofPayload = { schemaVersion: 1, purpose: "peer.leave", signerNodeId: participant.nodeId,
    signerPublicKey: participant.publicKey, audienceNodeId: intent.host.nodeId, operationId: intent.operationId,
    nonce: secret(), subjectDigest: peerDigest(intent), issuedAt: at, expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
  return { schemaVersion: 1, intent, proof: { payload, signature: sign(null, peerProofTranscript(payload), participantKey).toString("base64url") } };
}

test("Participant departure revokes exact membership and recovers one immutable receipt after expiry and reopen", async t => {
  const f = await admission(t), joined = f.service.claim(f.claim(), now), membership = joined.runtime.membership;
  const intent: PeerLeaveIntent = { schemaVersion: 1, operationId: "op_departure001", host: joined.runtime.invitation.host,
    hostOrigin: joined.runtime.invitation.hostOrigin, participant, peerId: membership.peerId, membershipId: membership.membershipId };
  const input = leaveRequest(intent), first = f.service.leave(input, now);
  assert.equal(first.state, "revoked");
  assert.equal(f.store.getMembership(membership.membershipId)?.revision, membership.revision + 1);
  assert.throws(() => f.service.authenticateMachine(joined.runtime.machineCredential.token, now), denied("UNAUTHENTICATED"));
  assert.equal(f.database.prepare("SELECT member_id FROM room_human_participants WHERE member_id = ?").get(membership.memberId), undefined);
  assert.ok((f.database.prepare("SELECT revoked_at FROM peer_human_bindings WHERE membership_id = ?").get(membership.membershipId) as { revoked_at: string }).revoked_at);
  verifyPeerProof(first.proof, intent.host, { purpose: "peer.leave", audienceNodeId: participant.nodeId, operationId: intent.operationId,
    nonce: input.proof.payload.nonce, subjectDigest: peerLeaveReceiptDigest(first) }, now);
  const other = f.service.createInvitation(f.actor, { ...create, operationId: "op_otherdepartureinvite001" }, now);
  const otherJoined = f.service.claim(f.claim(now, { invitationId: other.invitation.invitationId,
    invitationDigest: peerDigest(other.invitation), secret: other.secret, operationId: "op_otherdepartureclaim001" }), now);
  assert.throws(() => f.service.leave(leaveRequest({ ...intent, peerId: otherJoined.runtime.membership.peerId,
    membershipId: otherJoined.runtime.membership.membershipId }), now), denied("PAYLOAD_CONFLICT"));
  assert.equal(f.store.getMembership(otherJoined.runtime.membership.membershipId)?.state, "active");
  const later = "2026-10-10T02:00:00.000Z", reopened = f.reopen();
  const restored = new PeerAdmissionService(reopened.database, new AuthService(reopened.database, () => later), new AuthorityService(reopened.database, intent.hostOrigin));
  const retry = restored.leave(leaveRequest(intent, later), later);
  assert.deepEqual(retry.intent, first.intent); assert.equal(retry.recordedAt, first.recordedAt);
  assert.notEqual(retry.proof.signature, first.proof.signature);
  assert.equal(reopened.store.getMembership(membership.membershipId)?.revision, membership.revision + 1);
  assert.throws(() => restored.leave(leaveRequest({ ...intent, operationId: "op_departurechanged001" }, later), later), denied("PAYLOAD_CONFLICT"));
  const rows = JSON.stringify(reopened.database.prepare("SELECT * FROM peer_departures").all());
  for (const token of [f.issued.secret, joined.runtime.machineCredential.token, joined.human.humanCredential.token]) assert.equal(rows.includes(token), false);
  assert.equal((reopened.database.prepare("SELECT count(*) AS n FROM peer_departures").get() as { n: number }).n, 1);
  assert.throws(() => reopened.database.exec("UPDATE peer_departures SET operation_id = 'op_changed001'"), /immutable/u);
  assert.throws(() => reopened.database.exec("DELETE FROM peer_departures"), /retained/u);
  assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
});

test("Participant departure rejects swapped pins and stale proofs, and rolls back both revoke and receipt", async t => {
  const f = await admission(t), joined = f.service.claim(f.claim(), now), membership = joined.runtime.membership;
  const intent: PeerLeaveIntent = { schemaVersion: 1, operationId: "op_departuredeny001", host: joined.runtime.invitation.host,
    hostOrigin: joined.runtime.invitation.hostOrigin, participant, peerId: membership.peerId, membershipId: membership.membershipId };
  for (const change of [{ peerId: "peer_foreign001" }, { membershipId: "peermember_foreign001" },
    { participant: { ...participant, publicKey: secret() } }, { hostOrigin: "https://different.example.test" },
    { host: { ...intent.host, publicKey: secret() } }]) {
    assert.throws(() => f.service.leave(leaveRequest({ ...intent, ...change }), now));
  }
  const request = leaveRequest(intent);
  for (const purpose of ["peer.connect", "human.entry", "run.settlement"] as const) {
    const payload = { ...request.proof.payload, purpose };
    assert.throws(() => f.service.leave({ ...request, proof: { payload, signature: sign(null, peerProofTranscript(payload), participantKey).toString("base64url") } }, now), denied("UNAUTHENTICATED"));
  }
  assert.throws(() => f.service.leave(request, "2026-09-10T02:00:30.000Z"), denied("STALE_AUTHORIZATION"));
  assert.equal(f.store.getMembership(membership.membershipId)?.state, "active");
  f.database.exec("CREATE TRIGGER fail_departure BEFORE INSERT ON peer_departures BEGIN SELECT RAISE(ABORT, 'fixture departure failure'); END");
  assert.throws(() => f.service.leave(request, now), /fixture departure failure/u);
  assert.equal(f.store.getMembership(membership.membershipId)?.state, "active");
  assert.ok(f.service.authenticateMachine(joined.runtime.machineCredential.token, now));
  assert.ok(f.database.prepare("SELECT member_id FROM room_human_participants WHERE member_id = ?").get(membership.memberId));
  f.database.exec("DROP TRIGGER fail_departure");
  f.database.prepare("DELETE FROM room_human_participants WHERE member_id = ?").run(membership.memberId);
  const later = "2026-10-10T02:00:00.000Z";
  assert.equal(f.service.leave(leaveRequest(intent, later), later).state, "revoked");
});
