import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { lstat, unlink, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { handoffFixture } from "./codex-handoff-fixture.mjs";

const native = process.env.CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN;
const desktop = process.env.CONVENE_WIRE_CODEX_DESKTOP_TEST_BIN;
const bridge = fileURLToPath(new URL("../../bridge", import.meta.url));

async function command(resources, executable, args, options, expectedCode = 0) {
  const owned = spawnTestProcess(resources, executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [owned.process.stdout, owned.process.stderr]) stream.on("data", data => { output = (output + data).slice(-8192); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void owned.stop().catch(() => {}); }, 60_000);
  try {
    const result = await owned.terminal;
    assert.equal(timedOut, false, "Owned setup command timed out");
    assert.equal(result.code, expectedCode, output);
    return output;
  } finally { clearTimeout(timer); await owned.stop(); }
}

test("installed desktop initializes through the pinned local proxy and preserves an existing Thread", {
  skip: !native || !desktop || process.platform !== "darwin", timeout: 150_000
}, async t => {
  assert.ok(path.isAbsolute(native) && path.isAbsolute(desktop));
  const resources = await createTestResources(t, "convenewire-desktop-startup-");
  const fixture = await handoffFixture(t, native, { resources });
  const launch = await fixture.desktopLaunch({ shared: false });
  const proxy = path.join(resources.directory, "convenewire-codex-desktop");
  const planPath = path.join(resources.directory, "launch-plan.json");
  await command(resources, "go", ["build", "-o", proxy, "./cmd/convenewire-codex-desktop"], { cwd: bridge, env: process.env });
  await command(resources, proxy, ["prepare", "--desktop", desktop, "--out", planPath], { cwd: fixture.workspace, env: launch.environment });
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assert.equal(plan.provider.path, native, "The desktop and test must use the same installed provider");
  t.diagnostic(`Pinned desktop/provider: ${JSON.stringify({ desktop: plan.desktop.sha256, archive: plan.archive.sha256, provider: plan.provider.sha256 })}`);

  const clientOptions = { proxyExecutable: proxy, proxyPlan: planPath };
  const source = await fixture.client(clientOptions);
  const started = await source.rpc("thread/start", { cwd: fixture.workspace, sandbox: "read-only", approvalPolicy: "never" });
  const anchor = "SYNTHETIC_DESKTOP_STARTUP_CONTINUITY";
  await source.turn(started.thread.id, anchor);
  await source.stop();

  // This installed app creates a native-tool socket outside its user-data path.
  // Record only sockets announced by this owned process and pin their identity;
  // never glob or remove another desktop's sockets.
  const sockets = new Map();
  resources.defer(async () => {
    for (const [name, initialStat] of sockets) {
      const expected = await initialStat;
      if (!expected) continue;
      let actual;
      try { actual = await lstat(name); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
      assert.ok(actual.isSocket() && actual.uid === process.getuid() && actual.dev === expected.dev && actual.ino === expected.ino,
        "Refuse to remove a replaced desktop fixture socket");
      await unlink(name);
    }
  });
  const app = spawnTestProcess(resources, desktop, [`--user-data-dir=${launch.userData}`, fixture.workspace], {
    cwd: fixture.workspace,
    env: { ...launch.environment, CODEX_CLI_PATH: proxy, CONVENE_WIRE_CODEX_PROXY_PLAN: planPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "", partial = "", protocolReady = false, spawnedProxy = false;
  const observe = data => {
    partial += data;
    log = (log + data).slice(-16_384);
    while (partial.includes("\n")) {
      const at = partial.indexOf("\n"), line = partial.slice(0, at);
      partial = partial.slice(at + 1);
      if (line.includes("initialize_handshake_result") && line.includes("outcome=success") && line.includes("transportKind=stdio")) protocolReady = true;
      if (line.includes("stdio_transport_spawned") && line.includes(`executablePath=${proxy}`)) spawnedProxy = true;
      const name = /pipePath=(\/tmp\/codex-browser-use\/[a-f0-9-]+\.sock)/.exec(line)?.[1];
      if (name && !sockets.has(name)) sockets.set(name, lstat(name).then(stat => {
        assert.ok(stat.isSocket() && stat.uid === process.getuid());
        return stat;
      }).catch(error => { if (error.code === "ENOENT") return null; throw error; }));
    }
    assert.ok(partial.length < 65_536, "Bound incomplete desktop diagnostic lines");
  };
  for (const stream of [app.process.stdout, app.process.stderr]) stream.on("data", observe);
  const deadline = Date.now() + 20_000;
  while ((!protocolReady || !spawnedProxy) && app.process.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(protocolReady && spawnedProxy, `Isolated desktop did not initialize through the proxy: ${log}`);
  assert.equal(fixture.calls.length, 1, "Desktop startup must not invoke a new model turn");
  const refused = await command(resources, proxy, ["launch", "--plan", planPath], {
    cwd: fixture.workspace, env: launch.environment
  }, 1);
  assert.match(refused, /a second instance will not be opened/);
  await app.stop();

  const returned = await fixture.client(clientOptions);
  const resumed = await returned.rpc("thread/resume", { threadId: started.thread.id });
  assert.equal(resumed.thread.id, started.thread.id);
  assert.ok(JSON.stringify(resumed.thread.turns).includes(anchor));
  await returned.turn(started.thread.id, "Continue after the isolated desktop startup and exit.");
  assert.equal(fixture.calls.length, 2);
  assert.ok(JSON.stringify(fixture.calls[1].input).includes(anchor));
  fixture.checkProvider();
});
