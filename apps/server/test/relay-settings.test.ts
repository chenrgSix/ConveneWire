import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { lstat, readFile, writeFile, symlink, link, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { RelayServiceProfile } from "@convene-wire/contracts/peer";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { applyPendingNetworkSettings, applyPendingRelay, loadRelayProfile, RelaySettings } from "../src/local-node/relay-settings.js";
import { applyPendingPeerIngress, PeerIngressSettings } from "../src/local-node/peer-ingress-settings.js";

const profile: RelayServiceProfile = {schemaVersion: 1, id: "test-relay", displayName: "Local fixture service",
  relayOrigin: "https://relay.example.test:9443", nodeDomain: "nodes.example.test",
  acmeDirectoryUrl: "https://ca.example.test/directory", termsUrl: "https://ca.example.test/terms"};
async function fixture(t: Parameters<typeof createTestResources>[0]) {
  const resources = await createTestResources(t, "convenewire-relay-settings-");
  const publicKey = generateKeyPairSync("ed25519").publicKey.export({format: "der", type: "spki"}).subarray(-32).toString("base64url");
  const settings = new RelaySettings(resources.directory, publicKey, profile);
  const selection = async (enabled = true) => {
    const {revisionDigest} = await settings.status();
    const input = {revisionDigest, enabled, termsAccepted: enabled};
    const review = await settings.review(input);
    return {review, input: {...input, reviewDigest: review.reviewDigest}};
  };
  return {root: resources.directory, publicKey, settings, selection};
}
test("Relay review explicitly approves profile/CA and exact save survives a lost response until restart", async t => {
  const f = await fixture(t), initial = await f.settings.status();
  assert.equal(initial.termsAcceptanceRequired, false);
  await assert.rejects(f.settings.review({revisionDigest: initial.revisionDigest, enabled: true, termsAccepted: false}));
  const {review, input} = await f.selection();
  assert.deepEqual(review.provider, profile);
  assert.match(review.origin, /^https:\/\/n[0-9a-f]{40}\.nodes\.example\.test:9443$/u);
  assert.equal((await f.settings.status()).pending, null);
  const receipt = await f.settings.save(input); assert.deepEqual(await f.settings.save(input), receipt);
  const staged = await f.settings.status(); assert.equal(staged.saved.enabled, false); assert.equal(staged.pending?.enabled, true);
  assert.equal(staged.running.state, "disabled"); assert.equal(JSON.stringify(staged).includes("PRIVATE KEY"), false);
  if (process.platform !== "win32") assert.equal((await lstat(path.join(f.root, "relay.pending.json"))).mode & 0o777, 0o600);
  const applied = await applyPendingRelay(f.root, f.publicKey);
  assert.equal(applied?.origin, review.origin); assert.equal(applied?.enabled, true);
  assert.deepEqual(await applyPendingRelay(f.root, f.publicKey), applied);
  assert.equal((await f.settings.status()).pending, null);
});
test("Relay revisions prevent stale competing decisions and modified reviewed input", async t => {
  const f = await fixture(t), on = await f.selection(), off = await f.selection(false);
  await f.settings.save(on.input);
  await assert.rejects(f.settings.save(off.input));
  await assert.rejects(f.settings.save({...on.input, enabled: false}));
  const state = await f.settings.status(); assert.equal(state.pending?.enabled, true);
  await assert.rejects(f.settings.discard({revisionDigest: on.input.revisionDigest}));
  await f.settings.discard({revisionDigest: state.revisionDigest}); assert.equal((await f.settings.status()).pending, null);
});
test("saved profile and origin survive a removed or changed distribution profile and remain disableable", async t => {
  const f = await fixture(t), on = await f.selection(); await f.settings.save(on.input);
  const pendingOnly = new RelaySettings(f.root, f.publicKey, null);
  assert.deepEqual({...((await pendingOnly.status()).provider)}, profile);
  await applyPendingRelay(f.root, f.publicKey);
  const changed = new RelaySettings(f.root, f.publicKey, {...profile, nodeDomain: "other.example.test"});
  const state = await changed.status(); assert.deepEqual({...state.provider}, profile);
  const choice = {revisionDigest: state.revisionDigest, enabled: false, termsAccepted: false};
  const review = await changed.review(choice); assert.equal(review.origin, on.review.origin);
  await changed.save({...choice, reviewDigest: review.reviewDigest});
  const disabled = await applyPendingRelay(f.root, f.publicKey); assert.equal(disabled?.enabled, false);
  assert.equal(disabled?.origin, on.review.origin); assert.deepEqual({...disabled?.profile}, profile);
});
test("Relay pending activation recognizes its sole config commit point after interruption", async t => {
  const f = await fixture(t), on = await f.selection(); await f.settings.save(on.input);
  const pending = JSON.parse(await readFile(path.join(f.root, "relay.pending.json"), "utf8"));
  await writeFile(path.join(f.root, "relay", "config.json"), JSON.stringify(pending.saved), {mode: 0o600});
  assert.equal((await applyPendingRelay(f.root, f.publicKey))?.origin, on.review.origin);
  assert.equal((await f.settings.status()).pending, null);
});
test("new CA terms require another explicit review while retaining the same address", async t => {
  const f = await fixture(t), on = await f.selection(); await f.settings.save(on.input); await applyPendingRelay(f.root, f.publicKey);
  const updatedProfile = {...profile, termsUrl: "https://ca.example.test/new-terms"};
  const updated = new RelaySettings(f.root, f.publicKey, updatedProfile), state = await updated.status();
  assert.equal(state.provider?.termsUrl, updatedProfile.termsUrl);
  assert.equal(state.termsAcceptanceRequired, true);
  assert.equal(state.saved.origin, on.review.origin);
  await assert.rejects(updated.review({revisionDigest: state.revisionDigest, enabled: true, termsAccepted: false}));
  const input = {revisionDigest: state.revisionDigest, enabled: true, termsAccepted: true};
  const review = await updated.review(input); await updated.save({...input, reviewDigest: review.reviewDigest});
  const applied = await applyPendingRelay(f.root, f.publicKey);
  assert.equal(applied?.profile.termsUrl, updatedProfile.termsUrl); assert.equal(applied?.origin, on.review.origin);
  assert.equal((await updated.status()).termsAcceptanceRequired, false);
});
test("Relay rejects extra input and rechecks current Owner before writing", async t => {
  const f = await fixture(t), on = await f.selection(); let authorized = 0;
  await assert.rejects(f.settings.save({...on.input, profile}));
  await assert.rejects(f.settings.save(on.input, () => { if (++authorized === 2) throw new Error("Owner retired"); }), /Owner retired/u);
  assert.equal((await f.settings.status()).pending, null);
  const unavailable = new RelaySettings(f.root, f.publicKey, null);
  await assert.rejects(unavailable.review({revisionDigest: (await unavailable.status()).revisionDigest, enabled: true, termsAccepted: true}));
});
test("pending direct ingress and fixed old origins cannot be silently switched to Relay", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "peer-ingress.pending.json"), "{}", {mode: 0o600});
  await assert.rejects(f.selection(), /手动 HTTPS/u);
  const g = await fixture(t); await mkdir(path.join(g.root, "peer-ingress"), {mode: 0o700});
  await writeFile(path.join(g.root, "peer-ingress", "config.json"), JSON.stringify({schemaVersion: 1, enabled: false,
    origin: "https://old.example.test", listenHost: "127.0.0.1", certificateFile: "cert.pem", privateKeyFile: "key.pem"}), {mode: 0o600});
  await assert.rejects(g.selection(), /已有 HTTPS/u);
});
test("manual ingress cannot replace an established Relay address", async t => {
  const f = await fixture(t), on = await f.selection(); await f.settings.save(on.input); await applyPendingRelay(f.root, f.publicKey);
  const direct = new PeerIngressSettings(f.root), {revisionDigest} = await direct.status();
  await assert.rejects(direct.review({revisionDigest, selection: {enabled: false, origin: "https://old.example.test",
    listenHost: "127.0.0.1", certificatePem: "", privateKeyPem: ""}}), /便捷接入地址/u);
});
test("Relay private config/profile refuse links, duplicate JSON and another Node key", async t => {
  const f = await fixture(t), on = await f.selection(); await f.settings.save(on.input); await applyPendingRelay(f.root, f.publicKey);
  const other = await fixture(t); await assert.rejects(applyPendingRelay(f.root, other.publicKey));
  const external = path.join(other.root, "profile.json"); await writeFile(external, JSON.stringify(profile), {mode: 0o600});
  await symlink(external, path.join(f.root, "relay-service.json")); await assert.rejects(loadRelayProfile(f.root));
  const duplicate = await fixture(t); await writeFile(path.join(duplicate.root, "relay-service.json"), '{"schemaVersion":1,"schemaVersion":1}', {mode: 0o600});
  await assert.rejects(loadRelayProfile(duplicate.root));
});

