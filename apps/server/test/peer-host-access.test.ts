import assert from "node:assert/strict";
import test from "node:test";
import { createServerApp } from "../src/app.js";
import { peerSecretHash } from "../src/data/peer-membership-repository.js";
import { peerAgentFixture } from "./helpers/peer-agent-fixture.js";
import { now, expiry, ownerId, roomId, teamId, secret } from "./helpers/peer-fixture.js";

test("Host access controls expose only this Team's Owner metadata and current expiry/revocation", async t => {
  const f = await peerAgentFixture(t), clock = { value: now }, origin = f.identity.browserOrigin;
  const otherTeam = "team_otheraccess001";
  f.core.createTeamWithOwner({ teamId: otherTeam, name: "Other Host Team", createdAt: now }, {
    memberId: "member_otheraccess001", userId: ownerId, teamId: otherTeam, displayName: "Owner", role: "owner", createdAt: now
  });
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => clock.value,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-access-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  const headers = { origin, cookie: `__Host-agentroom_session=${f.ownerSession.secret}` };
  const url = `/api/peer/teams/${teamId}/access`;
  const issued = await app.inject({ method: "POST", url: "/api/peer/invitations", headers,
    payload: { schemaVersion: 1, operationId: "op_accessinvitation001", scope: { kind: "room", teamId, roomId },
      expiresAt: "2026-09-10T02:01:00.000Z", membershipExpiresAt: expiry } });
  assert.equal(issued.statusCode, 200, issued.body);
  const invitation = issued.json();
  const response = await app.inject({ method: "GET", url, headers });
  assert.equal(response.statusCode, 200, response.body);
  assert.match(String(response.headers["cache-control"]), /no-store/u);
  const view = response.json();
  assert.equal(view.invitationSupported, true);
  assert.equal(view.hostOrigin, origin);
  assert.deepEqual(view.host, { nodeId: f.identity.nodeId, publicKey: f.identity.publicKey });
  assert.equal(view.invitations.length, 2);
  assert.equal(view.invitations.find((item: { invitation: { invitationId: string } }) => item.invitation.invitationId === invitation.invitation.invitationId).state, "open");
  assert.equal(view.memberships.length, 1);
  assert.equal(view.memberships[0].membershipId, f.membership.membershipId);
  assert.equal(view.memberships[0].state, "active");
  assert.equal(view.memberships[0].roomLabel, "Invited");
  for (const secret of [invitation.secret, f.token, f.ownerSession.secret]) assert.equal(response.body.includes(secret), false);
  assert.doesNotMatch(response.body, /tokenHash|secret_hash|claim_digest|localUserId|credentialId/u);
  const other = await app.inject({ method: "GET", url: `/api/peer/teams/${otherTeam}/access`, headers });
  assert.equal(other.statusCode, 200);
  assert.deepEqual(other.json().invitations, []);
  assert.deepEqual(other.json().memberships, []);
  clock.value = "2026-09-10T02:01:01.000Z";
  assert.equal((await app.inject({ method: "GET", url, headers })).json().invitations
    .find((item: { invitation: { invitationId: string } }) => item.invitation.invitationId === invitation.invitation.invitationId).state, "expired");
  assert.equal((await app.inject({ method: "DELETE", url: `/api/peer/invitations/${invitation.invitation.invitationId}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/peer/memberships/${f.membership.membershipId}`, headers })).statusCode, 200);
  const revoked = (await app.inject({ method: "GET", url, headers })).json();
  assert.equal(revoked.memberships[0].state, "revoked");
  assert.equal(revoked.invitations.find((item: { invitation: { invitationId: string } }) => item.invitation.invitationId === invitation.invitation.invitationId).state, "revoked");
});

test("Host access metadata rejects guests, ordinary Members, foreign Teams and machine credentials", async t => {
  const f = await peerAgentFixture(t), origin = f.identity.browserOrigin;
  const app = await createServerApp({ databasePath: f.databasePath, clock: () => now,
    webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-access-fixture-owner-recovery-0123456789" } });
  f.resources.defer(() => app.close());
  f.core.createUser({ userId: "user_accessmember001", displayName: "Member", createdAt: now });
  f.core.createMember({ memberId: "member_accessmember001", userId: "user_accessmember001", teamId,
    displayName: "Member", role: "member", createdAt: now }, [roomId]);
  const member = f.auth.issueWebSession("user_accessmember001", now, expiry);
  const guest = f.auth.issueWebSession(f.membership.userId, now, expiry);
  const credentialId = "peerhuman_hostaccess001";
  f.store.issueCredential(f.membership.membershipId, "peer.human", { credentialId, tokenHash: peerSecretHash(secret()), expiresAt: expiry },
    f.membership.scope, now);
  f.database.prepare(`INSERT INTO peer_human_bindings (credential_id, membership_id, token_hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).run("peeraccess_hostaccess001", f.membership.membershipId, peerSecretHash(secret()), now, expiry);
  f.database.prepare(`INSERT INTO peer_human_entries (credential_id, binding_credential_id, operation_id, intent_digest, created_at, exchange_expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(credentialId, "peeraccess_hostaccess001", "op_humanhostaccess001", "a".repeat(64), now, "2026-09-10T02:01:00.000Z");
  f.database.prepare("UPDATE peer_credentials SET consumed_at = ? WHERE credential_id = ?").run(now, credentialId);
  f.database.prepare("INSERT INTO peer_web_sessions VALUES (?, ?)").run(guest.id, credentialId);
  assert.equal(f.auth.authenticateWebSession(guest.secret, now).peerAccess?.roomId, roomId);
  const url = `/api/peer/teams/${teamId}/access`;
  for (const token of [member.secret, guest.secret]) {
    assert.equal((await app.inject({ method: "GET", url, headers: { cookie: `__Host-agentroom_session=${token}` } })).statusCode, 403);
  }
  assert.equal((await app.inject({ method: "GET", url })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${f.token}` } })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/peer/teams/team_unknownaccess001/access",
    headers: { cookie: `__Host-agentroom_session=${f.ownerSession.secret}` } })).statusCode, 403);
});
