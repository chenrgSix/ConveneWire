import assert from "node:assert/strict";
import test from "node:test";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { createPublicKey, verify, X509Certificate } from "node:crypto";
import { canonicalPeerJson } from "@convene-wire/contracts/peer-json";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { managedLANPeerFixture } from "./helpers/managed-lan-peer-fixture.js";
import { lanCertificates } from "../src/local-node/lan-certificates.js";
import { privateLANAddress } from "../src/local-node/lan-runtime.js";

test("managed LAN hot lifecycle, stable identity and local Owner isolation", async t => {
  const r = await createTestResources(t, "convenewire-managed-lan-");
  const f = await managedLANPeerFixture(r.directory, () => new Date().toISOString(), undefined, () => ["192.168.1.12"]);
  r.defer(() => f.close());
  const signed = f.runtime.transport(), status = f.runtime.status();
  assert.equal(status.ready, true); assert.equal(signed.transport.hostOrigin, f.origin);
  assert.equal(signed.transport.host.nodeId, f.launch.identity.nodeId);
  const key = createPublicKey({key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signed.transport.host.publicKey, "base64url")]), format: "der", type: "spki"});
  assert.ok(verify(null, canonicalPeerJson({domain: "convenewire.peer.lan.v1", transport: signed.transport}), key, Buffer.from(signed.signature, "base64url")));
  const request = (url: string, headers: Record<string, string> = {}) => new Promise<{status: number; text: string}>((resolve, reject) => {
    const req = https.request({hostname: "127.0.0.1", port: status.endpoints[0]!.port, servername: new URL(f.origin).hostname,
      ca: signed.transport.caCertificatePem, method: "GET", path: url, headers: {host: new URL(f.origin).host, ...headers}}, response => {
      let text = ""; response.on("data", data => {text += data;}); response.on("end", () => resolve({status: response.statusCode!, text}));
    }); req.on("error", reject); req.end();
  });
  assert.equal((await request("/api/auth/status")).status, 200);
  for (const endpoint of ["/api/local-node/lan", "/api/local-node/lan/transport", "/api/local-node/control/state", "/api/peer/teams/arbitrary/access", "/api/teams"]) {
    assert.equal((await request(endpoint, {authorization: f.ownerHeaders.authorization})).status, 403, endpoint);
  }
  for (const headers of [{...f.ownerHeaders, authorization: "Bearer wrong"}, {host: f.ownerHeaders.host, origin: f.ownerHeaders.origin}]) {
    assert.notEqual((await f.app.inject({url: "/api/local-node/lan", headers})).statusCode, 200);
  }
  for (const payload of ['{"enabled":true,"enabled":false}', '{"enabled":true,"origin":"https://evil.test"}', '{"enabled":"true"}', 'null']) {
    assert.notEqual((await f.app.inject({method: "POST", url: "/api/local-node/lan", headers: {...f.ownerHeaders, "content-type": "application/json"}, payload})).statusCode, 200);
  }
  await f.runtime.setEnabled(false, () => {});
  assert.equal(f.runtime.status().ready, false); assert.throws(() => f.runtime.transport());
  await assert.rejects(request("/api/auth/status"));
  assert.equal((await f.app.inject({url: "/api/teams", headers: f.ownerHeaders})).statusCode, 200, "local work survives LAN stop");
  await f.runtime.setEnabled(true, () => {});
  assert.deepEqual(f.runtime.status().endpoints, status.endpoints);
  await f.restart();
  assert.equal(f.runtime.transport().transport.caCertificatePem, signed.transport.caCertificatePem);
  assert.deepEqual(f.runtime.status().endpoints, status.endpoints);
  assert.equal((await request("/api/auth/status")).status, 200);
  for (const page of ["agents", "peers", "handoff"]) {
    assert.equal((await f.app.inject({method: "POST", url: "/api/local-node/open-console", headers: f.ownerHeaders, payload: {page}})).statusCode, 200);
    const result = await f.app.inject({url: "/api/local-node/control/state", headers: {host: f.ownerHeaders.host, "x-convenewire-node-control": f.launch.controlToken}});
    assert.equal(result.json().consolePage, page);
  }
  for (const page of ["https://evil.test", ["peers"], "settings"]) assert.notEqual((await f.app.inject({method: "POST", url: "/api/local-node/open-console", headers: f.ownerHeaders, payload: {page}})).statusCode, 200);
  await f.runtime.close();
  const blocker = net.createServer();
  await new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.listen(status.endpoints[0]!.port, "0.0.0.0", resolve); });
  r.defer(() => new Promise<void>(resolve => blocker.close(() => resolve())));
  await f.restart();
  assert.equal(f.runtime.status().ready, false);
  assert.ok(f.runtime.status().error);
  assert.equal((await f.app.inject({url: "/api/teams", headers: f.ownerHeaders})).statusCode, 200, "occupied LAN port must not prevent local startup");
  await f.runtime.setEnabled(false, () => {});
  await new Promise<void>(resolve => blocker.close(() => resolve()));
  await writeFile(path.join(r.directory, "relay.pending.json"), "{}", {mode: 0o600});
  await assert.rejects(f.runtime.setEnabled(true, () => {}), /待生效/u);
  const { unlink } = await import("node:fs/promises");
  await unlink(path.join(r.directory, "relay.pending.json"));
  for (const denyAt of [2, 3]) {
    let calls = 0;
    await assert.rejects(f.runtime.setEnabled(true, () => { if (++calls === denyAt) throw new Error("revoked Owner"); }), /revoked Owner/u);
    assert.equal(f.runtime.status().ready, false);
  }
  await f.runtime.setEnabled(true, () => {});
  assert.equal(f.runtime.status().error, null);
  assert.deepEqual(f.runtime.status().endpoints, status.endpoints);
});

