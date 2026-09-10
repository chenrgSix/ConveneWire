import assert from "node:assert/strict";
import { chmod, lstat, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { applyPendingPeerIngress, PeerIngressSettings } from "../src/local-node/peer-ingress-settings.js";
import { loadPeerIngressMaterial } from "../src/local-node/peer-ingress-configuration.js";
import { nativePeerIngressFixture } from "./helpers/native-peer-ingress-fixture.js";

async function fixture(t: Parameters<typeof createTestResources>[0]) {
  const resources = await createTestResources(t, "convenewire-peer-network-settings-");
  const certificatePem = await readFile(new URL("./fixtures/peer-ingress/server-cert.pem", import.meta.url), "utf8");
  const privateKeyPem = await readFile(new URL("./fixtures/peer-ingress/server-key.pem", import.meta.url), "utf8");
  const certificate = new X509Certificate(certificatePem), now = new Date(Date.parse(certificate.validFrom) + 60_000);
  const settings = new PeerIngressSettings(resources.directory);
  const selection = {enabled: true, origin: "https://localhost:9443", listenHost: "127.0.0.1", certificatePem, privateKeyPem};
  const save = async (value = selection, instant = now) => {
    const {revisionDigest} = await settings.status(), review = await settings.review({revisionDigest, selection: value}, instant);
    const input = {revisionDigest, reviewDigest: review.reviewDigest, selection: value};
    return {input, result: await settings.save(input, instant)};
  };
  return {root: resources.directory, settings, selection, save, now, certificate};
}

test("network review and exact save retry remain private pending state until native startup", async t => {
  const f = await fixture(t), before = await f.settings.status();
  assert.equal(before.running, null); assert.equal(before.saved, null); assert.equal(before.pending, null);
  const review = await f.settings.review({revisionDigest: before.revisionDigest, selection: f.selection}, f.now);
  assert.deepEqual(await readdir(f.root), []); assert.equal(review.certificateFingerprint, f.certificate.fingerprint256);
  assert.equal(JSON.stringify(review).includes(f.selection.privateKeyPem), false);
  const {input, result} = await f.save(); assert.deepEqual(await f.settings.save(input, f.now), result);
  assert.deepEqual(await readdir(f.root), ["peer-ingress.pending.json"]);
  const view = await f.settings.status(); assert.equal(view.running, null); assert.equal(view.saved, null); assert.equal(view.pending?.enabled, true);
  assert.equal(JSON.stringify(view).includes("PRIVATE KEY"), false);
  if (process.platform !== "win32") assert.equal((await lstat(path.join(f.root, "peer-ingress.pending.json"))).mode & 0o777, 0o600);
  await applyPendingPeerIngress(f.root, f.now);
  const material = await loadPeerIngressMaterial(f.root, f.now); assert.ok(material?.tls); assert.equal(material.configuration.origin, f.selection.origin);
  const reopened = new PeerIngressSettings(f.root, material), state = await reopened.status();
  assert.equal(state.pending, null); assert.equal(state.running?.enabled, true); assert.equal(state.running?.certificateFingerprint, review.certificateFingerprint);
  assert.equal(state.saved?.origin, f.selection.origin);
});

test("concurrent review, changed selection and changed active files cannot replace another decision", async t => {
  const f = await fixture(t), {revisionDigest} = await f.settings.status();
  const a = await f.settings.review({revisionDigest, selection: f.selection}, f.now);
  const other = {...f.selection, listenHost: "0.0.0.0"};
  const b = await f.settings.review({revisionDigest, selection: other}, f.now);
  await assert.rejects(f.settings.save({revisionDigest, reviewDigest: a.reviewDigest, selection: other}, f.now));
  const results = await Promise.allSettled([f.settings.save({revisionDigest, reviewDigest: a.reviewDigest, selection: f.selection}, f.now),
    f.settings.save({revisionDigest, reviewDigest: b.reviewDigest, selection: other}, f.now)]);
  assert.deepEqual(results.map(value => value.status), ["fulfilled", "rejected"]);
  await applyPendingPeerIngress(f.root, f.now);
  await f.save({...f.selection, enabled: false, certificatePem: "", privateKeyPem: ""});
  const file = path.join(f.root, "peer-ingress", "config.json"), active = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({...active, listenHost: "0.0.0.0"}));
  await assert.rejects(applyPendingPeerIngress(f.root, f.now));
  assert.equal(JSON.parse(await readFile(file, "utf8")).enabled, true);
});

