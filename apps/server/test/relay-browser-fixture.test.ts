import assert from "node:assert/strict";
import { rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { relayRuntimeFixture, untilRelay } from "./helpers/relay-runtime-fixture.js";

test("Relay browser preview uses the actual Local Hub, network API and production Web", {
  skip: !process.env.CONVENE_WIRE_RELAY_PREVIEW_FILE, timeout: 600000
}, async t => {
  const preview = process.env.CONVENE_WIRE_RELAY_PREVIEW_FILE!;
  const f = await relayRuntimeFixture(t), webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  const waiting = await f.node("便捷接入测试", {webRoot, enabled: false});
  const ready = await f.node("已连接测试", {webRoot}); ready.runtime.start();
  await untilRelay(() => ready.runtime.status().state === "ready", "Preview Relay did not become ready");
  const entry = async (host: typeof ready) => {
    const result = await host.app.inject({method: "POST", url: "/api/local-node/control/entry", headers: {
      host: new URL(host.localOrigin).host, "x-convenewire-node-control": host.launch.controlToken}});
    assert.equal(result.statusCode, 200); return result.json().url;
  };
  await writeFile(preview, JSON.stringify({waiting: await entry(waiting), ready: await entry(ready)}), {mode: 0o600, flag: "wx"});
  t.after(async () => { await rm(preview, {force: true}); await rm(preview + ".done", {force: true}); });
  for (let attempt = 0; attempt < 1080; attempt++) {
    if (await stat(preview + ".done").then(() => true, () => false)) return;
    await delay(500);
  }
  assert.fail("Relay browser preview exceeded its bounded window");
});
