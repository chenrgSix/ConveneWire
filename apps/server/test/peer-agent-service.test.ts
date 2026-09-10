import assert from "node:assert/strict";
import test from "node:test";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { now, expiry, teamId, roomId, otherRoomId, denied, secret } from "./helpers/peer-fixture.js";
import { PeerAgentService } from "../src/registry/peer-agent-service.js";
import { AuthService, AuthorizationError } from "../src/security/auth-service.js";
import { AuthorityService } from "../src/security/authority-service.js";
import { PeerAdmissionService } from "../src/security/peer-admission-service.js";
import { PeerAuthorizationRepository } from "../src/data/peer-authorization-repository.js";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { createServerApp } from "../src/app.js";

test("a Peer offer needs the machine credential and fresh Participant signature and creates no Agent", async t => {
  const f = await peerAgentFixture(t), { offer, service, token } = f;
  for (const credential of [secret(), f.ownerSession.secret]) assert.throws(() => service.offer(credential, f.signed(), now), denied("UNAUTHENTICATED"));
  const forged = f.signed(); forged.offer = { ...offer, displayName: "Forged" };
  assert.throws(() => service.offer(token, forged, now), denied("UNAUTHENTICATED"));
  for (const changed of [
    { ...offer, grant: { ...offer.grant, roomIds: [otherRoomId] } },
    { ...offer, grant: { ...offer.grant, capabilities: { ...offer.grant.capabilities, supportsOwnerPrivateOutput: true } } },
    { ...offer, grant: { ...offer.grant, peerId: "peer_another00001" } }
  ]) assert.throws(() => service.offer(token, f.signed(changed), now), denied("SCOPE_DENIED"));
  assert.throws(() => service.offer(token, f.signed(), "2026-09-10T02:01:00.000Z"), denied("STALE_AUTHORIZATION"));
  for (const displayName of [" unreviewed ", "hidden\n", "\u2003unreviewed", "hidden\u0000text"]) {
    assert.throws(() => service.offer(token, f.signed({ ...offer, displayName }), now), denied("INVALID_MESSAGE"));
  }
  assert.equal(service.listOffers(f.actor, teamId).length, 0);
  const request = f.signed(), received = service.offer(token, request, now);
  assert.ok(validatePeer("PeerAgentOfferReceipt", received));
  const { proof, schemaVersion: _, ...content } = received;
  verifyPeerProof(proof, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey }, {
    purpose: "agent.export", audienceNodeId: f.membership.participantNodeId, operationId: request.proof.payload.operationId,
    nonce: request.proof.payload.nonce, subjectDigest: peerDigest(content) }, now);
  assert.equal(service.offer(token, f.signed(), now).offerDigest, received.offerDigest);
  assert.equal(service.listOffers(f.actor, teamId).length, 1);
  assert.equal(service.listOffers(f.actor, teamId)[0]?.acceptance, null);
  assert.equal(f.core.listAgents(teamId).length, 0);
  assert.equal(f.database.prepare("SELECT * FROM peer_agent_projections").all().length, 0);
  assert.throws(() => service.offer(token, f.signed({ ...offer, displayName: "Changed after review" }), now), denied("PAYLOAD_CONFLICT"));
});

test("Host acceptance binds reviewed metadata, current grant, Room and capability ceilings", async t => {
  const f = await peerAgentFixture(t), { service, offer } = f;
  service.offer(f.token, f.signed(), now);
  const request = f.acceptance();
  const peerActor = { ...f.actor, userId: f.membership.userId };
  assert.throws(() => service.accept(peerActor, request, now), error => error instanceof AuthorizationError);
  assert.throws(() => service.listOffers(peerActor, teamId), error => error instanceof AuthorizationError);
  for (const changes of [{ roomIds: [otherRoomId] }, { capabilities: { ...offer.grant.capabilities, supportsResume: true } },
    { expiresAt: "2027-01-01T00:00:00.000Z" }]) {
    assert.throws(() => service.accept(f.actor, { ...request, ...changes }, now), denied("SCOPE_DENIED"));
    assert.equal(f.database.prepare("SELECT * FROM peer_agent_projections").all().length, 0);
  }
  assert.throws(() => service.accept(f.actor, { ...request, offerDigest: "a".repeat(64) }, now), denied("PAYLOAD_CONFLICT"));
  const accepted = service.accept(f.actor, request, now);
  assert.ok(validatePeer("PeerAgentAcceptanceReceipt", accepted));
  const { proof, schemaVersion: _, ...content } = accepted;
  verifyPeerProof(proof, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey }, { purpose: "agent.acceptance",
    audienceNodeId: f.membership.participantNodeId, operationId: request.operationId, nonce: proof.payload.nonce, subjectDigest: peerDigest(content) }, now);
  assert.deepEqual(service.accept(f.actor, request, now).acceptance, accepted.acceptance);
  assert.notEqual(accepted.projection.projectionAgentId, offer.grant.localAgentId);
  assert.equal(accepted.projection.displayName, offer.displayName);
  assert.equal(f.grants.requireEffective(offer.grant.peerId, offer.grant.localAgentId, roomId, now).acceptance.value.acceptanceId, accepted.acceptance.acceptanceId);
  assert.throws(() => service.accept(f.actor, { ...request, operationId: "op_concurrent0001" }, now), denied("STALE_AUTHORIZATION"));
  assert.throws(() => service.accept(f.actor, { ...request, capabilities: { ...request.capabilities, supportsStart: false } }, now), denied("PAYLOAD_CONFLICT"));
  assert.deepEqual(f.database.pragma("foreign_key_check"), []);
});

