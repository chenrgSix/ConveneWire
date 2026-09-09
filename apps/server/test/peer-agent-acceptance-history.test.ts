import assert from "node:assert/strict";
import test from "node:test";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import type { PeerAgentAcceptanceRecord, RemoteAgentAcceptance } from "@convene-wire/contracts/peer";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { denied, now, ownerMember, teamId } from "./helpers/peer-fixture.js";
import { migrateDatabase } from "../src/data/migration-runner.js";
import { openDatabase } from "../src/data/database.js";
import { migrationVersionsAfter } from "./helpers/migration-frontier.js";

test("Host history orders same-clock decisions across lineages and isolates another Agent's cursor", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  assert.deepEqual(f.service.synchronize(f.token, f.sync(), now).acceptanceHistory, []);
  const first = f.service.accept(f.actor, { ...f.acceptance(), operationId: "op_zzzzfirst001" }, now);
  const second = f.service.accept(f.actor, { ...f.acceptance(), operationId: "op_aaaasecond001",
    capabilities: { ...f.offer.grant.capabilities, supportsStreaming: false },
    expectedAcceptanceId: first.acceptance.acceptanceId, expectedAcceptanceRevision: 1 }, now);
  const revoked = f.service.revoke(f.actor, { schemaVersion: 1, operationId: "op_historyrevoke001",
    acceptanceId: second.acceptance.acceptanceId, expectedRevision: 2 }, now);
  const last = f.service.accept(f.actor, { ...f.acceptance(), operationId: "op_historynew001",
    expectedAcceptanceId: revoked.acceptance.acceptanceId, expectedAcceptanceRevision: 3 }, now);
  assert.notEqual(last.acceptance.acceptanceId, first.acceptance.acceptanceId);
  const receipt = f.service.synchronize(f.token, f.sync(), now);
  assert.deepEqual(receipt.acceptanceHistory.map(r => [r.sequence, r.acceptance.revision, r.acceptance.state]),
    [[1, 1, "active"], [2, 2, "active"], [3, 3, "revoked"], [4, 1, "active"]]);
  assert.ok(receipt.acceptanceHistory.every(r => r.projection.projectionAgentId === first.projection.projectionAgentId));
  assert.equal(receipt.exportHistoryLength, 1);
  // A former Owner operation replay cannot append a new decision or move the head.
  f.service.accept(f.actor, { ...f.acceptance(), operationId: "op_zzzzfirst001" }, now);
  assert.deepEqual(f.service.synchronize(f.token, f.sync(), now).acceptanceHistory, receipt.acceptanceHistory);
  const other = { ...f.offer, grant: { ...f.offer.grant, exportId: "export_otherhistory001", localAgentId: "agent_otherhistory001" } };
  f.service.offer(f.token, f.signed(other), now);
  f.service.accept(f.actor, { ...f.acceptance(other), operationId: "op_otherhistory001" }, now);
  const scoped = f.service.synchronize(f.token, f.sync([other]), now);
  assert.equal(scoped.acceptanceHistory.length, 1); assert.equal(scoped.acceptanceHistory[0]?.sequence, 1);
  assert.ok(scoped.acceptanceHistory.every(r => r.projection.localAgentId === other.grant.localAgentId));
});

test("Acceptance ordering and projection materialization commit atomically and history cannot be rewritten", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  f.database.exec("CREATE TRIGGER test_acceptance_log_failure BEFORE INSERT ON peer_agent_acceptance_log BEGIN SELECT RAISE(ABORT, 'failed history write'); END");
  assert.throws(() => f.service.accept(f.actor, f.acceptance(), now), /failed history write/u);
  assert.equal(f.grants.currentAcceptance(f.offer.grant.peerId, f.offer.grant.localAgentId), undefined);
  assert.deepEqual(f.core.listAgents(teamId), []);
  f.database.exec("DROP TRIGGER test_acceptance_log_failure");
  const accepted = f.service.accept(f.actor, f.acceptance(), now);
  assert.equal(f.service.synchronize(f.token, f.sync(), now).acceptanceHistory[0]?.sequence, 1);
  assert.throws(() => f.database.exec("UPDATE peer_agent_acceptance_log SET sequence = 50"), /immutable/u);
  assert.throws(() => f.database.exec("DELETE FROM peer_agent_acceptance_log"), /retained/u);
  assert.throws(() => f.database.exec(`INSERT INTO peer_agent_acceptance_log SELECT peer_id, local_agent_id, 5,
    owner_member_id, operation_id, acceptance_id, acceptance_revision FROM peer_agent_acceptance_log`), /exact Owner decision/u);
  // Bare persistence cannot fabricate a signed Owner decision history.
  f.grants.recordAcceptance({ ...accepted.acceptance, revision: 2 }, ownerMember, now);
  assert.throws(() => f.service.synchronize(f.token, f.sync(), now), denied("STALE_AUTHORIZATION"));
});