test("managed certificates renew under the same CA and reject changed origin or damaged keys", async t => {
  const r = await createTestResources(t, "convenewire-lan-certificates-");
  const origin = "https://node.convenewire.invalid", now = Date.now();
  const first = await lanCertificates(r.directory, origin, now);
  assert.equal(new X509Certificate(first.ca).ca, true); assert.equal(new X509Certificate(first.cert).ca, false);
  assert.ok(JSON.stringify(await lanCertificates(r.directory, origin, now)) === JSON.stringify(first), "unchanged certificate bytes survive reload");
  const renewed = await lanCertificates(r.directory, origin, now + 70 * 86400_000);
  assert.equal(renewed.ca, first.ca); assert.notEqual(renewed.cert, first.cert);
  await assert.rejects(lanCertificates(r.directory, "https://different.invalid", now));
  const unpublished = await lanCertificates(r.directory, "https://unpublished.invalid", now + 70 * 86400_000, true);
  assert.equal(unpublished.ca, first.ca, "unpublished origin can adopt explicit manual/Relay setup without rotating identity");
  assert.ok(new X509Certificate(unpublished.cert).checkHost("unpublished.invalid"));
  const target = path.join(r.directory, "certificates.json"), raw = JSON.parse(await readFile(target, "utf8"));
  raw.caKey = raw.key; await writeFile(target, JSON.stringify(raw), {mode: 0o600});
  await assert.rejects(lanCertificates(r.directory, unpublished.origin, now + 70 * 86400_000));
});

test("LAN addresses never resolve DNS or admit public, loopback, IPv6 or ambiguous literals", () => {
  for (const address of ["10.1.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.254"]) assert.equal(privateLANAddress(address), true);
  for (const address of ["127.0.0.1", "8.8.8.8", "169.254.0.1", "172.32.0.1", "localhost", "192.168.01.1", "10.999.0.1", "::1", "::ffff:10.0.0.1"]) assert.equal(privateLANAddress(address), false, address);
});
