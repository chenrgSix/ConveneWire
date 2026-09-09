import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalNodeReady } from "@convene-wire/contracts/local-node";
import { createServerApp } from "./app.js";
import { parseLocalNodeLaunch } from "./local-node/local-node-service.js";

// Secrets travel only over the inherited pipe. EOF is a shutdown request and
// also handles a supervisor crash on platforms without parent-death signals.
const root = process.argv[2];
if (!root || !path.isAbsolute(root) || process.argv.length !== 3) throw new Error("Usage: local-node.js ABSOLUTE_NODE_DATA_ROOT");
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let closeRequested = false;
let app: Awaited<ReturnType<typeof createServerApp>> | undefined;
let shutdown: Promise<void> | undefined;
const stop = () => {
  closeRequested = true;
  if (app) shutdown ??= app.close().then(() => { input.close(); process.stdin.destroy(); });
  return shutdown;
};
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
input.on("close", () => { void stop(); });
let received = false;
input.on("line", (line) => {
  if (received) { void stop(); return; }
  received = true;
  void (async () => {
    if (line.length > 4096) throw new Error("Local Node launch message is too large");
    const launch = parseLocalNodeLaunch(JSON.parse(line));
    if (closeRequested) return;
    app = await createServerApp({ databasePath: path.join(root, "hub", "hub.sqlite"), localNode: launch,
      webRoot: fileURLToPath(new URL("../../web/dist/", import.meta.url)), logger: false });
    if (closeRequested) { await stop(); return; }
    const origin = await app.listen({ host: "127.0.0.1", port: launch.identity.port });
    if (closeRequested) { await stop(); return; }
    const ready: LocalNodeReady = { schemaVersion: 1, nodeId: launch.identity.nodeId, origin, launchProof: launch.controlToken };
    process.stdout.write(`${JSON.stringify(ready)}\n`);
  })().catch(async () => {
    // Schema/SQLite/native errors can include source values; never print launch
    // input or credential-bearing error objects to desktop logs.
    process.stderr.write("Local Hub startup failed; check bundle, data identity and saved port.\n");
    process.exitCode = 1;
    await stop(); input.close(); process.stdin.destroy();
  });
});