test("bundled public profile accepts regular public files but rejects links and oversized or malformed input", async t => {
  const f = await fixture(t), bundle = await fixture(t), file = path.join(bundle.root, "relay-service.json");
  assert.equal(await loadRelayProfile(f.root, file), null);
  await writeFile(file, JSON.stringify(profile), {mode: 0o644});
  assert.deepEqual({...await loadRelayProfile(f.root, file)}, profile);
  const hardlink = path.join(bundle.root, "linked.json"); await link(file, hardlink);
  await assert.rejects(loadRelayProfile(f.root, hardlink)); await assert.rejects(loadRelayProfile(f.root, file));
  await unlink(hardlink); await symlink(file, hardlink); await assert.rejects(loadRelayProfile(f.root, hardlink));
  await assert.rejects(loadRelayProfile(f.root, bundle.root));
  const raw = JSON.stringify(profile);
  await writeFile(file, raw.padEnd(16 * 1024)); assert.deepEqual({...await loadRelayProfile(f.root, file)}, profile);
  await writeFile(file, raw.padEnd(16 * 1024 + 1)); await assert.rejects(loadRelayProfile(f.root, file));
  await writeFile(file, JSON.stringify({...profile, privateKey: "forbidden"})); await assert.rejects(loadRelayProfile(f.root, file));
});

