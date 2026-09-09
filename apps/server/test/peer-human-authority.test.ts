import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createServerApp } from "../src/app.js";
import { AuthService, AuthorizationError } from "../src/security/auth-service.js";
import { peerSecretHash } from "../src/data/peer-membership-repository.js";
import { TeamRoomService } from "../src/team-room/team-room-service.js";
import { fixture, now, expiry, ownerId, ownerMember, teamId, roomId, otherRoomId, secret } from "./helpers/peer-fixture.js";

const denied = (error: unknown) => error instanceof AuthorizationError;
async function human(t: TestContext, teamMembership = false, roomCredential = true) {
  const f = await fixture(t);
  const i = f.invite("humanfixture01", teamMembership ? { kind: "team", teamId, roomId: null } : { kind: "room", teamId, roomId });
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const membership = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  let current = now;
  const auth = new AuthService(f.database, () => current);
  const credential = { credentialId: "peerhuman_session001", tokenHash: peerSecretHash(secret()), expiresAt: expiry };
  f.store.issueCredential(membership.membershipId, "peer.human", credential,
    roomCredential ? { kind: "room", teamId, roomId } : membership.scope, now);
  const session = auth.issueWebSession(membership.userId, now, expiry);
  f.database.transaction(() => {
    f.database.prepare("UPDATE peer_credentials SET consumed_at = ? WHERE credential_id = ?").run(now, credential.credentialId);
    f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(session.id, credential.credentialId);
  }).immediate();
  return { ...f, i, membership, auth, session, credential, clock: () => current, setClock: (value: string) => { current = value; } };
}

test("Peer human session intersects durable membership and credential ceilings across full logins", async (t) => {
  const f = await human(t, true);
  const actor = f.auth.authenticateWebSession(f.session.secret, now);
  assert.equal(actor.peerAccess?.kind, "room");
  assert.equal(f.auth.requireRoomMember(actor, roomId).memberId, f.membership.memberId);
  assert.throws(() => f.auth.requireRoomMember(actor, otherRoomId), denied);
  assert.throws(() => f.auth.requireTeamMember(actor, teamId), denied);
  assert.throws(() => f.auth.requireFullWebSession(actor), denied);
  const rooms = new TeamRoomService(f.core, f.auth).listRooms(actor, teamId);
  assert.deepEqual(rooms.map(room => room.roomId), [roomId]);
  const full = f.auth.issueWebSession(f.membership.userId, now, expiry);
  assert.throws(() => f.auth.authenticateWebSession(full.secret, now), denied);
  assert.throws(() => f.auth.requireRoomMember({ userId: f.membership.userId, sessionId: full.id }, otherRoomId), denied);
  assert.throws(() => f.auth.requireFullWebSession({ userId: f.membership.userId, sessionId: full.id }), denied);
  assert.throws(() => f.auth.authenticateWebSession(f.i.machineToken, now), denied);
  assert.throws(() => f.auth.authenticateDevice(f.session.secret, now), denied);
  f.database.prepare("DELETE FROM peer_web_sessions WHERE session_id = ?").run(f.session.id);
  assert.throws(() => f.auth.authenticateWebSession(f.session.secret, now), denied);
  assert.throws(() => f.auth.requireRoomMember(actor, roomId), denied);
});

test("Peer captured principals recheck credential expiry and membership revocation", async (t) => {
  const f = await human(t);
  const actor = f.auth.authenticateWebSession(f.session.secret, now);
  f.setClock(expiry);
  assert.throws(() => f.auth.requireRoomMember(actor, roomId), denied);
  f.setClock(now);
  f.store.revokeMembership(f.membership.membershipId, now);
  assert.throws(() => f.auth.authenticateWebSession(f.session.secret, now), denied);
  assert.throws(() => f.auth.requireRoomMember(actor, roomId), denied);
  assert.throws(() => f.auth.requireTeamMember(actor, teamId, { allowRoomScope: true }), denied);
});

test("Peer Room sessions cannot read Team lists, counts, search, changes or foreign Room metadata", async (t) => {
  const f = await human(t, true);
  const app = await createServerApp({ databasePath: f.databasePath, clock: f.clock }); f.resources.defer(() => app.close());
  const headers = { authorization: `Bearer ${f.session.secret}` };
  const session = await app.inject({ url: "/api/auth/session", headers });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().user.peerAccess.roomId, roomId);
  assert.equal(session.json().user.canManageOwnerRecovery, false);
  const rooms = await app.inject({ url: `/api/teams/${teamId}/rooms`, headers });
  assert.equal(rooms.statusCode, 200, rooms.body);
  assert.deepEqual(rooms.json().map((room: { roomId: string }) => room.roomId), [roomId]);
  assert.equal((await app.inject({ url: `/api/rooms/${roomId}/messages`, headers })).statusCode, 200);
  for (const url of [
    `/api/teams/${teamId}/members`, `/api/teams/${teamId}/agents`, `/api/teams/${teamId}/devices`,
    `/api/teams/${teamId}/work-items?search=Excluded`, `/api/teams/${teamId}/changes?after=0`,
    `/api/rooms/${otherRoomId}/messages`, `/api/rooms/${otherRoomId}/settings`, `/api/rooms/${otherRoomId}/participants`, "/api/authority"
  ]) {
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    assert.equal(response.body.includes("Excluded"), false);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/teams", headers, payload: { name: "Promoted Team" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: `/api/teams/${teamId}/rooms`, headers, payload: { name: "Promoted Room" } })).statusCode, 403);
  f.store.revokeMembership(f.membership.membershipId, now);
  assert.equal((await app.inject({ url: `/api/rooms/${roomId}/messages`, headers })).statusCode, 401);
});

test("a Peer Team change wait cannot disclose hints after its human membership is revoked", async (t) => {
  const f = await human(t, true, false);
  const app = await createServerApp({ databasePath: f.databasePath, clock: f.clock }); f.resources.defer(() => app.close());
  const owner = f.auth.issueWebSession(ownerId, now, expiry);
  const publish = () => app.inject({ method: "POST", url: `/api/rooms/${roomId}/messages`, headers: { authorization: `Bearer ${owner.secret}` }, payload: { content: "Local fixture update", mentions: [] } });
  assert.equal((await publish()).statusCode, 200);
  const headers = { authorization: `Bearer ${f.session.secret}` };
  const initial = await app.inject({ url: `/api/teams/${teamId}/changes?after=0`, headers });
  assert.equal(initial.statusCode, 200, initial.body);
  const cursor = initial.json().cursor;
  assert.ok(Number.isSafeInteger(cursor), initial.body);
  const pending = app.inject({ url: `/api/teams/${teamId}/changes?after=${cursor}`, headers });
  await new Promise(resolve => setImmediate(resolve));
  f.store.revokeMembership(f.membership.membershipId, now);
  await publish();
  const result = await pending;
  assert.equal(result.statusCode, 401, result.body);
});
