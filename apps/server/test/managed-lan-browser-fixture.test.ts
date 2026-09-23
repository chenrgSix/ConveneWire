import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {stat, writeFile, rm} from "node:fs/promises";
import {setTimeout} from "node:timers/promises";
import {createTestResources} from "../../../scripts/test/resources.mjs";
import {managedLANPeerFixture} from "./helpers/managed-lan-peer-fixture.js";

test("managed LAN browser fixture serves the actual production workspace", {
  skip: !process.env.CONVENE_WIRE_LAN_PREVIEW_FILE, timeout: 600_000
}, async t => {
  const preview = path.resolve(process.env.CONVENE_WIRE_LAN_PREVIEW_FILE!);
  const resources = await createTestResources(t, "convenewire-lan-ui-");
  const f = await managedLANPeerFixture(resources.directory, () => new Date().toISOString(), undefined, () => ["192.168.1.12"]);
  resources.defer(() => f.close());
  const entry = await f.app.inject({method: "POST", url: "/api/local-node/control/entry", headers: {host: f.ownerHeaders.host, "x-convenewire-node-control": f.launch.controlToken}});
  assert.equal(entry.statusCode, 200);
  await writeFile(preview, JSON.stringify({entry: entry.json().url}), {mode: 0o600, flag: "wx"});
  t.after(async () => {await rm(preview, {force: true}); await rm(`${preview}.done`, {force: true});});
  for (let attempt = 0; attempt < 1080; attempt++) {
    if (await stat(`${preview}.done`).then(() => true, () => false)) return;
    await setTimeout(500);
  }
  assert.fail("LAN UI preview exceeded its bounded lifetime");
});
