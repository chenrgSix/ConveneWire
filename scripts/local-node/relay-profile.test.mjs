import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { buildBundle, verifyBundle } from "./bundle.mjs";
import { readRelayProfile, relayProfileFilename, relayProfileOption } from "./relay-profile.mjs";
import { verifyReleaseHub } from "./release-hub.mjs";

const profile = JSON.parse(await readFile(new URL("../../packages/contracts/test/fixtures/relay.json", import.meta.url), "utf8")).profile;
const bytesFor = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("public Relay profiles use the closed contract, bounded bytes and an unchanged regular file", async t => {
  const resources = await createTestResources(t, "convenewire-relay-profile-");
  const filename = path.join(resources.directory, "service profile.json"), original = bytesFor(profile);
  await writeFile(filename, original);
  const parsed = await readRelayProfile(filename);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.profile)), profile);
  assert.deepEqual(parsed.bytes, original); assert.equal(parsed.sha256, digest(original));
  const summary = JSON.parse(execFileSync(process.execPath, ["scripts/local-node/relay-profile.mjs", filename], { encoding: "utf8" }));
  assert.deepEqual(summary, { id: profile.id, relayOrigin: profile.relayOrigin, nodeDomain: profile.nodeDomain, bytes: original.length, sha256: digest(original) });
  const invalid = [
    bytesFor({ ...profile, token: "must-not-ship" }), bytesFor({ ...profile, privateKey: "must-not-ship" }),
    bytesFor({ ...profile, enabled: true }), bytesFor({ ...profile, schemaVersion: 2 }),
    bytesFor({ ...profile, relayOrigin: "http://relay.example.test" }), bytesFor({ ...profile, relayOrigin: "https://user:secret@relay.example.test" }),
    bytesFor({ ...profile, acmeDirectoryUrl: "file:///private/account.json" }), bytesFor({ ...profile, termsUrl: "javascript:alert(1)" }),
    bytesFor({ ...profile, nodeDomain: "*.example.test" }), Buffer.from('{"id":"first",' + JSON.stringify(profile).slice(1)),
    Buffer.from(JSON.stringify(profile).replace('"schemaVersion":1', '"schemaVersion":1.000000000000000000001')),
    Buffer.from([0xc3, 0x28]), Buffer.alloc(0), Buffer.alloc(16385, 32), Buffer.from("null")
  ];
  for (const [index, bytes] of invalid.entries()) {
    await writeFile(filename, bytes); await assert.rejects(readRelayProfile(filename), /Relay|Peer/u, `invalid profile case ${index}`);
  }
  await writeFile(filename, Buffer.concat([original, Buffer.alloc(16384 - original.length, 32)]));
  assert.equal((await readRelayProfile(filename)).bytes.length, 16384);
  await assert.rejects(readRelayProfile(resources.directory), /regular file/u);
  if (process.platform !== "win32") {
    const link = path.join(resources.directory, "linked.json"); await symlink(filename, link);
    await assert.rejects(readRelayProfile(link), /symlink/u);
  }
});

test("packaging imports a profile only through an explicit option; inherited environment cannot choose one", () => {
  const environment = { CONVENE_WIRE_RELAY_PROFILE_FILE: "/operator/private/exported-profile.json" };
  assert.equal(relayProfileOption([], environment), undefined);
  assert.equal(relayProfileOption(["--relay-profile", "operator-profile.json"], environment), path.resolve("operator-profile.json"));
  assert.equal(relayProfileOption(["--relay-profile-env"], environment), path.resolve(environment.CONVENE_WIRE_RELAY_PROFILE_FILE));
  for (const args of [["--relay-profile"], ["--relay-profile", ""], ["--relay-profile", "--relay-profile-env"],
    ["--relay-profile", "a", "--relay-profile", "b"], ["--relay-profile-env", "--relay-profile", "a"], ["unknown"]]) {
    assert.throws(() => relayProfileOption(args, environment), /Select --relay-profile/u);
  }
  assert.throws(() => relayProfileOption(["--relay-profile-env"], {}), /Select --relay-profile/u);
});

test("both command entry points reject an explicitly selected invalid profile before producing a bundle or app", async t => {
  const resources = await createTestResources(t, "convenewire-relay-cli-");
  const filename = path.join(resources.directory, "invalid.json"); await writeFile(filename, bytesFor({ ...profile, token: "must-not-ship" }));
  for (const [script, args, output] of [
    ["scripts/local-node/bundle.mjs", ["build"], path.join(resources.directory, "hub")],
    ...(["darwin", "win32"].includes(process.platform) ? [["scripts/local-node/package-desktop.mjs", [], path.join(resources.directory, "desktop")]] : [])
  ]) {
    assert.throws(() => execFileSync(process.execPath, [script, ...args, output, "--relay-profile-env"], {
      encoding: "utf8", env: { ...process.env, CONVENE_WIRE_RELAY_PROFILE_FILE: filename }, stdio: "pipe"
    }), /Invalid RelayServiceProfile/u);
    const files = await readdir(output).catch(error => { if (error.code === "ENOENT") return []; throw error; });
    assert.deepEqual(files, [], "invalid profiles cannot produce archives, expanded apps or manifests");
  }
  assert.equal((await readdir(resources.directory)).some(name => name.includes(".partial-")), false);
});