test("changed or replaced publication invalidates acceptance and exact replays cannot restore authority", async t => {
  const f = await peerAgentFixture(t), { service, offer, grants } = f, { peerId, localAgentId } = offer.grant;
  service.offer(f.token, f.signed(), now);
  const firstRequest = f.acceptance(), first = service.accept(f.actor, firstRequest, now);
  const changed = { ...offer, displayName: "Reviewed again", grant: { ...offer.grant, revision: 2 } };
  service.offer(f.token, f.signed(changed), now);
  assert.throws(() => grants.requireEffective(peerId, localAgentId, roomId, now), denied("STALE_AUTHORIZATION"));
  service.offer(f.token, f.signed(), now); service.accept(f.actor, firstRequest, now);
  assert.equal(grants.currentExport(peerId, localAgentId)?.value.revision, 2);
  assert.throws(() => grants.requireEffective(peerId, localAgentId, roomId, now), denied("STALE_AUTHORIZATION"));
  const secondRequest = { ...f.acceptance(changed), operationId: "op_reviewagain001",
    expectedAcceptanceId: first.acceptance.acceptanceId, expectedAcceptanceRevision: 1 };
  const second = service.accept(f.actor, secondRequest, now);
  assert.equal(second.acceptance.acceptanceId, first.acceptance.acceptanceId);
  assert.equal(second.acceptance.revision, 2);
  const revoke = { schemaVersion: 1 as const, operationId: "op_revokeagent001", acceptanceId: second.acceptance.acceptanceId, expectedRevision: 2 };
  service.revoke(f.actor, revoke, now); service.accept(f.actor, secondRequest, now); service.revoke(f.actor, revoke, now);
  assert.throws(() => grants.requireEffective(peerId, localAgentId, roomId, now), denied("REVOKED"));
  const replacement = { ...changed, grant: { ...changed.grant, exportId: "export_replacement01", revision: 1 } };
  service.offer(f.token, f.signed(replacement), now);
  service.offer(f.token, f.signed(changed), now);
  assert.equal(grants.currentExport(peerId, localAgentId)?.value.exportId, replacement.grant.exportId);
  assert.throws(() => grants.requireEffective(peerId, localAgentId, roomId, now), denied("REVOKED"));
  const fresh = service.accept(f.actor, { ...f.acceptance(replacement), operationId: "op_acceptfresh001",
    expectedAcceptanceId: second.acceptance.acceptanceId, expectedAcceptanceRevision: 3 }, now);
  assert.notEqual(fresh.acceptance.acceptanceId, second.acceptance.acceptanceId);
  assert.equal(fresh.projection.projectionAgentId, first.projection.projectionAgentId);
  assert.equal(grants.requireEffective(peerId, localAgentId, roomId, now).acceptance.value.acceptanceId, fresh.acceptance.acceptanceId);
  f.store.revokeMembership(f.membership.membershipId, now);
  assert.throws(() => service.offer(f.token, f.signed(), now), denied("UNAUTHENTICATED"));
  service.revoke(f.actor, { ...revoke, operationId: "op_revokefresh001", acceptanceId: fresh.acceptance.acceptanceId, expectedRevision: 1 }, now);
  assert.equal(grants.currentAcceptance(peerId, localAgentId)?.value.state, "revoked");
});

