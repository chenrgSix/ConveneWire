import assert from "node:assert/strict";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {createTestResources} from "../test/resources.mjs";
import {nodeDistributionLicense} from "./bundle.mjs";
import {assertDesktopHubIdentity} from "./desktop-bundle.mjs";

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

test("desktop Hub admission requires the exact release and commit and forbids modified release payloads", () => {
  const source = "a".repeat(40), manifest = {sourceCommit: source, releaseVersion: "v1.0.0-rc.1", sourceState: "clean"};
  assertDesktopHubIdentity(manifest, source, manifest.releaseVersion);
  for (const changed of [{sourceCommit: "b".repeat(40)}, {releaseVersion: "v1.0.0"}, {sourceState: "modified"}]) {
    assert.throws(() => assertDesktopHubIdentity({...manifest, ...changed}, source, manifest.releaseVersion));
  }
  assert.throws(() => assertDesktopHubIdentity(manifest, "HEAD", manifest.releaseVersion));
  assertDesktopHubIdentity({...manifest, releaseVersion: "v0.0.0-local", sourceState: "modified"}, source, "v0.0.0-local");
});
