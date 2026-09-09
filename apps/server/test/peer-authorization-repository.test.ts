import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import type { AgentExportGrant, RemoteAgentAcceptance } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { PeerAuthorizationRepository } from "../src/data/peer-authorization-repository.js";
import { peerSecretHash } from "../src/data/peer-membership-repository.js";
import { backupDatabase } from "../src/data/backup.js";
import { openDatabase } from "../src/data/database.js";
import { fixture, now, expiry, ownerMember, teamId, roomId, otherRoomId, denied } from "./helpers/peer-fixture.js";

async function granted(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t), i = f.invite();
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const member = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  const grant: AgentExportGrant = { schemaVersion: 1, exportId: "export_fixture0001", peerId: member.peerId,
    participantNodeId: member.participantNodeId, authorityNodeId: member.hostNodeId, teamId, localAgentId: "agent_localfixture1",
    roomIds: [roomId], capabilities: { supportsStart: true, supportsInterrupt: true, supportsResume: false, supportsStreaming: true,
      supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false }, revision: 1, state: "active", issuedAt: now, expiresAt: expiry };
  const acceptance: RemoteAgentAcceptance = { schemaVersion: 1, acceptanceId: "acceptance_fixture1", peerId: member.peerId,
    authorityNodeId: member.hostNodeId, participantNodeId: member.participantNodeId, teamId, memberId: member.memberId,
    exportId: grant.exportId, grantRevision: grant.revision, grantDigest: peerDigest(grant), roomIds: [roomId], capabilities: grant.capabilities,
    revision: 1, state: "active", issuedAt: now, expiresAt: expiry };
  return { ...f, member, grant, acceptance, grants: new PeerAuthorizationRepository(f.database) };
}

test("Peer Export and Acceptance form an exact bilateral current revision intersection", async (t) => {
  const f = await granted(t), { grants, grant, acceptance } = f;
  grants.recordVerifiedExport(grant, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("REVOKED"));
  assert.throws(() => grants.recordAcceptance(acceptance, f.member.memberId, now), denied("SCOPE_DENIED"));
  grants.recordAcceptance(acceptance, ownerMember, now);
  assert.equal(grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now).grant.digest, acceptance.grantDigest);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, otherRoomId, now), denied("SCOPE_DENIED"));
  const revised = { ...grant, revision: 2, capabilities: { ...grant.capabilities, supportsStreaming: false } };
  grants.recordVerifiedExport(revised, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("STALE_AUTHORIZATION"));
  const next = { ...acceptance, revision: 2, grantRevision: 2, grantDigest: peerDigest(revised) };
  assert.throws(() => grants.recordAcceptance(next, ownerMember, now), denied("SCOPE_DENIED"));
  assert.equal(grants.getAcceptance(acceptance.acceptanceId)?.value.revision, 1);
  grants.recordAcceptance({ ...next, capabilities: revised.capabilities }, ownerMember, now);
  assert.equal(grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now).acceptance.value.revision, 2);
  assert.throws(() => grants.recordVerifiedExport({ ...revised, revision: 4 }, now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => grants.recordVerifiedExport({ ...revised, localAgentId: "agent_replaced001", revision: 3 }, now), denied("PAYLOAD_CONFLICT"));
});

test("Peer replay acknowledges history without reviving revoked IDs or retired publication", async (t) => {
  const { grants, grant, acceptance, database } = await granted(t);
  grants.recordVerifiedExport(grant, now); grants.recordAcceptance(acceptance, ownerMember, now);
  const revoked = { ...acceptance, revision: 2, state: "revoked" as const };
  grants.recordAcceptance(revoked, ownerMember, now);
  grants.recordAcceptance(acceptance, ownerMember, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("REVOKED"));
  assert.throws(() => grants.recordAcceptance({ ...acceptance, revision: 3 }, ownerMember, now), denied("REVOKED"));
  const freshExport = { ...grant, exportId: "export_replaced001" };
  grants.recordVerifiedExport(freshExport, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("REVOKED"));
  grants.recordVerifiedExport(grant, now);
  assert.equal(grants.currentExport(grant.peerId, grant.localAgentId)?.value.exportId, freshExport.exportId);
  assert.throws(() => grants.recordVerifiedExport({ ...grant, revision: 2 }, now), denied("REVOKED"));
  assert.throws(() => database.prepare("UPDATE peer_export_heads SET export_id = ?").run(grant.exportId), /retired authority/u);
  const freshAcceptance = { ...acceptance, acceptanceId: "acceptance_fresh001", exportId: freshExport.exportId, grantDigest: peerDigest(freshExport) };
  grants.recordAcceptance(freshAcceptance, ownerMember, now);
  assert.equal(grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now).acceptance.value.acceptanceId, freshAcceptance.acceptanceId);
  grants.recordVerifiedExport({ ...freshExport, revision: 2, state: "revoked" }, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("REVOKED"));
  assert.throws(() => grants.recordVerifiedExport({ ...freshExport, revision: 3 }, now), denied("REVOKED"));
  assert.throws(() => grants.recordVerifiedExport({ ...freshExport, capabilities: { ...grant.capabilities, supportsResume: true } }, now), denied("PAYLOAD_CONFLICT"));
  for (const table of ["peer_export_revisions", "peer_acceptance_revisions"]) {
    assert.throws(() => database.prepare(`UPDATE ${table} SET digest = ?`).run("a".repeat(64)), /immutable/u);
    assert.throws(() => database.prepare(`DELETE FROM ${table}`).run(), /cannot be deleted/u);
  }
});

