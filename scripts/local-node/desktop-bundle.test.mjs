import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir, writeFile, rm} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {createTestResources} from "../test/resources.mjs";
import {nodeDistributionLicense, verifyBundle} from "./bundle.mjs";
import {assertDesktopHubIdentity} from "./desktop-bundle.mjs";
import {verifyReleaseHub} from "./release-hub.mjs";

test("native Node license discovery supports Windows and bin-directory distributions without accepting a project license", async t => {
  const resources = await createTestResources(t, "convenewire-node-license-");
  const windows = path.join(resources.directory, "windows"), unix = path.join(resources.directory, "unix");
  await mkdir(windows); await mkdir(path.join(unix, "bin"), {recursive: true});
  const license = "Node.js distribution fixture\nPermission is hereby granted";
  await writeFile(path.join(windows, "LICENSE"), license); await writeFile(path.join(unix, "LICENSE"), license);
  assert.equal(await nodeDistributionLicense(path.join(windows, "node.exe")), license);
  assert.equal(await nodeDistributionLicense(path.join(unix, "bin", "node")), license);
  const unrelated = path.join(resources.directory, "unrelated-license"); await writeFile(unrelated, "Project license");
  await assert.rejects(nodeDistributionLicense(path.join(windows, "node.exe"), unrelated), /Node distribution LICENSE/u);
  await assert.rejects(nodeDistributionLicense(path.join(resources.directory, "missing", "node.exe")), /Node distribution LICENSE/u);
});

test("release inspection accepts the declared foreign target without changing native admission and checks all bytes", async t => {
  const resources = await createTestResources(t, "convenewire-release-hub-");
  const directory = resources.directory, source = "a".repeat(40), version = "v1.0.0-rc.1";
  const platform = process.platform === "win32" ? "darwin" : "win32", arch = platform === "win32" ? "x64" : "arm64";
  const manifest = {schemaVersion: 1, platform, arch, nodeVersion: "v22.23.1", releaseVersion: version,
    sourceCommit: source, sourceState: "clean", files: []};
  for (const name of [platform === "win32" ? "bin/node.exe" : "bin/node", "apps/server/dist/server.js",
    "apps/server/dist/local-node.js", "apps/web/dist/index.html", "node_modules/better-sqlite3/package.json",
    "node_modules/@convene-wire/contracts/package.json", "NODE-LICENSE", "LICENSE", "NOTICE"]) {
    const content = Buffer.from(`fixture ${name}`), file = path.join(directory, name);
    await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, content);
    manifest.files.push({path: name, size: content.length, sha256: createHash("sha256").update(content).digest("hex")});
  }
  const manifestPath = path.join(directory, "hub-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  await verifyReleaseHub(directory, source, version, platform, arch);
  await assert.rejects(verifyBundle(directory), /incompatible/u);
  await assert.rejects(verifyReleaseHub(directory, source, version, platform, "wrong"), /target/u);
  await assert.rejects(verifyReleaseHub(directory, "b".repeat(40), version, platform, arch), /identities/u);
  await assert.rejects(verifyReleaseHub(directory, source, "v1.0.0", platform, arch), /identities/u);
  await writeFile(path.join(directory, "unexpected"), "extra");
  await assert.rejects(verifyReleaseHub(directory, source, version, platform, arch), /inventory/u);
  await rm(path.join(directory, "unexpected"));
  await writeFile(manifestPath, JSON.stringify({...manifest, sourceState: "modified"}));
  await assert.rejects(verifyReleaseHub(directory, source, version, platform, arch), /clean/u);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path.join(directory, "apps/web/dist/index.html"), "tampered");
  await assert.rejects(verifyReleaseHub(directory, source, version, platform, arch), /digest/u);
});

test("desktop ZIP preflight rejects paths that could escape, collide or change type before extraction", async t => {
  const resources = await createTestResources(t, "convenewire-release-zip-");
  const fixture = path.join(resources.directory, "fixture.zip");
  const python = process.platform === "win32" ? "python" : "python3";
  const verifier = new URL("./verify-desktop-zip.py", import.meta.url);
  const make = (members) => execFileSync(python, ["-c", `import sys,json,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 for name, mode in json.loads(sys.argv[2]):
  i=zipfile.ZipInfo(name); i.external_attr=mode<<16; z.writestr(i, 'fixture')
`, fixture, JSON.stringify(members)], {stdio: "pipe"});
  const inspect = () => execFileSync(python, [fileURLToPath(verifier), fixture, "package"], {stdio: "pipe"});
  make([["package/hub/a", 0o100644]]); inspect();
  for (const members of [
    [["package/../escape", 0]], [["/package/a", 0]], [["package/a\\b", 0]], [["package/a:b", 0]],
    [["other/a", 0]], [["package/a", 0], ["package/a", 0]], [["package/A", 0], ["package/a", 0]],
    [["package/a", 0o120777]], [["package/a", 0o040755]], [["package/a", 0], ["package/a/b", 0]]
  ]) { make(members); assert.throws(inspect, /ZIP/u); }
});

test("desktop Hub admission requires the exact release and commit and forbids modified release payloads", () => {
  const source = "a".repeat(40), manifest = {sourceCommit: source, releaseVersion: "v1.0.0-rc.1", sourceState: "clean"};
  assertDesktopHubIdentity(manifest, source, manifest.releaseVersion);
  for (const changed of [{sourceCommit: "b".repeat(40)}, {releaseVersion: "v1.0.0"}, {sourceState: "modified"}]) {
    assert.throws(() => assertDesktopHubIdentity({...manifest, ...changed}, source, manifest.releaseVersion));
  }
  assert.throws(() => assertDesktopHubIdentity(manifest, "HEAD", manifest.releaseVersion));
  assertDesktopHubIdentity({...manifest, releaseVersion: "v0.0.0-local", sourceState: "modified"}, source, "v0.0.0-local");
});
