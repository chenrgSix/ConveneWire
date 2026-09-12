import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { relayRuntimeFixture, relaySecret, untilRelay } from "./helpers/relay-runtime-fixture.js";

type RelayFixture = Awaited<ReturnType<typeof relayRuntimeFixture>>;
type RelayNode = Awaited<ReturnType<RelayFixture["node"]>>;

async function closePromptly(node: RelayNode): Promise<void> {
  const deadline = new AbortController();
  try {
    await Promise.race([node.app.close(), delay(3000, undefined, {signal: deadline.signal}).then(() => {
      throw new Error("Local Hub close did not cancel Relay work within three seconds");
    })]);
  } finally { deadline.abort(); }
  assert.equal(node.runtime.status().state, "disabled");
}

async function rejectInvitation(node: RelayNode, now: number, headers = node.ownerHeaders): Promise<void> {
  const access = await node.app.inject({url: `/api/peer/teams/${node.team.teamId}/access`, headers});
  assert.equal(access.statusCode, 200, access.body);
  assert.equal(access.json().invitationSupported, false);
  const before = access.json().invitations.length;
  const invitation = await node.app.inject({method: "POST", url: "/api/peer/invitations", headers,
    payload: {schemaVersion: 1, operationId: `op_${relaySecret()}`,
      scope: {kind: "room", teamId: node.team.teamId, roomId: node.room.roomId},
      expiresAt: new Date(now + 3600000).toISOString(), membershipExpiresAt: new Date(now + 86400000).toISOString()}});
  assert.equal(invitation.statusCode, 400, invitation.body);
  assert.match(invitation.body, /尚未就绪/u);
  const after = await node.app.inject({url: `/api/peer/teams/${node.team.teamId}/access`, headers});
  assert.equal(after.statusCode, 200, after.body); assert.equal(after.json().invitations.length, before);
}

test("Relay readiness rejects invitations during blocked initial issuance and expiry; shutdown cancels CA waits", {timeout: 180000}, async t => {
  const f = await relayRuntimeFixture(t);
  f.ca.blockedPath = "/directory";
  const blocked = await f.node("Blocked"); blocked.runtime.start();
  await untilRelay(() => f.ca.blockedRequests > 0, "CA did not receive the initial request");
  assert.equal(blocked.runtime.status().state, "issuing_certificate");
  await rejectInvitation(blocked, f.ca.now);
  assert.equal((await blocked.app.inject({url: "/api/teams", headers: blocked.ownerHeaders})).statusCode, 200);
  await closePromptly(blocked);

  f.ca.blockedPath = null;
  const expired = await f.node("Expired"); expired.runtime.start();
  await untilRelay(() => expired.runtime.status().state === "ready", "Node did not become ready");
  assert.equal(expired.runtime.ingress.invitationReady(), true);
  f.ca.failPath = "/new-order";
  const expiresAt = expired.runtime.status().certificateExpiresAt; assert.ok(expiresAt);
  f.ca.now = Date.parse(expiresAt) + 1;
  assert.notEqual(expired.runtime.status().state, "ready");
  assert.equal(expired.runtime.ingress.invitationReady(), false);

  // Advancing the certificate clock also expires the old Owner session. Obtain
  // a new native session so invitation refusal proves readiness, not auth expiry.
  const host = new URL(expired.localOrigin).host;
  const entry = await expired.app.inject({method: "POST", url: "/api/local-node/control/entry",
    headers: {host, "x-convenewire-node-control": expired.launch.controlToken}});
  assert.equal(entry.statusCode, 200, entry.body);
  const ticket = entry.json().url.split("/").at(-1);
  const session = await expired.app.inject({method: "POST", url: "/api/local-node/session",
    headers: {host, origin: expired.localOrigin}, payload: {ticket}});
  assert.equal(session.statusCode, 200, session.body);
  const ownerHeaders = {host, origin: expired.localOrigin, authorization: `Bearer ${session.json().session.token}`};
  await rejectInvitation(expired, f.ca.now, ownerHeaders);
  // A healthy probe sleeps for twenty seconds; only failures use fixture retry.
  await untilRelay(() => expired.runtime.status().errorCode === "CERTIFICATE_RETRY", "Renewal failure was not reported", 30000);
  assert.notEqual(expired.runtime.status().state, "ready");
  await rejectInvitation(expired, f.ca.now, ownerHeaders);
  await closePromptly(expired);
});