test("Peer authorization rejects wider rooms, capabilities, identities and stale grants", async (t) => {
  const f = await granted(t), { grants, grant, acceptance } = f;
  for (const changed of [{ ...grant, roomIds: [roomId, otherRoomId] }, { ...grant, authorityNodeId: "node_forged000001" },
    { ...grant, participantNodeId: "node_forged000001" }, { ...grant, teamId: "team_forged000001" },
    { ...grant, expiresAt: "2027-01-01T00:00:00.000Z" }]) {
    assert.throws(() => grants.recordVerifiedExport(changed, now), denied("SCOPE_DENIED"));
    assert.equal(grants.getExport(grant.exportId), undefined);
  }
  grants.recordVerifiedExport(grant, now);
  assert.throws(() => grants.recordAcceptance({ ...acceptance, grantDigest: "a".repeat(64) }, ownerMember, now), denied("PAYLOAD_CONFLICT"));
  assert.throws(() => grants.recordAcceptance({ ...acceptance, capabilities: { ...acceptance.capabilities, supportsOwnerPrivateOutput: true } }, ownerMember, now), denied("SCOPE_DENIED"));
  assert.throws(() => grants.recordAcceptance({ ...acceptance, roomIds: [otherRoomId] }, ownerMember, now), denied("SCOPE_DENIED"));
  assert.throws(() => grants.recordAcceptance({ ...acceptance, memberId: ownerMember }, ownerMember, now), denied("SCOPE_DENIED"));
  grants.recordAcceptance(acceptance, ownerMember, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, expiry), denied("EXPIRED"));
  f.store.revokeMembership(f.member.membershipId, now);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("REVOKED"));
  // Revocation evidence can still be retained after business membership expires.
  grants.recordVerifiedExport({ ...grant, revision: 2, state: "revoked", issuedAt: expiry }, expiry);
  grants.recordAcceptance({ ...acceptance, revision: 2, state: "revoked", issuedAt: expiry }, ownerMember, expiry);
});

test("Peer authorization rolls back retirement and preserves exact revisions after backup", async (t) => {
  const f = await granted(t), { grant, acceptance } = f;
  f.grants.recordVerifiedExport(grant, now); f.grants.recordAcceptance(acceptance, ownerMember, now);
  f.database.exec("CREATE TRIGGER test_export_failure BEFORE INSERT ON peer_export_revisions WHEN NEW.export_id = 'export_replacement01' BEGIN SELECT RAISE(ABORT, 'test interrupted'); END");
  assert.throws(() => f.grants.recordVerifiedExport({ ...grant, exportId: "export_replacement01" }, now), /test interrupted/u);
  assert.equal(f.grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now).grant.value.exportId, grant.exportId);
  assert.equal(f.database.prepare("SELECT * FROM peer_export_lineages WHERE export_id = 'export_replacement01'").get(), undefined);
  f.database.exec("DROP TRIGGER test_export_failure");
  const reopened = f.reopen();
  assert.equal(new PeerAuthorizationRepository(reopened.database).requireEffective(grant.peerId, grant.localAgentId, roomId, now).grant.digest, acceptance.grantDigest);
  reopened.database.close();
  const copy = path.join(f.resources.directory, "authorization.sqlite"); await backupDatabase(f.databasePath, copy);
  const restored = openDatabase(copy); f.resources.defer(() => restored.close());
  const recovered = new PeerAuthorizationRepository(restored);
  assert.deepEqual(recovered.getExport(grant.exportId), { value: grant, digest: peerDigest(grant) });
  assert.equal(recovered.requireEffective(grant.peerId, grant.localAgentId, roomId, now).acceptance.digest, peerDigest(acceptance));
  assert.equal(restored.pragma("foreign_key_check").length, 0);
});

test("Peer execution intersects the requested Room when another Room ACL is removed", async (t) => {
  const f = await fixture(t), i = f.invite("00000010", { kind: "team", teamId, roomId: null });
  f.store.createInvitation(i.invitation, ownerMember, peerSecretHash(i.inviteSecret), now);
  const member = f.store.claimVerifiedInvitation(i.claim, i.machine, now);
  const grant: AgentExportGrant = { schemaVersion: 1, exportId: "export_multiscoped1", peerId: member.peerId,
    participantNodeId: member.participantNodeId, authorityNodeId: member.hostNodeId, teamId, localAgentId: "agent_localfixture1",
    roomIds: [roomId, otherRoomId], capabilities: { supportsStart: true, supportsInterrupt: true, supportsResume: false, supportsStreaming: true,
      supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false }, revision: 1, state: "active", issuedAt: now, expiresAt: expiry };
  const acceptance: RemoteAgentAcceptance = { schemaVersion: 1, acceptanceId: "acceptance_multiscope1", peerId: member.peerId,
    authorityNodeId: member.hostNodeId, participantNodeId: member.participantNodeId, teamId, memberId: member.memberId,
    exportId: grant.exportId, grantRevision: 1, grantDigest: peerDigest(grant), roomIds: grant.roomIds, capabilities: grant.capabilities,
    revision: 1, state: "active", issuedAt: now, expiresAt: expiry };
  const grants = new PeerAuthorizationRepository(f.database);
  grants.recordVerifiedExport(grant, now); grants.recordAcceptance(acceptance, ownerMember, now);
  f.database.prepare("DELETE FROM room_human_participants WHERE room_id = ? AND member_id = ?").run(roomId, member.memberId);
  assert.throws(() => grants.requireEffective(grant.peerId, grant.localAgentId, roomId, now), denied("SCOPE_DENIED"));
  assert.equal(grants.requireEffective(grant.peerId, grant.localAgentId, otherRoomId, now).membership.memberId, member.memberId);
});
