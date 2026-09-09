import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import type { RemoteAgentAcceptance } from "@convene-wire/contracts/peer";
import { AgentService } from "../src/registry/agent-service.js";
import { AuthorizationError } from "../src/security/auth-service.js";
import { openDatabase } from "../src/data/database.js";
import { defaultMigrationsDirectory, migrateDatabase } from "../src/data/migration-runner.js";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { now, expiry, ownerMember, teamId, roomId, otherRoomId } from "./helpers/peer-fixture.js";
import { InProcessRunExecutor } from "../src/runtime/in-process-run-executor.js";
import { RunRepository } from "../src/run/run-repository.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";
import { MessageService } from "../src/team-room/message-service.js";
import { RunService } from "../src/run/run-service.js";
import { ContextPlanner } from "../src/task/context-planner.js";
import { migrationVersionsAfter } from "./helpers/migration-frontier.js";

test("accepted Peer projections retain separate identity and cannot use Device/manual publication", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  assert.equal(f.core.listAgents(teamId).length, 0);
  const result = f.service.accept(f.actor, f.acceptance(), now), id = result.projection.projectionAgentId;
  const agent = f.core.getAgent(id)!;
  assert.equal(agent.integrationMode, "peer"); assert.equal(agent.deviceId, null); assert.equal(agent.runtimePolicy, null);
  assert.equal(agent.ownerMemberId, f.membership.memberId); assert.equal(agent.enabled, true); assert.equal(agent.presence, "offline");
  assert.equal(agent.capabilities.supportsHandoff, false); assert.equal(agent.capabilities.ownerPrivateOutput, false);
  assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, [id]);
  assert.deepEqual(f.core.getRoomParticipants(otherRoomId).agentIds, []);
  assert.throws(() => f.core.createAgent({ ...agent, agentId: "agent_inventedpeer001" }), /bilateral/u);
  assert.throws(() => f.core.updateAgentPublication({ ...agent, integrationMode: "managed" }), /verified offer/u);
  assert.throws(() => f.core.setAgentEnabled(id, false, now), /Peer acceptance/u);
  assert.throws(() => new AgentService(f.core, f.auth).setEnabled(f.actor, id, true, now), /Peer acceptance/u);
  assert.throws(() => f.database.prepare("UPDATE agents SET integration_mode = 'manual' WHERE agent_id = ?").run(id), /reinterpreted/u);
  assert.throws(() => f.database.prepare("UPDATE agents SET owner_member_id = ? WHERE agent_id = ?").run(ownerMember, id), /reinterpreted/u);
  assert.throws(() => f.database.prepare("DELETE FROM agents WHERE agent_id = ?").run(id), /retained/u);
  assert.throws(() => f.auth.issueMcpCredential(f.actor, id, now), error => error instanceof AuthorizationError);
  assert.throws(() => f.database.prepare("INSERT INTO mcp_credentials (credential_id, agent_id, member_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("mcpcred_forgedpeer001", id, f.membership.memberId, "a".repeat(64), now), /manual MCP/u);
  const newRoom = "room_createdafter001";
  f.core.createRoom({ roomId: newRoom, teamId, name: "Created later", createdAt: now });
  assert.deepEqual(f.core.getRoomParticipants(newRoom).agentIds, []);
  assert.throws(() => f.database.prepare("INSERT INTO room_agent_participants (room_id, agent_id, added_at) VALUES (?, ?, ?)").run(otherRoomId, id, now), /bilateral/u);
  assert.throws(() => f.database.prepare("UPDATE room_agent_participants SET room_id = ? WHERE agent_id = ?").run(otherRoomId, id), /reinserted/u);
  assert.equal(f.database.prepare("SELECT * FROM peer_agent_room_authority WHERE projection_agent_id = ? AND valid_until > ?").all(id, expiry).length, 0);
  f.database.prepare("UPDATE teams SET archived_at = ? WHERE team_id = ?").run(now, teamId);
  assert.equal(f.database.prepare("SELECT * FROM peer_agent_room_authority WHERE projection_agent_id = ?").all(id).length, 0);
  assert.deepEqual(f.database.pragma("foreign_key_check"), []);
});

test("changed offers and revoked acceptance disable projections and old retries cannot restore Room participation", async t => {
  const f = await peerAgentFixture(t), initial = f.acceptance();
  f.service.offer(f.token, f.signed(), now);
  const first = f.service.accept(f.actor, initial, now), id = first.projection.projectionAgentId;
  const changed = { ...f.offer, displayName: "Revised name", grant: { ...f.offer.grant, revision: 2 } };
  f.service.offer(f.token, f.signed(changed), now);
  assert.equal(f.core.getAgent(id)?.enabled, false); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
  assert.equal(f.core.getAgent(id)?.name, f.offer.displayName, "unaccepted metadata changed visible identity");
  f.service.accept(f.actor, initial, now); f.service.offer(f.token, f.signed(), now);
  assert.equal(f.core.getAgent(id)?.enabled, false); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
  const input = { ...f.acceptance(changed), operationId: "op_projectagain001", expectedAcceptanceId: first.acceptance.acceptanceId, expectedAcceptanceRevision: 1 };
  const second = f.service.accept(f.actor, input, now);
  assert.equal(second.projection.projectionAgentId, id); assert.equal(f.core.getAgent(id)?.name, changed.displayName);
  assert.equal(f.core.getAgent(id)?.enabled, true); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, [id]);
  f.service.revoke(f.actor, { schemaVersion: 1, operationId: "op_projectrevoke001", acceptanceId: second.acceptance.acceptanceId, expectedRevision: 2 }, now);
  f.service.accept(f.actor, input, now);
  assert.equal(f.core.getAgent(id)?.enabled, false); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
});