async function manifestFixture(t) {
  const resources = await createTestResources(t, "convenewire-relay-inventory-");
  const root = resources.directory;
  const manifest = { schemaVersion: 1, releaseVersion: "v1.0.0", platform: process.platform, arch: process.arch,
    nodeVersion: "v22.23.1", sourceCommit: "a".repeat(40), sourceState: "clean", files: [] };
  const put = async (name, bytes) => {
    const filename = path.join(root, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    const entry = { path: name, size: bytes.length, sha256: digest(bytes) }, existing = manifest.files.findIndex(file => file.path === name);
    if (existing >= 0) manifest.files[existing] = entry; else manifest.files.push(entry);
  };
  for (const name of [process.platform === "win32" ? "bin/node.exe" : "bin/node", "apps/server/dist/server.js", "apps/server/dist/local-node.js",
    "apps/web/dist/index.html", "node_modules/better-sqlite3/package.json", "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"]) {
    await put(name, Buffer.from(`fixture ${name}`));
  }
  const save = () => writeFile(path.join(root, "hub-manifest.json"), JSON.stringify(manifest));
  await save(); return { root, manifest, put, save };
}

test("optional profiles are schema checked and fully pinned by bundle and exact release inventories", async t => {
  const f = await manifestFixture(t), original = bytesFor(profile), filename = path.join(f.root, relayProfileFilename);
  await verifyBundle(f.root);
  await f.put(relayProfileFilename, original); await f.save();
  const verified = await verifyBundle(f.root), entry = verified.files.find(file => file.path === relayProfileFilename);
  assert.equal(entry.sha256, digest(original)); assert.equal(entry.size, original.length);
  await verifyReleaseHub(f.root, f.manifest.sourceCommit, f.manifest.releaseVersion, process.platform, process.arch);
  await writeFile(filename, bytesFor({ ...profile, id: "another-service" })); await assert.rejects(verifyBundle(f.root), /digest/u);
  await writeFile(filename, original);
  f.manifest.files = f.manifest.files.filter(file => file.path !== relayProfileFilename); await f.save();
  await assert.rejects(verifyBundle(f.root), /inventory/u);
  await f.put(relayProfileFilename, original); await f.save(); await rm(filename); await assert.rejects(verifyBundle(f.root), /inventory/u);
  for (const bytes of [bytesFor({ ...profile, accountKey: "private" }), Buffer.alloc(16385, 32)]) {
    await f.put(relayProfileFilename, bytes); await f.save();
    await assert.rejects(verifyBundle(f.root), /Relay/u);
    await assert.rejects(verifyReleaseHub(f.root, f.manifest.sourceCommit, f.manifest.releaseVersion, process.platform, process.arch), /Relay/u);
  }
  await f.put(relayProfileFilename, original); await f.save();
  if (process.platform !== "win32") {
    await rm(filename); await symlink(path.join(f.root, "NOTICE"), filename); await assert.rejects(verifyBundle(f.root), /Unsupported/u);
    await rm(filename); await writeFile(filename, original);
  }
  await verifyBundle(f.root);
});

test("selected profile bytes ship in a native bundle whose Node and contracts work with empty PATH", { timeout: 120_000 }, async t => {
  const resources = await createTestResources(t, "convenewire-relay-bundle-");
  const root = resources.directory, filename = path.join(root, "selected.json"), output = path.join(root, "hub");
  const original = bytesFor(profile); await writeFile(filename, original);
  const manifest = await buildBundle(output, { relayProfileFile: filename });
  const entry = manifest.files.find(file => file.path === relayProfileFilename);
  assert.ok(entry); assert.equal(entry.size, original.length); assert.equal(entry.sha256, digest(original));
  assert.deepEqual(await readFile(path.join(output, relayProfileFilename)), original);
  assert.equal(manifest.sourceCommit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  const observed = JSON.parse(execFileSync(path.join(output, "bin", process.platform === "win32" ? "node.exe" : "node"), ["--input-type=module", "-e", `
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodePeer} from '@convene-wire/contracts/peer-validation';
const bytes=readFileSync('relay-service.json');
const value=decodePeer('RelayServiceProfile',bytes);
console.log(JSON.stringify({id:value.id,sha256:createHash('sha256').update(bytes).digest('hex')}));
`], { cwd: output, encoding: "utf8", env: { PATH: "", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) } }));
  assert.deepEqual(observed, { id: profile.id, sha256: digest(original) });
  const admitted = await verifyBundle(output); assert.equal(admitted.sourceCommit, manifest.sourceCommit);
  assert.equal(admitted.manifestSha256, digest(await readFile(path.join(output, "hub-manifest.json"))));
  assert.equal((await readdir(root)).some(name => name.includes(".partial-")), false);
  const invalidFile = path.join(root, "bad-profile.json"), failedOutput = path.join(root, "bad-hub");
  await writeFile(invalidFile, bytesFor({ ...profile, token: "private" }));
  await assert.rejects(buildBundle(failedOutput, { relayProfileFile: invalidFile }), /RelayServiceProfile/u);
  assert.equal((await readdir(root)).some(name => name.startsWith("bad-hub")), false);
});
