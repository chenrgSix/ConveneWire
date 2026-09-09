import assert from "node:assert/strict";
import test from "node:test";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { PeerStoreError } from "../src/data/peer-membership-repository.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { createServerApp } from "../src/app.js";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { now, roomId, teamId, otherRoomId, denied } from "./helpers/peer-fixture.js";

const later = "2026-09-10T04:00:00.000Z";

test("complete offline export history preserves expired prefixes and admits only the final current grant", async t => {
  const f = await peerAgentFixture(t), expired = { ...f.offer, grant: { ...f.offer.grant, expiresAt: "2026-09-10T03:00:00.000Z" } };
  const current = { ...f.offer, displayName: "Reviewed while offline", grant: { ...f.offer.grant, revision: 2, issuedAt: later } };
  const request = f.sync([expired, current], later), receipt = f.service.synchronize(f.token, request, later);
  assert.equal(receipt.grantRevision, 2); assert.equal(receipt.grantDigest, peerDigest(current.grant));
  assert.equal(f.service.listOffers(f.actor, teamId)[0]?.offer.displayName, current.displayName);
  assert.equal(f.core.listAgents(teamId).length, 0);
  const { schemaVersion: _, proof, ...content } = receipt;
  verifyPeerProof(proof, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey }, { purpose: "agent.export",
    audienceNodeId: f.membership.participantNodeId, operationId: request.proof.payload.operationId, nonce: request.proof.payload.nonce,
    subjectDigest: peerDigest(content) }, later);
  assert.throws(() => f.service.accept(f.actor, f.acceptance(expired), later), error => error instanceof PeerStoreError);
  const accepted = f.service.accept(f.actor, f.acceptance(current), later);
  assert.equal(f.core.getAgent(accepted.projection.projectionAgentId)?.enabled, true);
  assert.equal(f.service.synchronize(f.token, f.sync([expired, current], later), later).historyDigest, receipt.historyDigest);
  assert.equal(f.grants.getExport(expired.grant.exportId, 1)?.value.expiresAt, expired.grant.expiresAt);
});

test("withdrawal before any successful upload never exposes the intermediate active grant", async t => {
  const f = await peerAgentFixture(t), withdrawn = { ...f.offer, grant: { ...f.offer.grant, revision: 2, state: "revoked" as const, issuedAt: later } };
  const receipt = f.service.synchronize(f.token, f.sync([f.offer, withdrawn], later), later);
  assert.equal(receipt.grantRevision, 2); assert.equal(f.core.listAgents(teamId).length, 0);
  assert.equal(f.grants.currentExport(f.offer.grant.peerId, f.offer.grant.localAgentId)?.value.state, "revoked");
  assert.throws(() => f.service.accept(f.actor, f.acceptance(), later), denied("STALE_AUTHORIZATION"));
  assert.throws(() => f.service.synchronize(f.token, f.sync(), now), denied("STALE_AUTHORIZATION"));
  assert.equal(f.grants.getExport(f.offer.grant.exportId)?.value.revision, 2);
});

test("history installation rolls back partial invalidation and rejects metadata rewrites", async t => {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now), id = accepted.projection.projectionAgentId;
  const changed = { ...f.offer, grant: { ...f.offer.grant, revision: 2 } };
  const withdrawn = { ...f.offer, grant: { ...f.offer.grant, revision: 3, state: "revoked" as const } };
  f.database.exec("CREATE TRIGGER test_sync_failure BEFORE INSERT ON peer_agent_offers WHEN NEW.grant_revision = 3 BEGIN SELECT RAISE(ABORT, 'interrupted sync'); END");
  assert.throws(() => f.service.synchronize(f.token, f.sync([f.offer, changed, withdrawn]), now), /interrupted sync/u);
  assert.equal(f.grants.getExport(f.offer.grant.exportId)?.value.revision, 1);
  assert.equal(f.core.getAgent(id)?.enabled, true); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, [id]);
  f.database.exec("DROP TRIGGER test_sync_failure");
  assert.throws(() => f.service.synchronize(f.token, f.sync([{ ...f.offer, displayName: "Rewritten" }, changed]), now), denied("PAYLOAD_CONFLICT"));
  assert.equal(f.grants.getExport(f.offer.grant.exportId)?.value.revision, 1); assert.equal(f.core.getAgent(id)?.enabled, true);
  f.service.synchronize(f.token, f.sync([f.offer, changed, withdrawn]), now);
  assert.equal(f.core.getAgent(id)?.enabled, false); assert.deepEqual(f.core.getRoomParticipants(roomId).agentIds, []);
});

test("offline lineage replacement cannot revive retired IDs or cross a Guest Room ceiling", async t => {
  const f = await peerAgentFixture(t);
  const replacement = { ...f.offer, grant: { ...f.offer.grant, exportId: "export_syncfresh001" } };
  const retired = { ...f.offer, grant: { ...f.offer.grant, revision: 2, state: "revoked" as const } };
  const result = f.service.synchronize(f.token, f.sync([f.offer, replacement, retired]), now);
  assert.equal(result.exportId, replacement.grant.exportId);
  assert.throws(() => f.service.synchronize(f.token, f.sync([f.offer, retired]), now), denied("STALE_AUTHORIZATION"));
  const wider = { ...replacement, grant: { ...replacement.grant, revision: 2, roomIds: [otherRoomId] } };
  assert.throws(() => f.service.synchronize(f.token, f.sync([f.offer, replacement, retired, wider]), now), denied("SCOPE_DENIED"));
  const skipped = { ...replacement, grant: { ...replacement.grant, revision: 3 } };
  assert.throws(() => f.service.synchronize(f.token, f.sync([f.offer, replacement, retired, skipped]), now), denied("PAYLOAD_CONFLICT"));
  const forged = f.sync([f.offer, replacement, retired]); forged.offers[0]!.role = "Forged";
  assert.throws(() => f.service.synchronize(f.token, forged, now), denied("UNAUTHENTICATED"));
  assert.equal(f.grants.currentExport(f.offer.grant.peerId, f.offer.grant.localAgentId)?.value.exportId, replacement.grant.exportId);
});

test("authenticated history HTTP accepts bounded recovery larger than a single offer and rejects browsers", async t => {
  const f = await peerAgentFixture(t), origin = f.identity.browserOrigin;
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const offers = Array.from({ length: 40 }, (_, i) => ({ ...f.offer, grant: { ...f.offer.grant, revision: i + 1 } }));
  const request = JSON.stringify(f.sync(offers)); assert.ok(Buffer.byteLength(request) > 16 * 1024);
  const headers = { "content-type": "application/json", authorization: `Bearer ${f.token}` };
  const send = (extra = {}, payload = request) => app.inject({ method: "POST", url: "/api/peer/agents/sync", headers: { ...headers, ...extra }, payload });
  assert.equal((await send({ origin })).statusCode, 403);
  assert.equal((await send({ cookie: "unrelated=1" })).statusCode, 403);
  assert.equal((await send({ authorization: `Bearer ${f.ownerSession.secret}` })).statusCode, 401);
  const result = await send(); assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().grantRevision, 40);
  assert.equal((await send({}, request.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))).statusCode, 400);
  assert.equal((await send({}, " ".repeat(1024 * 1024) + request)).statusCode, 413);
});
