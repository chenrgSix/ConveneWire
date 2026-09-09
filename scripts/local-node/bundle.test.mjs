import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildBundle, verifyBundle } from "./bundle.mjs";

async function freePort() {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1"); await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

test("native Hub starts without PATH tools; SQLite, static Web and exhaustive tamper checks work", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "convenewire-local-hub-"));
  let child;
  let exited;
  try {
    const output = path.join(root, "hub with spaces");
    const manifest = await buildBundle(output);
    assert.equal(manifest.nodeVersion, process.version);
    assert.ok(manifest.files.some((item) => item.path.includes("/migrations/")));
    assert.ok(!manifest.files.some((item) => /node_modules\/(typescript|tsx|npm)\//u.test(item.path)));
    await assert.rejects(buildBundle(output), /already exists/u);
    const port = await freePort();
    child = spawn(path.join(output, "bin", process.platform === "win32" ? "node.exe" : "node"), ["apps/server/dist/server.js"], {
      cwd: output, env: { PATH: "", NODE_ENV: "production", CONVENE_WIRE_PORT: String(port), CONVENE_WIRE_HOST: "127.0.0.1",
        CONVENE_WIRE_DATABASE_PATH: path.join(root, "data", "hub.sqlite"), CONVENE_WIRE_WEB_ROOT: path.join(output, "apps/web/dist"),
        ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: ["ignore", "pipe", "pipe"]
    });
    exited = once(child, "exit");
    let logs = "";
    child.stdout.on("data", (chunk) => { logs += chunk; }); child.stderr.on("data", (chunk) => { logs += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health/ready`)).ok; } catch {}
      if (ready) break;
      if (child.exitCode !== null) assert.fail(logs);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, logs);
    const html = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(html.status, 200); assert.match(await html.text(), /<div id="root">/u);
    const bootstrap = await fetch(`http://127.0.0.1:${port}/api/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: "Bundle fixture" }) });
    assert.equal(bootstrap.status, 200);
    child.kill("SIGTERM");
    const [code] = await exited;
    assert.equal(code, 0, logs);
    child = undefined;
    const asset = path.join(output, "apps/web/dist/index.html");
    const original = await readFile(asset);
    await writeFile(asset, "tampered"); await assert.rejects(verifyBundle(output), /mismatch/u);
    await writeFile(asset, original);
    const extra = path.join(output, "unexpected.txt");
    await writeFile(extra, "extra"); await assert.rejects(verifyBundle(output), /mismatch/u); await rm(extra);
    if (process.platform !== "win32") {
      await symlink(asset, extra); await assert.rejects(verifyBundle(output), /Unsupported/u); await rm(extra);
    }
    const manifestPath = path.join(output, "hub-manifest.json");
    const originalManifest = await readFile(manifestPath);
    for (const mutate of [(m) => { m.arch = "wrong"; }, (m) => { m.files.push(m.files[0]); }, (m) => { m.files[0].path = "../outside"; }, (m) => { m.extra = true; }]) {
      const invalid = JSON.parse(originalManifest); mutate(invalid);
      await writeFile(manifestPath, JSON.stringify(invalid)); await assert.rejects(verifyBundle(output), /Invalid/u);
    }
    await writeFile(manifestPath, originalManifest);
    await verifyBundle(output);
  } finally {
    if (child) { child.kill("SIGKILL"); await exited; }
    await rm(root, { recursive: true, force: true });
  }
});
