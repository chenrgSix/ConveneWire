import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import test, { type TestContext } from "node:test";
import type { PeerHumanEntryRequest, PeerInvitationClaim, PeerProofPayload, PeerScope } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { createServerApp } from "../src/app.js";
import { AuthService, AuthorizationError } from "../src/security/auth-service.js";
import { peerClaimDigest } from "../src/data/peer-membership-repository.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { PeerHumanEntryService, peerHumanEntryDigest, peerHumanEntryIntent } from "../src/security/peer-human-entry-service.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { fixture, now, expiry, ownerId, teamId, roomId, otherRoomId, secret, denied } from "./helpers/peer-fixture.js";

async function joined(t: TestContext, teamScope = false, membershipExpiresAt = expiry) {
  const f = await fixture(t);
  let current = now;
  const auth = new AuthService(f.database, () => current);
  const admission = new PeerAdmissionService(f.database, auth, f.identity);
  const human = new PeerHumanEntryService(f.database, auth, f.identity);
  const scope: PeerScope = teamScope ? { kind: "team", teamId, roomId: null } : { kind: "room", teamId, roomId };
  const owner = auth.issueWebSession(ownerId, now, expiry);
  const issued = admission.createInvitation(auth.authenticateWebSession(owner.secret, now), { schemaVersion: 1,
    operationId: "op_humaninvite001", scope, expiresAt: "2026-09-10T02:01:00.000Z", membershipExpiresAt }, now);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 17)]), format: "der", type: "pkcs8" });
  const participant = { nodeId: "node_humanclient001", publicKey: createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url") };
  const proof = (purpose: PeerProofPayload["purpose"], operationId: string, nonce: string, subjectDigest: string, at = current) => {
    const payload: PeerProofPayload = { schemaVersion: 1, purpose, operationId, nonce, subjectDigest,
      signerNodeId: participant.nodeId, signerPublicKey: participant.publicKey, audienceNodeId: f.identity.nodeId,
      issuedAt: at, expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { payload, signature: sign(null, peerProofTranscript(payload), key).toString("base64url") };
  };
  const intent = { schemaVersion: 1 as const, invitationId: issued.invitation.invitationId, invitationDigest: peerDigest(issued.invitation),
    secret: issued.secret, participant, operationId: "op_humanclaim001", localUserId: ownerId, displayName: "Invited human" };
  const digest = peerClaimDigest(intent as PeerInvitationClaim);
  const challenge = admission.challenge({ schemaVersion: 1, invitationId: intent.invitationId, secret: intent.secret, participant,
    operationId: intent.operationId, subjectDigest: digest }, now);
  const connection = admission.claim({ ...intent, challengeId: challenge.challengeId,
    proof: proof("invitation.claim", intent.operationId, challenge.nonce, digest) }, now);
  const binding = connection.human.humanCredential;
  const request = (operationId = "op_humanentry001", entryScope = scope): PeerHumanEntryRequest => {
    const input = { schemaVersion: 1 as const, operationId, bindingCredentialId: binding.credentialId,
      bindingToken: binding.token, scope: entryScope, nonce: secret() };
    return { ...input, proof: proof("human.entry", operationId, input.nonce, peerHumanEntryIntent(input)) };
  };
  return { ...f, auth, admission, human, connection, binding, request, scope, participant, owner,
    clock: () => current, setClock: (at: string) => { current = at; } };
}
const browserRequest = (entry: ReturnType<PeerHumanEntryService["issue"]>) => ({ schemaVersion: 1 as const, credentialId: entry.credential.credentialId, token: entry.credential.token });

test("Peer independent human entry preserves a 60-second exchange and bounded session ceiling", async t => {
  const f = await joined(t, true), roomScope: PeerScope = { kind: "room", teamId, roomId };
  const request = f.request("op_narrowentry001", roomScope), entry = f.human.issue(request, now);
  assert.equal(entry.exchangeExpiresAt, "2026-09-10T02:01:00.000Z");
  assert.equal(entry.credential.expiresAt, "2026-09-10T10:00:00.000Z");
  verifyPeerProof(entry.proof, f.connection.runtime.invitation.host, { purpose: "human.entry", audienceNodeId: f.participant.nodeId,
    operationId: request.operationId, nonce: request.nonce, subjectDigest: peerHumanEntryDigest(entry) }, now);
  const retry = f.human.issue(f.request("op_narrowentry001", roomScope), now);
  assert.deepEqual(retry.credential, entry.credential);
  assert.equal(retry.exchangeExpiresAt, entry.exchangeExpiresAt);
  assert.throws(() => f.human.issue(f.request("op_narrowentry001"), now), denied("PAYLOAD_CONFLICT"));
  const browser = browserRequest(entry);
  assert.deepEqual(f.human.preview(browser, now).scope, roomScope);
  const consumed = f.human.consume(browser, "2026-09-10T02:00:59.000Z");
  assert.equal(consumed.session.expiresAt, entry.credential.expiresAt);
  const actor = f.auth.authenticateWebSession(consumed.session.secret, "2026-09-10T03:00:00.000Z");
  assert.equal(actor.peerAccess?.roomId, roomId);
  assert.throws(() => f.auth.requireRoomMember(actor, otherRoomId), error => error instanceof AuthorizationError);
  assert.throws(() => f.human.consume(browser, now), denied("REVOKED"));
  assert.throws(() => f.human.issue(f.request("op_narrowentry001", roomScope), now), denied("REVOKED"));
  assert.throws(() => f.admission.authenticateMachine(entry.credential.token, now), denied("UNAUTHENTICATED"));
  f.setClock(entry.credential.expiresAt);
  assert.throws(() => f.auth.requireRoomMember(actor, roomId), error => error instanceof AuthorizationError);
});

test("Peer machine or key-only requests, stale proof, wider scope and removed Room ACL cannot create entry", async t => {
  const f = await joined(t), request = f.request();
  for (const token of [secret(), f.connection.runtime.machineCredential.token, f.owner.secret]) {
    assert.throws(() => f.human.issue({ ...request, bindingToken: token }, now), denied("UNAUTHENTICATED"));
  }
  assert.throws(() => f.human.issue({ ...request, proof: { ...request.proof, signature: "A".repeat(86) } }, now), denied("UNAUTHENTICATED"));
  assert.throws(() => f.human.issue(request, "2026-09-10T02:00:30.000Z"), denied("STALE_AUTHORIZATION"));
  assert.throws(() => f.human.issue(f.request("op_widerentry001", { kind: "team", teamId, roomId: null }), now), denied("SCOPE_DENIED"));
  f.database.prepare("DELETE FROM room_human_participants WHERE member_id = ?").run(f.connection.runtime.membership.memberId);
  assert.throws(() => f.human.issue(request, now), denied("SCOPE_DENIED"));
  assert.equal((f.database.prepare("SELECT count(*) AS n FROM peer_human_entries").get() as { n: number }).n, 0);
});

test("Peer entry expiry is not renewable with a fresh proof and membership expiry bounds session time", async t => {
  const f = await joined(t, false, "2026-09-10T02:05:00.000Z");
  const entry = f.human.issue(f.request(), now);
  assert.equal(entry.credential.expiresAt, "2026-09-10T02:05:00.000Z");
  f.setClock(entry.exchangeExpiresAt);
  assert.throws(() => f.human.preview(browserRequest(entry), f.clock()), denied("EXPIRED"));
  assert.throws(() => f.human.issue(f.request(), f.clock()), denied("EXPIRED"));
  const second = f.human.issue(f.request("op_secondentry001"), f.clock());
  assert.equal(second.credential.expiresAt, entry.credential.expiresAt);
});

test("Peer human binding revoke invalidates pending tickets and captured sessions while Runtime remains separate", async t => {
  const f = await joined(t);
  const first = f.human.issue(f.request(), now), pending = f.human.issue(f.request("op_pendingentry001"), now);
  const session = f.human.consume(browserRequest(first), now).session;
  const actor = f.auth.authenticateWebSession(session.secret, now);
  f.database.prepare("UPDATE peer_human_bindings SET revoked_at = ? WHERE credential_id = ?").run(now, f.binding.credentialId);
  assert.throws(() => f.human.consume(browserRequest(pending), now), denied("REVOKED"));
  assert.throws(() => f.human.issue(f.request("op_revokedentry001"), now), denied("REVOKED"));
  assert.throws(() => f.auth.authenticateWebSession(session.secret, now), error => error instanceof AuthorizationError);
  assert.throws(() => f.auth.requireRoomMember(actor, roomId), error => error instanceof AuthorizationError);
  assert.equal(f.admission.authenticateMachine(f.connection.runtime.machineCredential.token, now).peerId, f.connection.runtime.membership.peerId);
});

test("Peer browser exchange rollback retains one-use ticket and signed human entry survives reopen", async t => {
  const f = await joined(t), request = f.request(), entry = f.human.issue(request, now);
  f.database.exec("CREATE TRIGGER fail_peer_session BEFORE INSERT ON peer_web_sessions BEGIN SELECT RAISE(ABORT, 'fixture session failure'); END");
  assert.throws(() => f.human.consume(browserRequest(entry), now), /fixture session failure/u);
  assert.ok(f.human.preview(browserRequest(entry), now));
  f.database.exec("DROP TRIGGER fail_peer_session");
  const reopened = f.reopen();
  const auth = new AuthService(reopened.database, () => now);
  const human = new PeerHumanEntryService(reopened.database, auth, f.identity);
  assert.deepEqual(human.issue(request, now).credential, entry.credential);
  const session = human.consume(browserRequest(entry), now).session;
  assert.equal(auth.authenticateWebSession(session.secret, now).peerAccess?.membershipId, f.binding.membershipId);
  assert.throws(() => new PeerHumanEntryService(reopened.database, auth, f.identity, "https://moved.example.test").issue(request, now), denied("SCOPE_DENIED"));
  reopened.store.revokeMembership(f.binding.membershipId, now);
  assert.throws(() => auth.authenticateWebSession(session.secret, now), error => error instanceof AuthorizationError);
});

test("Peer browser HTTP entry requires exact origin and installs only scoped cookies", async t => {
  const f = await joined(t), origin = f.identity.browserOrigin;
  const app = await createServerApp({ databasePath: f.databasePath, clock: f.clock,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const post = (url: string, payload: unknown, headers = {}) => app.inject({ method: "POST", url, headers, payload });
  const request = f.request();
  const issue = await post("/api/peer/human-entry", request);
  assert.equal(issue.statusCode, 200, issue.body);
  assert.match(String(issue.headers["cache-control"]), /no-store/u);
  const entry = issue.json();
  const browser = browserRequest(entry);
  for (const headers of [{}, { origin: "https://wrong.example.test" }, { origin, authorization: `Bearer ${f.owner.secret}` }, { origin, "x-forwarded-proto": "http" }]) {
    assert.equal((await post("/api/peer/browser-entry/claim", browser, headers)).statusCode, 403);
  }
  const preview = await post("/api/peer/browser-entry/preview", browser, { origin });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().roomLabel, "Invited");
  const claim = await post("/api/peer/browser-entry/claim", browser, { origin });
  assert.equal(claim.statusCode, 200, claim.body);
  assert.equal(claim.json().session.token, undefined);
  assert.equal(claim.json().user.peerAccess.roomId, roomId);
  const cookie = String(claim.headers["set-cookie"]);
  assert.match(cookie, /; HttpOnly; Secure; SameSite=Strict/u);
  const headers = { cookie: cookie.split(";")[0]! };
  assert.equal((await app.inject({ url: `/api/rooms/${roomId}/messages`, headers })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/teams/${teamId}/members`, headers })).statusCode, 403);
  assert.equal((await post("/api/peer/browser-entry/claim", browser, { origin })).statusCode, 410);
  f.store.revokeMembership(f.binding.membershipId, now);
  assert.equal((await app.inject({ url: `/api/rooms/${roomId}/messages`, headers })).statusCode, 401);
});