test("restart recognizes a committed pointer and disabling preserves old material without changing origin", async t => {
  const f = await fixture(t); await f.save();
  const file = path.join(f.root, "peer-ingress.pending.json"), retained = await readFile(file);
  await applyPendingPeerIngress(f.root, f.now);
  const material = (await loadPeerIngressMaterial(f.root, f.now))!, oldFiles = await readdir(path.join(f.root, "peer-ingress"));
  await writeFile(file, retained, {mode: 0o600}); await applyPendingPeerIngress(f.root, f.now);
  assert.deepEqual(await readdir(path.join(f.root, "peer-ingress")), oldFiles);
  const live = new PeerIngressSettings(f.root, material), status = await live.status();
  await assert.rejects(live.review({revisionDigest: status.revisionDigest, selection: {...f.selection, origin: "https://127.0.0.1:9443"}}, f.now), /地址/u);
  await f.save({...f.selection, enabled: false, certificatePem: "", privateKeyPem: ""});
  assert.equal((await live.status()).running?.enabled, true);
  await applyPendingPeerIngress(f.root, f.now);
  const disabled = await loadPeerIngressMaterial(f.root, f.now); assert.equal(disabled?.configuration.enabled, false); assert.equal(disabled.tls, undefined);
  for (const name of oldFiles) assert.ok(await lstat(path.join(f.root, "peer-ingress", name)));
});

test("expired staged certificates cannot activate but remain visible and explicitly discardable", async t => {
  const f = await fixture(t); await f.save();
  await assert.rejects(applyPendingPeerIngress(f.root, new Date(f.certificate.validTo)));
  assert.equal((await f.settings.status()).pending?.certificateExpiresAt, new Date(f.certificate.validTo).toISOString());
  assert.deepEqual(await readdir(f.root), ["peer-ingress.pending.json"]);
  await f.settings.discard({revisionDigest: (await f.settings.status()).revisionDigest});
  assert.deepEqual(await readdir(f.root), []);
});

test("network settings reject scope changes, malformed keys, duplicate fields and unsafe private files", async t => {
  const f = await fixture(t), {revisionDigest} = await f.settings.status();
  for (const change of [{origin: "http://localhost:9443"}, {origin: "https://localhost:9443?token=secret"}, {listenHost: "localhost"},
    {privateKeyPem: "broken key"}, {enabled: "true"}, {nodeId: "node_other001"}, {certificateFile: "../secret.pem"}, {enabled: false}]) {
    await assert.rejects(f.settings.review({revisionDigest, selection: {...f.selection, ...change}}, f.now));
  }
  await f.save();
  const file = path.join(f.root, "peer-ingress.pending.json"), raw = await readFile(file, "utf8");
  await writeFile(file, raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'));
  await assert.rejects(applyPendingPeerIngress(f.root, f.now));
  await writeFile(file, raw);
  if (process.platform !== "win32") {
    await chmod(file, 0o644); await assert.rejects(f.settings.status()); await chmod(file, 0o600);
    await f.settings.discard({revisionDigest: (await f.settings.status()).revisionDigest});
    const outside = path.join(f.root, "unrelated.json"); await writeFile(outside, raw, {mode: 0o600}); await symlink(outside, file);
    await assert.rejects(f.settings.status()); assert.equal(await readFile(outside, "utf8"), raw);
  }
});

test("network save rechecks Owner authority after asynchronous file reads", async t => {
  const f = await fixture(t), {revisionDigest} = await f.settings.status();
  const review = await f.settings.review({revisionDigest, selection: f.selection}, f.now);
  let checks = 0;
  await assert.rejects(f.settings.save({revisionDigest, reviewDigest: review.reviewDigest, selection: f.selection}, f.now, () => { if (++checks > 1) throw new Error("Owner session ended"); }), /Owner/u);
  assert.equal(checks, 2); assert.deepEqual(await readdir(f.root), []);
});

test("actual native HTTP settings require fixed local Owner and remain unreachable over Peer HTTPS", async t => {
  const f = await fixture(t), host = await nativePeerIngressFixture(t, {peerIngressSettings: f.settings});
  const base = "/api/local-node/network", owner = host.ownerHeaders;
  for (const headers of [{host: owner.host}, {...owner, origin: "https://foreign.example"}, {...owner, "sec-fetch-site": "cross-site"}]) {
    assert.ok([401, 403].includes((await host.app.inject({url: base, headers})).statusCode));
  }
  assert.equal((await host.request(base, {headers: {authorization: owner.authorization}})).status, 403);
  const initial = await host.app.inject({url: base, headers: owner}); assert.equal(initial.statusCode, 200); assert.equal(initial.headers["cache-control"], "no-store");
  const {revisionDigest} = initial.json();
  const raw = JSON.stringify({revisionDigest, selection: f.selection});
  const ambiguous = await host.app.inject({method: "POST", url: `${base}/review`, headers: {...owner, "content-type": "application/json"}, payload: raw.replace('"enabled":true', '"enabled":false,"enabled":true')});
  assert.equal(ambiguous.statusCode, 400); assert.equal(ambiguous.body.includes("PRIVATE KEY"), false);
  const reviewed = await host.app.inject({method: "POST", url: `${base}/review`, headers: owner, payload: {revisionDigest, selection: f.selection}});
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const saved = await host.app.inject({method: "POST", url: `${base}/save`, headers: owner, payload: {revisionDigest, selection: f.selection, reviewDigest: reviewed.json().reviewDigest}});
  assert.equal(saved.statusCode, 200, saved.body); assert.equal(saved.body.includes("PRIVATE KEY"), false);
  assert.equal((await host.app.inject({url: base, headers: owner})).json().saved, null);
});