const manualDisabled = (origin: string) => ({enabled: false, origin, listenHost: "127.0.0.1", certificatePem: "", privateKeyPem: ""});
async function reviewManual(settings: PeerIngressSettings, selection: ReturnType<typeof manualDisabled>, now?: Date) {
  const {revisionDigest} = await settings.status(), review = await settings.review({revisionDigest, selection}, now);
  return {revisionDigest, reviewDigest: review.reviewDigest, selection};
}

test("a disabled manual decision cannot reserve another origin while Relay is pending", async t => {
  for (const enabled of [false, true]) {
    const f = await fixture(t), direct = new PeerIngressSettings(f.root);
    const input = await reviewManual(direct, manualDisabled("https://different.example.test"));
    const relay = await f.selection(enabled); await f.settings.save(relay.input);
    await assert.rejects(direct.review({revisionDigest: (await direct.status()).revisionDigest, selection: input.selection}), /便捷接入/u);
    await assert.rejects(direct.save(input), /便捷接入/u);
    await assert.rejects(readFile(path.join(f.root, "peer-ingress.pending.json")), {code: "ENOENT"});
    assert.equal((await applyPendingNetworkSettings(f.root, f.publicKey))?.enabled, enabled);
  }
});

test("a disabled Relay decision cannot reserve another origin while manual ingress is pending or saved", async t => {
  const f = await fixture(t), relay = await f.selection(false), direct = new PeerIngressSettings(f.root);
  const input = await reviewManual(direct, manualDisabled("https://different.example.test")); await direct.save(input);
  await assert.rejects(f.selection(false), /手动 HTTPS/u);
  await assert.rejects(f.settings.save(relay.input));
  await applyPendingNetworkSettings(f.root, f.publicKey);
  await assert.rejects(f.selection(false), /已有 HTTPS/u);
  assert.equal((await f.settings.status()).pending, null);
});

test("competing enabled Relay and manual saves serialize across service instances in either order", async t => {
  const certificatePem = await readFile(new URL("./fixtures/peer-ingress/server-cert.pem", import.meta.url), "utf8");
  const privateKeyPem = await readFile(new URL("./fixtures/peer-ingress/server-key.pem", import.meta.url), "utf8");
  const now = new Date(Date.parse(new X509Certificate(certificatePem).validFrom) + 60_000);
  for (const relayFirst of [true, false]) {
    const f = await fixture(t), direct = new PeerIngressSettings(f.root);
    const relay = await f.selection(), manual = await reviewManual(direct,
      {enabled: true, origin: "https://localhost:9443", listenHost: "127.0.0.1", certificatePem, privateKeyPem}, now);
    const relaySave = () => new RelaySettings(f.root, f.publicKey, profile).save(relay.input);
    const directSave = () => new PeerIngressSettings(path.join(f.root, ".")).save(manual, now);
    const results = await Promise.allSettled(relayFirst ? [relaySave(), directSave()] : [directSave(), relaySave()]);
    assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
    assert.equal((await f.settings.status()).pending?.enabled ?? false, relayFirst);
    assert.equal((await direct.status()).pending?.enabled ?? false, !relayFirst);
    const applied = await applyPendingNetworkSettings(f.root, f.publicKey, now);
    assert.equal(applied?.enabled ?? false, relayFirst);
  }
});

