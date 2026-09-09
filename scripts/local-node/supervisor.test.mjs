import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { buildBundle } from "./bundle.mjs";

const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../../", import.meta.url));
const suffix = process.platform === "win32" ? ".exe" : "";
async function until(read, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read(); if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}

// A native offline Pi-protocol fixture: no provider SDK, model calls, network,
// tools or home-directory reads. The real Bridge owns dispatch and sessions.
const fixtureSource = `package main
import("encoding/json";"io";"os";"strings")
func main(){
 input,_:=io.ReadAll(os.Stdin)
 record,_:=json.Marshal(map[string]any{"bytes":len(input),"args":os.Args[1:]})
 file,err:=os.OpenFile("fixture-calls.jsonl",os.O_CREATE|os.O_APPEND|os.O_WRONLY,0600);if err!=nil{panic(err)}
 file.Write(append(record,'\\n'));file.Sync();file.Close()
 reply:="Local Node fixture reply. Team collaboration remains on this computer."
 if strings.Contains(string(input),"Discussion ID:"){reply += "\\n<agentroom-assessment>{\\"goalSatisfied\\":true,\\"confidence\\":0.95,\\"newInformationAdded\\":true,\\"reviewerApproved\\":true,\\"disagreementRemaining\\":\\"none\\",\\"recommendation\\":\\"finish\\"}</agentroom-assessment>"}
 json.NewEncoder(os.Stdout).Encode(map[string]any{"type":"message_end","message":map[string]any{"role":"assistant","content":[]any{map[string]string{"type":"text","text":reply}},"stopReason":"stop"}})
}`;

