import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodePeer, validatePeer } from "../src/peer-validation.mjs";
import { relayHostname, relayRegistrationTranscript } from "../src/relay-proof.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/relay.json", import.meta.url)));
const privateKey = createPrivateKey({ key: Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(fixture.seed, "hex")
]), type: "pkcs8", format: "der" });
const publicKey = createPublicKey(privateKey);
const args = [fixture.relayOrigin, fixture.nodeDomain, fixture.nonce, fixture.nodeId, fixture.publicKey];

test("Relay closed schemas preserve exact HTTPS, DNS, version and canonical token bounds", () => {
  for (const entry of fixture.cases) assert.equal(validatePeer(entry.kind, entry.value), entry.valid, entry.description);
  for (const entry of fixture.raw) {
    if (entry.valid) assert.ok(decodePeer(entry.kind, entry.raw));
    else assert.throws(() => decodePeer(entry.kind, entry.raw));
  }
  assert.throws(() => decodePeer("RelayOpen", new Uint8Array([0xff])));
  assert.throws(() => decodePeer("RelayOpen", " ".repeat(4 * 1024 * 1024)));
  // Relay registration is transport possession, never a Peer admission carrier.
  assert.equal(validatePeer("PeerControlMessage", fixture.register), false);
  assert.equal(validatePeer("PeerControlMessage", fixture.profile), false);
});

test("Relay registration signs every service, challenge and identity pin; address hashes raw key bytes", () => {
  assert.equal(fixture.publicKey, "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo");
  const transcript = relayRegistrationTranscript(...args);
  assert.equal(Buffer.from(transcript).toString(), fixture.transcript);
  assert.equal(sign(null, transcript, privateKey).toString("base64url"), fixture.signature);
  assert.equal(relayHostname(fixture.publicKey, fixture.nodeDomain), fixture.hostname);
  assert.ok(verify(null, transcript, publicKey, Buffer.from(fixture.signature, "base64url")));
  const changed = ["https://other.example.test", "other.example.test", "A".repeat(43), "node_otherfixture1", "A".repeat(43)];
  for (let index = 0; index < args.length; index++) {
    const next = [...args]; next[index] = changed[index];
    assert.equal(verify(null, relayRegistrationTranscript(...next), publicKey, Buffer.from(fixture.signature, "base64url")), false, `pin ${index}`);
  }
  assert.notEqual(relayHostname(changed[4], fixture.nodeDomain), fixture.hostname);
  for (const entry of fixture.cases.filter(item => !item.valid && item.kind === "RelayNodeDomain")) {
    assert.throws(() => relayHostname(fixture.publicKey, entry.value), entry.description);
    assert.throws(() => relayRegistrationTranscript(args[0], entry.value, ...args.slice(2)), entry.description);
  }
  for (const entry of fixture.cases.filter(item => !item.valid && item.kind === "RelayHTTPSOrigin")) {
    assert.throws(() => relayRegistrationTranscript(entry.value, ...args.slice(1)), entry.description);
  }
  for (const key of [fixture.publicKey + "=", fixture.publicKey.slice(0, -1) + "B", "A".repeat(42), "A".repeat(44)]) {
    assert.throws(() => relayHostname(key, fixture.nodeDomain));
    assert.throws(() => relayRegistrationTranscript(...args.slice(0, 4), key));
  }
  assert.throws(() => relayRegistrationTranscript(...args.slice(0, 3), "node_inject\nvalue", args[4]));
  assert.throws(() => relayRegistrationTranscript(args[0], args[1], fixture.nonce + "=", args[3], args[4]));
});

test("actual Go decoder, address and signature bytes interoperate with Node including negative pins", () => {
  const cases = fixture.cases.map(entry => ({ action: "decode", kind: entry.kind, raw: JSON.stringify(entry.value), valid: entry.valid }));
  cases.push(...fixture.raw.map(entry => ({ action: "decode", ...entry })));
  const base = { action: "proof", relayOrigin: args[0], nodeDomain: args[1], nonce: args[2], nodeId: args[3], publicKey: args[4], signature: fixture.signature, seed: fixture.seed, valid: true };
  const proofCases = [base];
  for (const [field, changed] of Object.entries({ relayOrigin: "https://other.example.test", nodeDomain: "other.example.test", nonce: "A".repeat(43), nodeId: "node_otherfixture1", publicKey: "A".repeat(43) })) {
    proofCases.push({ ...base, [field]: changed });
  }
  for (const [field, changed] of Object.entries({ relayOrigin: "https://Relay.example.test", nodeDomain: "nodes.example.test.", nonce: fixture.nonce + "=", nodeId: "node_break\nvalue", publicKey: fixture.publicKey.slice(0, -1) + "B" })) {
    proofCases.push({ ...base, [field]: changed, valid: false });
  }
  cases.push(...proofCases);
  const result = spawnSync("go", ["run", "./test/interop-relay"], {
    cwd: new URL("../", import.meta.url), input: cases.map(value => JSON.stringify(value)).join("\n") + "\n",
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 120000
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.trim().split("\n").map(value => JSON.parse(value));
  assert.equal(output.length, cases.length);
  for (let index = 0; index < cases.length; index++) {
    const entry = cases[index], actual = output[index];
    assert.equal(actual.valid, entry.valid, JSON.stringify(entry));
    if (entry.action !== "proof" || !entry.valid) continue;
    const transcript = relayRegistrationTranscript(entry.relayOrigin, entry.nodeDomain, entry.nonce, entry.nodeId, entry.publicKey);
    assert.equal(actual.transcript, Buffer.from(transcript).toString());
    assert.equal(actual.hostname, relayHostname(entry.publicKey, entry.nodeDomain));
    assert.equal(actual.signatureValid, entry === base);
    assert.equal(actual.signature, sign(null, transcript, privateKey).toString("base64url"));
    assert.ok(verify(null, transcript, publicKey, Buffer.from(actual.signature, "base64url")));
  }
});
