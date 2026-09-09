import assert from "node:assert/strict";
import { readFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { openDatabase } from "../src/data/database.js";
import { defaultMigrationsDirectory, migrateDatabase } from "../src/data/migration-runner.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { backupDatabase } from "../src/data/backup.js";
import { PeerMembershipRepository, peerSecretHash, peerClaimDigest } from "../src/data/peer-membership-repository.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { AuthService } from "../src/security/auth-service.js";

import { fixture, now, expiry, ownerId, ownerMember, teamId, roomId, otherRoomId, secret, denied } from "./helpers/peer-fixture.js";

test("Peer claim commits one scoped Host identity and rolls back every partial row", async (t) => {
  const f = await fixture(t), i = f.invite();
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const counts = () => ["web_users", "team_members", "peer_bindings", "peer_memberships", "peer_credentials"].map(table =>
    (f.database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
  const before = counts();
  f.database.exec("CREATE TRIGGER test_peer_failure BEFORE INSERT ON peer_credentials BEGIN SELECT RAISE(ABORT, 'test interruption'); END");
  assert.throws(() => f.store.claimVerifiedInvitation(i.claim, i.machine, now), /test interruption/u);
  assert.deepEqual(counts(), before);
  assert.equal(f.store.getInvitation(i.invitation.invitationId)?.state, "open");
  f.database.exec("DROP TRIGGER test_peer_failure");
  const member = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  assert.ok(validatePeer("PeerMembership", member));
  assert.notEqual(member.userId, ownerId);
  assert.notEqual(member.memberId, ownerMember);
  assert.equal(member.localUserId, ownerId);
  assert.deepEqual(f.core.listRoomsForMember(teamId, member.memberId).map(x => x.roomId), [roomId]);
  const after = counts();
  const renewal = { ...i.claim, challengeId: "peerchallenge_fresh0001", proof: { ...i.claim.proof, payload: { ...i.claim.proof.payload, nonce: secret() } } };
  assert.equal(peerClaimDigest(renewal), peerClaimDigest(i.claim));
  assert.deepEqual(f.store.claimVerifiedInvitation(renewal, i.machine, "2026-09-10T04:00:00.000Z"), member);
  assert.deepEqual(counts(), after);
  for (const changed of [
    { ...i.claim, displayName: "Different" }, { ...i.claim, operationId: "op_different001" },
    { ...i.claim, localUserId: "user_different001" }, { ...i.claim, participant: { ...i.claim.participant, publicKey: secret() } },
    { ...i.claim, invitationDigest: "a".repeat(64) }
  ]) assert.throws(() => f.store.claimVerifiedInvitation(changed, i.machine, now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => f.store.claimVerifiedInvitation({ ...i.claim, secret: secret() }, i.machine, now), denied("UNAUTHENTICATED"));
  assert.deepEqual(counts(), after);
});

test("Peer revoke, credential verifiers and bindings survive reopen and stopped backup", async (t) => {
  const f = await fixture(t), i = f.invite();
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const membership = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  let { database, store } = f.reopen();
  assert.deepEqual(store.claimVerifiedInvitation(i.claim, i.machine, now), membership);
  store.revokeInvitation(i.invitation.invitationId, now);
  store.revokeInvitation(i.invitation.invitationId, now);
  assert.equal(store.getMembership(membership.membershipId)?.revision, 2);
  assert.equal(store.getCredential(i.machine.credentialId)?.revokedAt, now);
  assert.throws(() => store.claimVerifiedInvitation(i.claim, i.machine, now), denied("REVOKED"));
  assert.throws(() => database.prepare("UPDATE peer_memberships SET state = 'active', revision = 3").run(), /regain authority/u);
  assert.throws(() => database.prepare("DELETE FROM peer_memberships").run(), /cannot be deleted/u);
  assert.throws(() => database.prepare("UPDATE peer_bindings SET participant_public_key = ?").run(secret()), /immutable/u);
  assert.throws(() => database.prepare("UPDATE peer_credentials SET revoked_at = NULL").run(), /regain authority/u);
  database.close();
  const backup = path.join(f.resources.directory, "snapshot.sqlite");
  await backupDatabase(f.databasePath, backup);
  const restored = openDatabase(backup); f.resources.defer(() => restored.close());
  const recovered = new PeerMembershipRepository(restored);
  assert.equal(recovered.getMembership(membership.membershipId)?.state, "revoked");
  assert.throws(() => recovered.claimVerifiedInvitation(i.claim, i.machine, now), denied("REVOKED"));
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  const bytes = await readFile(backup);
  assert.equal(bytes.includes(Buffer.from(i.inviteSecret)), false);
  assert.equal(bytes.includes(Buffer.from(i.machineToken)), false);
  assert.equal(restored.pragma("foreign_key_check").length, 0);
});

test("Peer Room ceilings cannot widen through rosters, credentials or a second membership", async (t) => {
  const f = await fixture(t), i = f.invite();
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const member = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  assert.throws(() => f.database.prepare("UPDATE team_members SET role = 'owner' WHERE member_id = ?").run(member.memberId), /ceiling is immutable/u);
  assert.throws(() => f.database.prepare("INSERT INTO room_human_participants VALUES (?, ?, ?)").run(otherRoomId, member.memberId, now), /ceiling denied/u);
  assert.throws(() => f.database.prepare("UPDATE room_human_participants SET room_id = ? WHERE member_id = ?").run(otherRoomId, member.memberId), /ceiling denied/u);
  assert.throws(() => f.core.createMember({ memberId: "member_promoted0001", teamId, userId: member.userId, displayName: "Same", role: "owner", createdAt: now }), /separately authorized/u);
  const human = { credentialId: "peerhuman_fixture0001", tokenHash: peerSecretHash(secret()), expiresAt: expiry };
  assert.throws(() => f.store.issueCredential(member.membershipId, "peer.human", human, { kind: "team", teamId, roomId: null }, now), denied("SCOPE_DENIED"));
  f.store.issueCredential(member.membershipId, "peer.human", human, member.scope, now);
  f.core.createRoom({ roomId: "room_future000001", teamId, name: "Future", createdAt: now });
  assert.deepEqual(f.core.listRoomsForMember(teamId, member.memberId).map(x => x.roomId), [roomId]);
  const session = new AuthService(f.database).issueWebSession(member.userId, now, expiry);
  assert.throws(() => f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(session.id, i.machine.credentialId), /binding denied/u);
  assert.throws(() => f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(session.id, human.credentialId), /binding denied/u);
  f.database.prepare("UPDATE peer_credentials SET consumed_at = ? WHERE credential_id = ?").run(now, human.credentialId);
  f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(session.id, human.credentialId);
  const duplicate = new AuthService(f.database).issueWebSession(member.userId, now, expiry);
  assert.throws(() => f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(duplicate.id, human.credentialId), /UNIQUE/u);
  assert.deepEqual(f.database.prepare("SELECT peer_access_required AS required FROM web_sessions WHERE session_id = ?").get(session.id), { required: 1 });
  assert.throws(() => f.database.prepare("UPDATE web_sessions SET peer_access_required = 0 WHERE session_id = ?").run(session.id), /marker is immutable/u);
  f.store.revokeMembership(member.membershipId, now);
  f.core.createRoom({ roomId: "room_postrevoke001", teamId, name: "After revoke", createdAt: now });
  assert.deepEqual(f.core.listRoomsForMember(teamId, member.memberId), []);
});

test("Peer Team admission remains explicit and invitation expiry cannot be extended", async (t) => {
  const f = await fixture(t), i = f.invite("00000002", { kind: "team", teamId, roomId: null });
  assert.throws(() => f.store.createInvitation({ ...i.invitation, expiresAt: "2026-09-12T02:00:00.000Z" }, ownerMember, peerSecretHash(i.inviteSecret), now), denied("INVALID_MESSAGE"));
  assert.throws(() => f.store.createInvitation({ ...i.invitation, host: { ...i.invitation.host, publicKey: secret() } }, ownerMember, peerSecretHash(i.inviteSecret), now), denied("SCOPE_DENIED"));
  assert.throws(() => f.store.createInvitation(i.invitation, "member_unknown001", peerSecretHash(i.inviteSecret), now), denied("SCOPE_DENIED"));
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  assert.throws(() => f.store.claimVerifiedInvitation(i.claim, i.machine, i.invitation.expiresAt), denied("EXPIRED"));
  const member = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  f.core.createRoom({ roomId: "room_teamfuture001", teamId, name: "Team future", createdAt: now });
  assert.equal(f.core.listRoomsForMember(teamId, member.memberId).length, 3);
  assert.throws(() => f.store.requireActiveMembership(member.membershipId, expiry), denied("EXPIRED"));
  f.core.createRoom({ roomId: "room_afterexpiry01", teamId, name: "Expired future", createdAt: expiry });
  assert.equal(f.core.isRoomMember("room_afterexpiry01", member.memberId), false);
  const second = f.invite("00000003");
  f.store.createInvitation(second.invitation, ownerMember, peerSecretHash(second.inviteSecret), now);
  const newMember = f.store.claimVerifiedInvitation(second.claim, second.machine, now);
  assert.notEqual(newMember.userId, member.userId);
  assert.notEqual(newMember.peerId, member.peerId);
  assert.equal(newMember.scope.kind, "room");
});

test("migration 0095 preserves the previous Authority identity and ordinary human session", async (t) => {
  const resources = await createTestResources(t, "convenewire-peer-upgrade-");
  const previous = path.join(resources.directory, "migrations"); await mkdir(previous);
  for (const name of await readdir(defaultMigrationsDirectory)) {
    if (/^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 94) await copyFile(path.join(defaultMigrationsDirectory, name), path.join(previous, name));
  }
  const databasePath = path.join(resources.directory, "previous.sqlite");
  await migrateDatabase(databasePath, previous);
  const database = openDatabase(databasePath); resources.defer(() => database.close());
  const authority = new AuthorityService(database, "https://host.example.test");
  new CoreRepository(database).createUser({ userId: ownerId, displayName: "Legacy Owner", createdAt: now });
  const credential = new AuthService(database).issueWebSession(ownerId, now, expiry);
  const identityBefore = database.prepare("SELECT * FROM authority_identity").get();
  const sessionBefore = database.prepare("SELECT * FROM web_sessions").get() as Record<string, unknown>;
  const result = await migrateDatabase(databasePath);
  assert.deepEqual(result.appliedVersions, [95, 96]);
  assert.deepEqual(database.prepare("SELECT * FROM authority_identity").get(), identityBefore);
  assert.deepEqual(database.prepare("SELECT * FROM web_sessions").get(), { ...sessionBefore, peer_access_required: 0 });
  assert.equal(new AuthorityService(database, authority.browserOrigin).publicKey, authority.publicKey);
  assert.equal(new AuthService(database).authenticateWebSession(credential.secret, now).userId, ownerId);
});