test("offer/acceptance transactions recover after failure and reopen without reallocating identities", async t => {
  const f = await peerAgentFixture(t), { service } = f;
  f.database.exec("CREATE TRIGGER test_offer_failure BEFORE INSERT ON peer_agent_offers BEGIN SELECT RAISE(ABORT, 'interrupted offer'); END");
  assert.throws(() => service.offer(f.token, f.signed(), now), /interrupted offer/u);
  assert.equal(f.grants.currentExport(f.offer.grant.peerId, f.offer.grant.localAgentId), undefined);
  f.database.exec("DROP TRIGGER test_offer_failure");
  service.offer(f.token, f.signed(), now);
  f.database.exec("CREATE TRIGGER test_accept_failure BEFORE INSERT ON peer_agent_operations BEGIN SELECT RAISE(ABORT, 'interrupted accept'); END");
  assert.throws(() => service.accept(f.actor, f.acceptance(), now), /interrupted accept/u);
  assert.equal(f.database.prepare("SELECT * FROM peer_agent_projections").all().length, 0);
  assert.equal(f.grants.currentAcceptance(f.offer.grant.peerId, f.offer.grant.localAgentId), undefined);
  f.database.exec("DROP TRIGGER test_accept_failure");
  const accepted = service.accept(f.actor, f.acceptance(), now);
  for (const table of ["peer_agent_offers", "peer_agent_projections", "peer_agent_operations"]) {
    assert.throws(() => f.database.prepare(`DELETE FROM ${table}`).run(), /retained/u);
    const field = table === "peer_agent_offers" ? "offer_digest" : table === "peer_agent_projections" ? "projection_agent_id" : "intent_digest";
    assert.throws(() => f.database.prepare(`UPDATE ${table} SET ${field} = ${field}`).run(), /immutable/u);
  }
  const reopened = f.reopen(), auth = new AuthService(reopened.database, () => now);
  const identity = new AuthorityService(reopened.database, f.identity.browserOrigin);
  const restored = new PeerAgentService(reopened.database, auth, identity, new PeerAdmissionService(reopened.database, auth, identity));
  const replay = restored.accept(auth.authenticateWebSession(f.ownerSession.secret, now), f.acceptance(), now);
  assert.deepEqual(replay.acceptance, accepted.acceptance);
  assert.deepEqual(replay.projection, accepted.projection);
  assert.throws(() => new PeerAuthorizationRepository(reopened.database).requireEffective(f.offer.grant.peerId, f.offer.grant.localAgentId, roomId, expiry), denied("EXPIRED"));
  assert.deepEqual(reopened.database.pragma("foreign_key_check"), []);
});

test("HTTP Agent sharing keeps machine publication separate from human Host decisions", async t => {
  const f = await peerAgentFixture(t), origin = f.identity.browserOrigin;
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const post = (url: string, body: unknown, headers = {}) => app.inject({ method: "POST", url,
    headers: { "content-type": "application/json", ...headers }, payload: typeof body === "string" ? body : JSON.stringify(body) });
  const machine = { authorization: `Bearer ${f.token}` }, owner = { origin, cookie: `__Host-agentroom_session=${f.ownerSession.secret}` };
  const url = "/api/peer/agents/offers";
  for (const headers of [owner, { ...machine, origin }, { ...machine, cookie: owner.cookie }]) assert.equal((await post(url, f.signed(), headers)).statusCode, 403);
  assert.equal((await post(url, f.signed(), { authorization: `Bearer ${f.ownerSession.secret}` })).statusCode, 401);
  assert.equal((await post(url, JSON.stringify(f.signed()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), machine)).statusCode, 400);
  const offered = await post(url, f.signed(), machine);
  assert.equal(offered.statusCode, 200, offered.body);
  assert.match(String(offered.headers["cache-control"]), /no-store/u);
  assert.equal((await post("/api/peer/agents/accept", f.acceptance(), machine)).statusCode, 401);
  assert.equal((await post("/api/peer/agents/accept", f.acceptance(), { ...owner, origin: "https://wrong.example.test" })).statusCode, 403);
  const accepted = await post("/api/peer/agents/accept", f.acceptance(), owner);
  assert.equal(accepted.statusCode, 200, accepted.body);
  const listURL = `/api/peer/teams/${teamId}/agent-offers`;
  assert.equal((await app.inject({ method: "GET", url: listURL, headers: machine })).statusCode, 401);
  const list = await app.inject({ method: "GET", url: listURL, headers: owner });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().offers.length, 1);
  assert.equal(list.json().offers[0].grantDigest, peerDigest(f.offer.grant));
  assert.equal(list.json().offers[0].offerDigest, peerDigest(f.offer));
});