test("both revisions include the other mode and stale review, save or discard cannot change a decision", async t => {
  const f = await fixture(t), direct = new PeerIngressSettings(f.root), relayOff = await f.selection(false);
  const manual = await reviewManual(direct, manualDisabled(relayOff.review.origin));
  const directBefore = await direct.status(); await f.settings.save(relayOff.input);
  const directAfter = await direct.status(); assert.notEqual(directAfter.revisionDigest, directBefore.revisionDigest);
  await assert.rejects(direct.review({revisionDigest: manual.revisionDigest, selection: manual.selection}));
  await assert.rejects(direct.save(manual));
  await assert.rejects(direct.discard({revisionDigest: directBefore.revisionDigest}));
  const relayBefore = await f.settings.status(), relayOn = await f.selection();
  const refreshedManual = await reviewManual(direct, manual.selection); await direct.save(refreshedManual);
  assert.notEqual((await f.settings.status()).revisionDigest, relayBefore.revisionDigest);
  await assert.rejects(f.settings.review({revisionDigest: relayOn.input.revisionDigest, enabled: true, termsAccepted: true}));
  await assert.rejects(f.settings.save(relayOn.input));
  await assert.rejects(f.settings.discard({revisionDigest: relayBefore.revisionDigest}));
  // A lost response for the identical existing pending commit still returns its
  // receipt, without overwriting either mode's newer compatible decision.
  assert.equal((await f.settings.save(relayOff.input)).reviewDigest, relayOff.review.reviewDigest);
  assert.equal((await direct.save(refreshedManual)).reviewDigest, refreshedManual.reviewDigest);
  assert.equal((await f.settings.status()).pending?.enabled, false);
  assert.equal((await direct.status()).pending?.enabled, false);
});

test("joint startup rejects previously staged conflicting origins before either config pointer changes", async t => {
  const f = await fixture(t), relay = await f.selection(); await f.settings.save(relay.input);
  const other = await fixture(t), direct = new PeerIngressSettings(other.root);
  const manual = await reviewManual(direct, manualDisabled("https://different.example.test")); await direct.save(manual);
  const stagedDirect = await readFile(path.join(other.root, "peer-ingress.pending.json"));
  await writeFile(path.join(f.root, "peer-ingress.pending.json"), stagedDirect, {mode: 0o600});
  const stagedRelay = await readFile(path.join(f.root, "relay.pending.json"));
  await assert.rejects(applyPendingNetworkSettings(f.root, f.publicKey), /便捷接入/u);
  await assert.rejects(readFile(path.join(f.root, "peer-ingress", "config.json")), {code: "ENOENT"});
  await assert.rejects(readFile(path.join(f.root, "relay", "config.json")), {code: "ENOENT"});
  assert.deepEqual(await readFile(path.join(f.root, "peer-ingress.pending.json")), stagedDirect);
  assert.deepEqual(await readFile(path.join(f.root, "relay.pending.json")), stagedRelay);
});

test("joint startup validates both base digests before applying a compatible first plan", async t => {
  const f = await fixture(t), relay = await f.selection(false); await f.settings.save(relay.input);
  const direct = new PeerIngressSettings(f.root), manual = await reviewManual(direct, manualDisabled(relay.review.origin)); await direct.save(manual);
  const file = path.join(f.root, "relay.pending.json"), staged = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({...staged, baseDigest: "0".repeat(64)}));
  await assert.rejects(applyPendingNetworkSettings(f.root, f.publicKey));
  await assert.rejects(readFile(path.join(f.root, "peer-ingress", "config.json")), {code: "ENOENT"});
  assert.ok(await readFile(path.join(f.root, "peer-ingress.pending.json")));
  await writeFile(file, JSON.stringify(staged));
  assert.equal((await applyPendingNetworkSettings(f.root, f.publicKey))?.origin, relay.review.origin);
});

test("joint startup recovers an interrupted first commit and recognizes both committed pointers", async t => {
  const f = await fixture(t), relay = await f.selection(false); await f.settings.save(relay.input);
  const direct = new PeerIngressSettings(f.root), manual = await reviewManual(direct, manualDisabled(relay.review.origin)); await direct.save(manual);
  const directFile = path.join(f.root, "peer-ingress.pending.json"), relayFile = path.join(f.root, "relay.pending.json");
  const stagedDirect = await readFile(directFile), stagedRelay = await readFile(relayFile);
  await applyPendingPeerIngress(f.root);
  await writeFile(directFile, stagedDirect, {mode: 0o600});
  assert.equal((await applyPendingNetworkSettings(f.root, f.publicKey))?.origin, relay.review.origin);
  await writeFile(directFile, stagedDirect, {mode: 0o600}); await writeFile(relayFile, stagedRelay, {mode: 0o600});
  assert.equal((await applyPendingNetworkSettings(f.root, f.publicKey))?.enabled, false);
  assert.equal((await f.settings.status()).pending, null); assert.equal((await direct.status()).pending, null);
  assert.equal((await direct.status()).saved?.origin, relay.review.origin);
});

test("Relay profile files reject non-integer wire lexemes before JavaScript rounding", async t => {
  const f = await fixture(t), file = path.join(f.root, "relay-service.json");
  for (const number of ["1.00000000000000001", "0.99999999999999999"]) {
    await writeFile(file, JSON.stringify(profile).replace('"schemaVersion":1', '"schemaVersion":' + number), {mode: 0o600});
    await assert.rejects(loadRelayProfile(f.root));
  }
});