test("native supervisor binds one Team, configures a real Bridge, runs offline and recovers the same installation", { timeout: 240_000 }, async (t) => {
  const resources = await createTestResources(t, "convenewire-local-node-e2e-");
  const root = resources.directory;
  const bundle = path.join(root, "hub");
  const manifest = await buildBundle(bundle);
  const hostBinary = path.join(root, `convenewire-node${suffix}`);
  const fixtureBinary = path.join(root, `offline-pi${suffix}`);
  const fixtureFile = path.join(root, "offline-pi.go");
  await writeFile(fixtureFile, fixtureSource);
  await exec("go", ["build", "-o", hostBinary, "./cmd/convenewire-node"], { cwd: path.join(repository, "bridge") });
  await exec("go", ["build", "-o", fixtureBinary, fixtureFile], { cwd: root });
  const dataRoot = path.join(root, "node-data");
  const launch = () => {
    const host = spawnTestProcess(resources, hostBinary, ["--stdio", "--hub-bundle", bundle, "--data-dir", dataRoot, "--workspace", root], {
      env: { PATH: "", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) }, stdio: ["pipe", "pipe", "pipe"]
    });
    let buffer = "";
    let error = "";
    const events = [];
    host.process.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n"); const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (line.startsWith("{")) events.push(JSON.parse(line));
      }
    });
    host.process.stderr.on("data", (chunk) => { error += chunk; });
    const event = (kind) => until(() => {
      const found = events.find((entry) => entry.event === kind);
      if (found) return found;
      if (host.process.exitCode !== null) throw new Error(`Node host exited: ${error}`);
      return null;
    }, kind);
    const stop = async () => { host.process.stdin.end(); const result = await host.terminal; await host.stop(); return result; };
    return { host, event, stop, events };
  };
  let running = launch();
  const ready = await running.event("ready");
  const ownerEntry = async (entry) => {
    const ticket = entry.entryUrl.split("/").at(-1);
    const response = await fetch(`${entry.origin}/api/local-node/session`, { method: "POST", headers: { "content-type": "application/json", origin: entry.origin }, body: JSON.stringify({ ticket }) });
    assert.equal(response.status, 200); return response.json();
  };
  let owner = await ownerEntry(ready);
  const ownerId = owner.user.userId;
  const request = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(ready.origin + route, { method, headers: { authorization: `Bearer ${owner.session.token}`, origin: ready.origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, `${route}: ${JSON.stringify(value)}`); return value;
  };
  const health = await request("/api/health/ready");
  assert.equal(health.status, "ready");
  assert.equal(manifest.releaseVersion, "v0.0.0-local");
  const { team } = await request("/api/teams", { name: "Local fixture Team" });
  const room = await request(`/api/teams/${team.teamId}/rooms`, { name: "Local work" });
  await request(`/api/local-node/teams/${team.teamId}/bind`, undefined, "POST");
  await request("/api/local-node/open-console", undefined, "POST");
  const consoleEvent = await running.event("console");
  const consoleURL = new URL(consoleEvent.consoleUrl);
  const consoleRequest = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(consoleURL.origin + route, { method, headers: { authorization: `Bearer ${consoleURL.searchParams.get("token")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const initial = await consoleRequest("/api/state");
  assert.equal(initial.body.localNodeId, ready.nodeId); assert.equal(initial.body.paired, true); assert.equal(initial.body.agents.length, 0);
  assert.equal((await consoleRequest("/api/enrollment/restart", {})).status, 409);
  const added = await consoleRequest("/api/agents", { kind: "pi", name: "Local Solver", role: "Solver", executablePath: fixtureBinary, workspace: root });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const agents = await until(async () => {
    const list = await request(`/api/teams/${team.teamId}/agents`);
    return list.length === 1 && list[0].presence === "ready" ? list : null;
  }, "Agent registration");
  const sent = await request(`/api/rooms/${room.roomId}/messages`, { content: "Verify the offline Local Node", mentionAgentId: agents[0].agentId });
  const runId = sent.runs[0].runId;
  await until(async () => {
    const runs = await request(`/api/rooms/${room.roomId}/runs`);
    const run = runs.find((candidate) => candidate.runId === runId);
    if (run && ["failed", "outcome_unknown"].includes(run.state)) throw new Error(`Local fixture Run ${run.state}: ${JSON.stringify(await request(`/api/runs/${runId}/events`))}`);
    return run?.state === "completed";
  }, "ordinary Run completion");
  const messages = await request(`/api/rooms/${room.roomId}/messages`);
  assert.equal(messages.items.filter((item) => item.senderType === "agent" && item.content.includes("Local Node fixture reply")).length, 1);
  const identityBefore = await readFile(path.join(dataRoot, "identity.json"));
  const callsBefore = await readFile(path.join(root, "fixture-calls.jsonl"), "utf8");
  const duplicate = launch();
  const duplicateResult = await duplicate.host.terminal;
  assert.notEqual(duplicateResult.code, 0); assert.equal(duplicate.events.length, 0);
  await duplicate.host.stop();
  await running.stop();
  await assert.rejects(fetch(ready.origin + "/api/health/ready"));
  const collision = net.createServer();
  collision.listen(Number(new URL(ready.origin).port), "127.0.0.1"); await once(collision, "listening");
  try {
    const blocked = launch();
    const blockedResult = await blocked.host.terminal;
    assert.notEqual(blockedResult.code, 0); assert.equal(blocked.events.length, 0); await blocked.host.stop();
  } finally { await new Promise((resolve) => collision.close(resolve)); }
  assert.deepEqual(await readFile(path.join(dataRoot, "identity.json")), identityBefore);
  running = launch();
  const reopened = await running.event("ready");
  assert.equal(reopened.origin, ready.origin); assert.equal(reopened.nodeId, ready.nodeId);
  owner = await ownerEntry(reopened); assert.equal(owner.user.userId, ownerId);
  await running.event("console");
  const restored = await request(`/api/teams/${team.teamId}/agents`);
  assert.equal(restored[0].agentId, agents[0].agentId);
  assert.equal((await request(`/api/rooms/${room.roomId}/runs`)).find((item) => item.runId === runId).state, "completed");
  assert.equal(await readFile(path.join(root, "fixture-calls.jsonl"), "utf8"), callsBefore, "restart executed completed work again");
  await running.stop();
});
