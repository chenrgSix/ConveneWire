import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PeerIdentityProof } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { verifyPeerProof } from "../src/security/peer-proof-verifier.js";
import { joinRelayNodes, relayRuntimeFixture, relaySecret, untilRelay } from "./helpers/relay-runtime-fixture.js";

type RelayFixture = Awaited<ReturnType<typeof relayRuntimeFixture>>;
type RelayNode = Awaited<ReturnType<RelayFixture["node"]>>;

async function inventory(root: string): Promise<Record<string, {sha256: string; size: number; mode: number}>> {
  const files: Record<string, {sha256: string; size: number; mode: number}> = {};
  const visit = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes: true})) {
      const name = path.join(relative, entry.name), file = path.join(root, name), metadata = await lstat(file);
      assert.equal(metadata.isSymbolicLink(), false, name);
      if (metadata.isDirectory()) await visit(name);
      else {
        assert.equal(metadata.isFile(), true, name);
        const bytes = await readFile(file);
        files[name] = {sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mode: metadata.mode & 0o777};
      }
    }
  };
  await visit(""); return files;
}

async function publicIdentity(host: RelayNode, participant: RelayNode, now: number): Promise<PeerIdentityProof> {
  const operationId = `op_${relaySecret()}`, nonce = relaySecret();
  const response = await host.request("/api/peer/identity", {method: "POST",
    payload: {schemaVersion: 1, participant: participant.identity, operationId, nonce}});
  assert.equal(response.status, 200, response.body);
  const proof = response.json() as PeerIdentityProof; assert.ok(validatePeer("PeerIdentityProof", proof));
  assert.deepEqual(proof.host, host.identity); assert.equal(proof.hostOrigin, host.origin);
  verifyPeerProof(proof.proof, host.identity, {purpose: "node.identity", audienceNodeId: participant.identity.nodeId,
    operationId, nonce, subjectDigest: peerDigest({host: proof.host, hostOrigin: proof.hostOrigin})}, new Date(now).toISOString());
  return proof;
}

test("stopped enabled Relay root restores at its original path with identity, certificate and Room access intact", {timeout: 180000}, async t => {
  const f = await relayRuntimeFixture(t), host = await f.node("Host"), participant = await f.node("Participant");
  host.runtime.start(); participant.runtime.start();
  await untilRelay(() => host.runtime.status().state === "ready" && participant.runtime.status().state === "ready", "Nodes did not become ready", 25000);
  const {joined, browser} = await joinRelayNodes(host, participant, f.ca.now);
  const claimed = await host.request("/api/peer/browser-entry/claim", {method: "POST", payload: browser, headers: {origin: host.origin}});
  assert.equal(claimed.status, 200, claimed.body);
  const cookie = claimed.headers["set-cookie"]![0]!.split(";", 1)[0]!;
  const roomPath = `/api/rooms/${host.room.roomId}/messages`;
  assert.equal((await host.request(roomPath, {headers: {cookie}})).status, 200);
  const beforeIdentity = await publicIdentity(host, participant, f.ca.now);
  const beforeCertificate = host.runtime.status().certificateExpiresAt; assert.ok(beforeCertificate);
  const beforeCounts = {...f.ca.counters};
  const originalRoot = host.root, originalRuntime = host.runtime;

  // Stop and drain the only active Host before reading any backup bytes. The
  // backup and retired source below are inert files, never Node instances.
  await host.app.close(); assert.equal(originalRuntime.status().state, "disabled");
  await assert.rejects(host.request("/api/auth/status"));
  const beforeFiles = await inventory(originalRoot);
  assert.ok(beforeFiles[path.join("relay", "config.json")]);
  assert.ok(beforeFiles[path.join("relay", "certificates.json")]); assert.ok(beforeFiles["hub.sqlite"]);
  const backup = path.join(f.resources.directory, "Host.stopped-backup"), retired = path.join(f.resources.directory, "Host.retired-source");
  await cp(originalRoot, backup, {recursive: true, errorOnExist: true, force: false, preserveTimestamps: true});
  assert.deepEqual(await inventory(backup), beforeFiles);
  await rename(originalRoot, retired);
  await cp(backup, originalRoot, {recursive: true, errorOnExist: true, force: false, preserveTimestamps: true});
  assert.deepEqual(await inventory(originalRoot), beforeFiles);
  if (process.platform !== "win32") {
    assert.equal((await lstat(backup)).mode & 0o777, 0o700);
    assert.equal((await lstat(originalRoot)).mode & 0o777, 0o700);
    assert.equal((await lstat(path.join(originalRoot, "relay", "certificates.json"))).mode & 0o777, 0o600);
  }
  assert.equal(originalRuntime.status().state, "disabled");
  f.ca.failPath = "/directory";
  await host.restart();
  assert.equal(host.root, originalRoot); assert.notEqual(host.runtime, originalRuntime);
  assert.equal(originalRuntime.status().state, "disabled");
  const afterIdentity = await publicIdentity(host, participant, f.ca.now);
  assert.deepEqual(afterIdentity.host, beforeIdentity.host); assert.equal(afterIdentity.hostOrigin, beforeIdentity.hostOrigin);
  assert.equal(host.runtime.status().certificateExpiresAt, beforeCertificate);
  assert.equal(f.ca.counters.certificates, beforeCounts.certificates, "restore must reuse the cached certificate");
  assert.equal(f.ca.counters.accounts, beforeCounts.accounts); assert.equal(f.ca.counters.orders, beforeCounts.orders);
  assert.equal(f.ca.counters.requests, beforeCounts.requests, "valid cache must work while the CA is unavailable");
  const afterCache = (await inventory(originalRoot))[path.join("relay", "certificates.json")];
  assert.deepEqual(afterCache, beforeFiles[path.join("relay", "certificates.json")]);

  // Reuse the pre-backup browser session and membership; no re-invitation or
  // credential exchange is performed after restore.
  assert.equal((await host.request(roomPath, {headers: {cookie}})).status, 200);
  assert.equal((await host.request(`/api/rooms/${host.otherRoom.roomId}/messages`, {headers: {cookie}})).status, 403);
  const access = await host.app.inject({url: `/api/peer/teams/${host.team.teamId}/access`, headers: host.ownerHeaders});
  assert.equal(access.statusCode, 200, access.body); assert.equal(access.json().invitationSupported, true);
  assert.equal(access.json().memberships.length, 1);
  assert.equal(access.json().memberships[0].membershipId, joined.runtime.membership.membershipId);
  assert.deepEqual(await inventory(backup), beforeFiles, "restart must not write to the backup identity");
});