test("version-100 Owner decisions backfill by writer order and preserve all signed projection fields", async t => {
  const f = await peerAgentFixture(t, 100), grant = f.offer.grant;
  f.service.offer(f.token, f.signed(), now);
  const acceptance: RemoteAgentAcceptance = { schemaVersion: 1, acceptanceId: "acceptance_historyupgrade001", revision: 1,
    state: "active", issuedAt: now, expiresAt: grant.expiresAt, exportId: grant.exportId, grantRevision: 1,
    grantDigest: peerDigest(grant), peerId: grant.peerId, participantNodeId: grant.participantNodeId, authorityNodeId: grant.authorityNodeId,
    memberId: f.membership.memberId, teamId, roomIds: grant.roomIds, capabilities: grant.capabilities };
  f.grants.recordAcceptance(acceptance, ownerMember, now);
  const projection: PeerAgentAcceptanceRecord["projection"] = { schemaVersion: 1, projectionAgentId: "agent_historyupgrade001",
    peerId: grant.peerId, authorityNodeId: grant.authorityNodeId, teamId, localAgentId: grant.localAgentId,
    exportId: grant.exportId, acceptanceId: acceptance.acceptanceId, acceptanceRevision: 1,
    displayName: f.offer.displayName, role: f.offer.role, capabilities: grant.capabilities };
  f.database.prepare("INSERT INTO peer_agent_projections VALUES (?, ?, ?, ?)").run(grant.peerId, grant.localAgentId, projection.projectionAgentId, now);
  const result = { acceptance, projection, offerDigest: peerDigest(f.offer) };
  const insert = f.database.prepare("INSERT INTO peer_agent_operations VALUES (?, ?, ?, ?, ?, ?, ?)");
  insert.run(ownerMember, "op_zzzupgrade001", peerDigest(result), acceptance.acceptanceId, 1, JSON.stringify(result), now);
  const withdrawn = { ...acceptance, revision: 2, state: "revoked" as const };
  f.grants.recordAcceptance(withdrawn, ownerMember, now);
  const next = { ...result, acceptance: withdrawn, projection: { ...projection, acceptanceRevision: 2 } };
  insert.run(ownerMember, "op_aaaupgrade001", peerDigest(next), acceptance.acceptanceId, 2, JSON.stringify(next), now);
  f.database.close();
  const migrated = await migrateDatabase(f.databasePath);
  assert.deepEqual(migrated.appliedVersions, migrationVersionsAfter(100));
  const db = openDatabase(f.databasePath); f.resources.defer(() => db.close());
  assert.deepEqual(db.prepare("SELECT sequence, operation_id FROM peer_agent_acceptance_log ORDER BY sequence").all(),
    [{ sequence: 1, operation_id: "op_zzzupgrade001" }, { sequence: 2, operation_id: "op_aaaupgrade001" }]);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});

test("UTF-8 history capacity fences new decisions while preserving revocation and complete delivery", async t => {
  const f = await peerAgentFixture(t);
  f.offer.displayName = "写".repeat(80); f.offer.role = "审".repeat(80);
  f.service.offer(f.token, f.signed(), now);
  let current: RemoteAgentAcceptance | undefined;
  let decisions = 0;
  for (; decisions < 1024; decisions++) {
    const request = { ...f.acceptance(), operationId: `op_boundedhistory${decisions}`,
      expectedAcceptanceId: current?.acceptanceId ?? null, expectedAcceptanceRevision: current?.revision ?? null };
    const size = f.database.prepare("SELECT coalesce(sum(length(CAST(result_json AS BLOB))), 0) AS bytes FROM peer_agent_operations").get() as { bytes: number };
    if (size.bytes >= 256 * 1024) {
      assert.throws(() => f.service.accept(f.actor, request, now), denied("SCOPE_DENIED")); break;
    }
    current = f.service.accept(f.actor, request, now).acceptance;
  }
  assert.ok(current && decisions > 1 && decisions < 1024);
  f.service.revoke(f.actor, { schemaVersion: 1, operationId: "op_boundedrevoke001",
    acceptanceId: current.acceptanceId, expectedRevision: current.revision }, now);
  const history = f.service.synchronize(f.token, f.sync(), now).acceptanceHistory;
  assert.equal(history.length, decisions + 1);
  assert.equal(history.at(-1)?.acceptance.state, "revoked");
  assert.deepEqual(history.map(r => r.sequence), Array.from({ length: decisions + 1 }, (_, i) => i + 1));
});
