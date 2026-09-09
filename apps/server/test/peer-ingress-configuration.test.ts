import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { loadPeerIngressMaterial, parsePeerIngressConfiguration, validatePeerIngressCertificate } from "../src/local-node/peer-ingress-configuration.js";

const ingressCertificateDirectory = new URL("./fixtures/peer-ingress/", import.meta.url);
const configuration = { schemaVersion: 1 as const, enabled: true, origin: "https://localhost:9443", listenHost: "127.0.0.1",
  certificateFile: "server-cert.pem", privateKeyFile: "server-key.pem" };

async function fixture(t: Parameters<typeof createTestResources>[0]) {
  const resources = await createTestResources(t, "convenewire-peer-ingress-config-");
  const directory = path.join(resources.directory, "peer-ingress");
  await mkdir(directory, { mode: 0o700 });
  for (const name of ["server-cert.pem", "server-key.pem"]) {
    await copyFile(new URL(name, ingressCertificateDirectory), path.join(directory, name));
    await chmod(path.join(directory, name), 0o600);
  }
  await writeFile(path.join(directory, "config.json"), JSON.stringify(configuration), { mode: 0o600 });
  const cert = await readFile(path.join(directory, configuration.certificateFile));
  const now = new Date(Date.parse(new X509Certificate(cert).validFrom) + 60_000);
  return { root: resources.directory, directory, cert, now };
}

test("Peer ingress loads only explicit private configuration and disabled mode does not read keys", async t => {
  const empty = await createTestResources(t, "convenewire-peer-ingress-absent-");
  assert.equal(await loadPeerIngressMaterial(empty.directory), undefined);
  const f = await fixture(t), loaded = await loadPeerIngressMaterial(f.root, f.now);
  assert.deepEqual(loaded?.configuration, configuration); assert.ok(loaded?.tls?.key.length);
  await writeFile(path.join(f.directory, "config.json"), JSON.stringify({ ...configuration, enabled: false }));
  await writeFile(path.join(f.directory, "server-key.pem"), "unavailable while disabled");
  const disabled = await loadPeerIngressMaterial(f.root, f.now);
  assert.equal(disabled?.configuration.origin, configuration.origin); assert.equal(disabled?.tls, undefined);
  await mkdir(path.join(empty.directory, "peer-ingress"), { mode: 0o700 });
  await assert.rejects(loadPeerIngressMaterial(empty.directory), /invalid/u);
});

test("Peer ingress rejects ambiguous origins, path traversal, DNS listener substitution and Device settings", () => {
  for (const change of [
    { origin: "http://localhost:9443" }, { origin: "https://localhost:9443/" }, { origin: "https://user:password@localhost:9443" },
    { origin: "https://localhost:9443/path" }, { origin: "https://localhost:9443?token=private" }, { origin: "https://LOCALHOST:9443" },
    { origin: "https://localhost:0443" }, { listenHost: "localhost" }, { certificateFile: "../other.pem" },
    { privateKeyFile: "/private/key.pem" }, { privateKeyFile: "server-cert.pem" }, { deviceId: "device_other001" }
  ]) assert.throws(() => parsePeerIngressConfiguration({ ...configuration, ...change }), /invalid/u);
  assert.equal(parsePeerIngressConfiguration({ ...configuration, origin: "https://[::1]:9443", listenHost: "::" }).listenHost, "::");
});

test("Peer ingress rejects duplicate JSON fields, symlinks, oversized files and loose permissions", async t => {
  const f = await fixture(t), target = path.join(f.directory, "config.json");
  await writeFile(target, JSON.stringify(configuration).replace('"enabled":true', '"enabled":false,"enabled":true'));
  await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
  await writeFile(target, " ".repeat(4097));
  await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
  await writeFile(target, JSON.stringify(configuration));
  if (process.platform !== "win32") {
    await chmod(target, 0o644);
    await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
    await chmod(target, 0o600);
    await chmod(f.directory, 0o755);
    await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
    await chmod(f.directory, 0o700);
    await symlink(path.join(f.directory, "server-key.pem"), path.join(f.directory, "linked.pem"));
    await writeFile(target, JSON.stringify({ ...configuration, privateKeyFile: "linked.pem" }));
    await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
  }
});

test("TLS identity requires matching SAN, private key and validity independently of Node-key pins", async t => {
  const f = await fixture(t), key = await readFile(path.join(f.directory, "server-key.pem"));
  validatePeerIngressCertificate(configuration, f.cert, key, f.now);
  validatePeerIngressCertificate({ ...configuration, origin: "https://127.0.0.1:9443" }, f.cert, key, f.now);
  assert.throws(() => validatePeerIngressCertificate({ ...configuration, origin: "https://other.test:9443" }, f.cert, key, f.now), /invalid/u);
  const differentKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => validatePeerIngressCertificate(configuration, f.cert, Buffer.from(differentKey), f.now), /invalid/u);
  const cert = new X509Certificate(f.cert);
  for (const now of [new Date(Date.parse(cert.validFrom) - 1), new Date(cert.validTo)]) {
    assert.throws(() => validatePeerIngressCertificate(configuration, f.cert, key, now), /invalid/u);
  }
  await writeFile(path.join(f.directory, "server-key.pem"), "x".repeat(16 * 1024 + 1));
  await assert.rejects(loadPeerIngressMaterial(f.root, f.now), /invalid/u);
});