test("Peer human Room removal and membership revocation also remove projected Room access", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now), id = accepted.projection.projectionAgentId;
  f.database.prepare("DELETE FROM room_human_participants WHERE room_id = ? AND member_id = ?").run(roomId, f.membership.memberId);
  assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
  assert.throws(() => f.database.prepare("INSERT INTO room_agent_participants (room_id, agent_id, added_at) VALUES (?, ?, ?)").run(roomId, id, now), /bilateral/u);
  f.database.prepare("INSERT INTO room_human_participants (room_id, member_id, added_at) VALUES (?, ?, ?)").run(roomId, f.membership.memberId, now);
  assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, [], "restored human membership implicitly restored Agent participation");
  f.database.prepare("INSERT INTO room_agent_participants (room_id, agent_id, added_at) VALUES (?, ?, ?)").run(roomId, id, now);
  f.store.revokeMembership(f.membership.membershipId, now);
  assert.equal(f.core.getAgent(id)?.enabled, false); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
});

test("Peer Run cannot fall through to an in-process fake executor", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now), id = accepted.projection.projectionAgentId;
  const messages = new MessageService(f.core, f.auth), repository = new RunRepository(f.database), tasks = new AgentTaskRepository(f.database);
  const runs = new RunService(f.core, repository, f.auth, tasks);
  const message = messages.createMemberMessage(f.actor, { roomId, content: "Review", mentions: [{ targetType: "agent", targetAgentId: id, displayLabel: "Local writer" }], now });
  const run = runs.createRunsForMessage(f.actor, message.messageId, now)[0]!;
  const executor = new InProcessRunExecutor(f.core, repository, new ContextPlanner(f.database, f.core, tasks), () => now);
  assert.throws(() => executor.prepare(run.runId), /Participant executor/u);
  let invoked = false;
  const adapter = { async *execute() { invoked = true; } };
  await executor.execute(run.runId, adapter);
  assert.equal(invoked, false);
  assert.equal(repository.getRun(run.runId)?.state, "outcome_unknown");
});

test("version-99 projections upgrade without identity reassignment and a failed rebuild rolls back", async t => {
  const f = await peerAgentFixture(t, 99), { grant } = f.offer;
  f.service.offer(f.token, f.signed(), now);
  const acceptance: RemoteAgentAcceptance = { schemaVersion: 1, acceptanceId: "acceptance_upgrade001", revision: 1,
    state: "active", issuedAt: now, expiresAt: grant.expiresAt, exportId: grant.exportId, grantRevision: 1,
    grantDigest: peerDigest(grant), peerId: grant.peerId, participantNodeId: grant.participantNodeId, authorityNodeId: grant.authorityNodeId,
    memberId: f.membership.memberId, teamId, roomIds: grant.roomIds, capabilities: grant.capabilities };
  f.grants.recordAcceptance(acceptance, ownerMember, now);
  const id = "agent_upgradeprojection001";
  f.database.prepare("INSERT INTO peer_agent_projections (peer_id, local_agent_id, projection_agent_id, created_at) VALUES (?, ?, ?, ?)").run(grant.peerId, grant.localAgentId, id, now);
  const snapshot = f.database.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all();
  f.database.close();
  const name = "0100_peer_agents.sql", sql = await readFile(path.join(defaultMigrationsDirectory, name), "utf8");
  const migrationDirectory = path.join(f.resources.directory, "migrations");
  await writeFile(path.join(migrationDirectory, name), sql + "\nSELECT deliberately_fail_peer_projection_upgrade();\n");
  await assert.rejects(migrateDatabase(f.databasePath, migrationDirectory), /deliberately_fail/u);
  let db = openDatabase(f.databasePath);
  assert.deepEqual(db.prepare("SELECT name,type,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all(), snapshot);
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1); assert.equal(db.pragma("legacy_alter_table", { simple: true }), 0);
  db.close();
  const migrated = await migrateDatabase(f.databasePath);
  assert.deepEqual(migrated.appliedVersions, migrationVersionsAfter(99));
  db = openDatabase(f.databasePath); f.resources.defer(() => { if (db.open) db.close(); });
  const agent = db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(id) as Record<string, unknown>;
  assert.equal(agent.integration_mode, "peer"); assert.equal(agent.owner_member_id, f.membership.memberId);
  assert.equal(agent.name, f.offer.displayName); assert.equal(agent.device_id, null); assert.equal(agent.runtime_policy_json, null);
  assert.equal(JSON.parse(agent.capabilities_json as string).supportsStart, true);
  const valid = grant.expiresAt > new Date().toISOString();
  assert.equal(agent.enabled, valid ? 1 : 0);
  assert.equal(db.prepare("SELECT * FROM room_agent_participants WHERE agent_id = ?").all(id).length, valid ? 1 : 0);
  assert.equal(db.prepare("SELECT * FROM peer_agent_projections WHERE projection_agent_id = ?").all(id).length, 1);
  assert.equal(db.pragma("legacy_alter_table", { simple: true }), 0); assert.deepEqual(db.pragma("foreign_key_check"), []);
  assert.deepEqual(db.pragma("integrity_check"), [{ integrity_check: "ok" }]);
});
