import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import Database from "better-sqlite3";
import type { HTTPMethods } from "fastify";
import { createServerApp } from "../../apps/server/src/app.js";
import { CoreRepository } from "../../apps/server/src/data/core-repository.js";
import { AuthService } from "../../apps/server/src/security/auth-service.js";
import { AgentTaskRepository } from "../../apps/server/src/task/task-repository.js";
import { RunRepository } from "../../apps/server/src/run/run-repository.js";
import { defaultRoomCollaborationPolicy } from "../../apps/server/src/team-room/room-collaboration-policy.js";
import { createTestResources } from "../../scripts/test/resources.mjs";
import { spawnTestProcess } from "../../scripts/test/child-process.mjs";

const execute = promisify(execFile);
const teamId = "team_authorityfixture01", ownerId = "member_authorityfixture01", roomId = "room_authorityfixture01";
const userId = "user_authorityfixture01", taskId = "task_authorityfixture01", runId = "run_authoritycollision01";
const agentIDs = ["agent_sharedfixture01", "agent_overlapfixture01", "agent_independentfixture01"];
const names = ["Shared", "Overlap", "Independent"];
const secret = () => randomBytes(32).toString("base64url");
async function until<T>(read: () => T | undefined | Promise<T | undefined>, label: string): Promise<T> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) { const value = await read(); if (value !== undefined) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}

test("one core isolates three authenticated Hosts, colliding IDs, queues, offline and orphan recovery", { timeout: 180_000 }, async t => {
  const resources = await createTestResources(t, "convenewire-multi-authority-");
  const root = resources.directory, dataDir = path.join(root, "bridge"); await mkdir(dataDir, { mode: 0o700 });
  const workspace = path.join(root, "workspace"), childWorkspace = path.join(workspace, "child"), independentWorkspace = path.join(root, "independent");
  await mkdir(childWorkspace, { recursive: true }); await mkdir(independentWorkspace);
  const journal = path.join(root, "invocations.jsonl"); await writeFile(journal, "", { mode: 0o600 });
  const helper = path.join(root, "pi-fixture.mjs");
  await writeFile(helper, `
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
const input = readFileSync(0,'utf8');
const matches = [...input.matchAll(/AUTHORITY_([ABC]) CASE_([a-zA-Z0-9-]+)/g)];
const selected = matches.at(-1); if (!selected) process.exit(3);
const authority = selected[1], name = selected[2], journal = process.argv[2], root = process.argv[3];
const index = process.argv.indexOf('--session-id'), session = process.argv[index + 1];
if (index < 0 || !/^[a-f0-9-]{36}$/.test(session)) process.exit(4);
const log = phase => appendFileSync(journal,JSON.stringify({authority,name,phase,session,pid:process.pid,at:Date.now()})+'\\n');
log('start');
const started = Date.now();
while (name.startsWith('hold-') && !existsSync(root+'/'+name+'.release')) {
 if (Date.now()-started>60000) process.exit(5);
 await new Promise(resolve=>setTimeout(resolve,15));
}
await new Promise(resolve=>setTimeout(resolve,150));
log('finish');
const reply = 'REPLY_'+authority+' CASE_'+name;
process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:reply}],stopReason:'stop'}})+'\\n');
`);
  const localPort = await freePort();
  const localNode = { schemaVersion: 1 as const, controlToken: secret(), identity: { schemaVersion: 1 as const,
    nodeId: `node_${secret()}`, ownerUserId: userId, port: localPort, secret: secret() } };
  async function host(label: "A" | "B" | "C", sharedDevice?: string) {
    const databasePath = path.join(root, `${label}.sqlite`);
    const options = { databasePath, ...(label === "A" ? { localNode } : {}) };
    let app = await createServerApp(options); let closed = false;
    const origin = await app.listen({ host: "127.0.0.1", port: label === "A" ? localPort : 0 });
    const port = Number(new URL(origin).port);
    resources.defer(async () => { if (!closed) await app.close(); });
    const db = new Database(databasePath); resources.defer(() => db.close());
    const core = new CoreRepository(db), auth = new AuthService(db), runs = new RunRepository(db), tasks = new AgentTaskRepository(db);
    const now = new Date().toISOString();
    core.ensureUser({ userId, displayName: `Owner ${label}`, createdAt: now });
    core.createTeamWithOwner({ teamId, name: `Host ${label}`, createdAt: now }, { memberId: ownerId, teamId, userId, displayName: `Owner ${label}`, role: "owner", createdAt: now });
    core.createRoom({ roomId, teamId, name: `Room ${label}`, collaborationPolicy: defaultRoomCollaborationPolicy, settingsRevision: 1, createdAt: now });
    const owner = auth.issueWebSession(userId, now, new Date(Date.now() + 3600_000).toISOString());
    const request = (method: HTTPMethods, url: string, payload?: unknown) => app.inject({ method, url,
      headers: { host: new URL(origin).host, authorization: `Bearer ${owner.secret}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
    const ok = async (method: HTTPMethods, url: string, payload?: unknown) => { const response = await request(method, url, payload); assert.equal(response.statusCode, 200, response.body); return response.json(); };
    let credential;
    if (label === "A") {
      await ok("POST", `/api/local-node/teams/${teamId}/bind`);
      const response = await app.inject({ url: "/api/local-node/control/binding", headers: { host: new URL(origin).host, "x-convenewire-node-control": localNode.controlToken } });
      assert.equal(response.statusCode, 200, response.body); const binding = response.json().binding;
      credential = { serverUrl: origin, teamId, ownerMemberId: ownerId, deviceId: binding.deviceId, token: binding.token, expiresAt: null };
    } else {
      core.createDevice({ deviceId: sharedDevice!, teamId, ownerMemberId: ownerId, name: `Connector ${label}`, status: "active", createdAt: now, revokedAt: null });
      const issued = auth.issueDeviceCredential(sharedDevice!, now);
      credential = { serverUrl: origin, teamId, ownerMemberId: ownerId, deviceId: sharedDevice!, token: issued.secret, expiresAt: null };
    }
    for (const [i, agentId] of agentIDs.entries()) core.createAgent({ agentId, teamId, ownerMemberId: ownerId, deviceId: credential.deviceId,
      name: names[i], role: "Fixture", integrationMode: "managed", enabled: true, presence: "offline", runtimePolicy: null,
      capabilities: { supportsStart: true, supportsResume: true, supportsStreaming: true, supportsInterrupt: true, supportsHandoff: false }, createdAt: now, updatedAt: now });
    await ok("PUT", `/api/rooms/${roomId}/participants`, { memberIds: [ownerId], agentIds: agentIDs });
    const source = await ok("POST", `/api/rooms/${roomId}/tasks`, { title: "Fixture template", goal: `AUTHORITY_${label} CASE_collision-${label}` });
    tasks.create({ ...source, taskId, taskDisplayNumber: tasks.nextDisplayNumber(teamId), primaryAgentId: agentIDs[0],
      lifecycleState: "ready", assignments: agentIDs.map((agentId, i) => ({ agentId, role: i === 0 ? "primary" : "contributor", assignedByMemberId: ownerId, assignedAt: now })) });
    const message = core.appendMessage({ messageId: "msg_authoritycollision01", roomId, taskId, traceId: "trace_authoritycollision01",
      senderType: "member", senderId: ownerId, content: `AUTHORITY_${label} CASE_collision-${label}`, mentions: [], parentMessageId: null, createdAt: now });
    const seedCollision = () => runs.createRuns([{ runId, traceId: message.traceId, roomId, taskId, triggerMessageId: message.messageId, requesterMemberId: ownerId,
      targetAgentId: agentIDs[0], parentRunId: null, instruction: message.content, state: "queued", lastSequence: 0,
      deadlineAt: new Date(Date.now() + 120_000).toISOString(), createdAt: now, updatedAt: now, terminalAt: null }]);
    const publicIdentity = await ok("GET", "/api/authority");
    const pin = { authorityNodeId: publicIdentity.authorityNodeId, publicKey: publicIdentity.publicKey, serverOrigin: origin };
    const credentials = label === "A" ? dataDir : path.join(root, `credential-${label}`);
    await mkdir(credentials, { recursive: true, mode: 0o700 });
    await writeFile(path.join(credentials, "device-credential.json"), JSON.stringify(credential), { mode: 0o600 });
    return { label, db, core, auth, runs, credential, pin, credentials, request, ok, seedCollision,
      async close() { if (!closed) { await app.close(); closed = true; } },
      async reopen() { app = await createServerApp(options); await app.listen({ host: "127.0.0.1", port }); closed = false; },
      sendWire(payload: unknown, type = "run.requested") { assert.equal(app.websocketServer.clients.size, 1); for (const socket of app.websocketServer.clients) socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: `msg_${secret()}`, timestamp: new Date().toISOString(), type, payload })); },
      async send(name: string, agentId = agentIDs[0]) { const sent = await ok("POST", `/api/rooms/${roomId}/messages`, { taskId, content: `AUTHORITY_${label} CASE_${name}`, mentionAgentId: agentId }); assert.equal(sent.runs.length, 1); return sent.runs[0].runId as string; }
    };
  }
  const a = await host("A"), b = await host("B", a.credential.deviceId), c = await host("C", a.credential.deviceId);
  const hosts = [a, b, c];
  // Identical object IDs never make another Host's Device or human bearer valid.
  for (const target of [b, c]) {
    for (const url of ["/api/bridge/results", "/api/bridge/runtime-approvals"]) {
      const denied = await fetch(`${target.pin.serverOrigin}${url}`, { method: "POST",
        headers: { authorization: `Bearer ${a.credential.token}`, "content-type": "application/json" }, body: "{}" });
      assert.equal(denied.status, 401); await denied.text();
    }
  }
  await writeFile(path.join(dataDir, "agent-identities.json"), JSON.stringify(Object.fromEntries(names.map((name, i) => [name, agentIDs[i]]))), { mode: 0o600 });
  const configPath = path.join(root, "bridge.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 5, localNodeId: a.pin.authorityNodeId,
    serverUrl: a.pin.serverOrigin, deviceName: "Shared Runtime core", dataDir,
    agents: names.map((name, i) => ({ name, role: "Fixture", adapter: "generic", runtimeKind: "pi", presetVersion: 5,
      command: [process.execPath, helper, journal, root], workspace: [workspace, childWorkspace, independentWorkspace][i], envAllowlist: [] })) }), { mode: 0o600 });
  await writeFile(path.join(dataDir, "authority-connectors.json"), JSON.stringify({ schemaVersion: 1, primary: a.pin,
    connectors: [b, c].map(h => ({ mode: "device", pin: h.pin, teamId, ownerMemberId: ownerId, deviceId: h.credential.deviceId,
      label: `Host ${h.label}`, credentialDir: h.credentials,
      projections: names.map((name, i) => ({ name, localAgentId: agentIDs[i], projectionAgentId: agentIDs[i] })) })) }), { mode: 0o600 });
  const binary = path.join(root, "convenewire-bridge");
  await execute("go", ["build", "-o", binary, "./cmd/convenewire-bridge"], { cwd: path.resolve(import.meta.dirname, "../../bridge"), timeout: 90_000 });
  let diagnostic = "";
  const start = () => { const child = spawnTestProcess(resources, binary, ["run", "--config", configPath], { stdio: ["ignore", "pipe", "pipe"] });
    child.process.stderr?.on("data", data => { diagnostic = (diagnostic + String(data)).slice(-4000); }); return child; };
  let bridge = start();
  const log = async () => (await readFile(journal, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { authority: string; name: string; phase: string; session: string; pid: number; at: number });
  const ready = async (h: typeof a) => until(() => {
    if (bridge.process.exitCode !== null) throw new Error(`Bridge exited: ${diagnostic}`);
    return h.core.listAgents(teamId).every(agent => agent.presence === "ready") ? true : undefined;
  }, `${h.label} online`);
  const completed = (h: typeof a, id: string) => until(() => {
    if (bridge.process.exitCode !== null) throw new Error(`Bridge exited: ${diagnostic}`);
    const run = h.runs.getRun(id); if (run && ["failed", "outcome_unknown", "expired"].includes(run.state)) throw new Error(`${h.label} ${id}: ${run.state} ${JSON.stringify(h.runs.listEvents(id))}`);
    return run?.state === "completed" ? run : undefined;
  }, `${h.label} completed ${id}`).catch(async error => {
    const partition = h === a ? dataDir : path.join(dataDir, "authorities", h.pin.authorityNodeId);
    const inbox = await readFile(path.join(partition, "inbox", `${id}.json`), "utf8").catch(() => "missing");
    throw new Error(`${error.message}; stderr=${diagnostic}; state=${JSON.stringify(h.runs.getRun(id))}; events=${JSON.stringify(h.runs.listEvents(id))}; inbox=${inbox}; journal=${JSON.stringify(await log())}`);
  });
  const started = (name: string) => until(async () => (await log()).find(item => item.name === name && item.phase === "start"), `Runtime ${name} started`);
  // Publish the actual Runtime scope before freezing an offline delivery.
  // A manually seeded Agent without a scope is not a negotiated Runtime.
  await Promise.all(hosts.map(ready)); await bridge.stop();
  hosts.forEach(h => h.seedCollision()); bridge = start();
  await Promise.all(hosts.map(h => completed(h, runId)));
  const collisions = (await log()).filter(item => item.name.startsWith("collision-"));
  assert.equal(collisions.length, 6); assert.equal(new Set(collisions.filter(x => x.phase === "start").map(x => x.session)).size, 3);
  const ordered = collisions.filter(x => x.phase === "start").sort((x, y) => x.at - y.at);
  for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i].at >= collisions.find(x => x.name === ordered[i - 1].name && x.phase === "finish")!.at);
  for (const h of hosts) {
    const messages = await h.ok("GET", `/api/rooms/${roomId}/messages`);
    const replies = messages.items.filter((m: { senderType: string }) => m.senderType === "agent");
    assert.equal(replies.length, 1); assert.ok(replies[0].content.includes(`REPLY_${h.label}`));
  }
  const held = await a.send("hold-a"); await started("hold-a");
  const queued = await b.send("queued-b");
  await until(() => b.runs.getRun(queued)?.state === "delivered" ? true : undefined, "B queued behind A");
  const independent = await c.send("independent-c", agentIDs[2]); await completed(c, independent);
  const overlapping = await c.send("overlap-c", agentIDs[1]);
  await until(() => c.runs.getRun(overlapping)?.state === "delivered" ? true : undefined, "overlap queue");
  await b.ok("POST", `/api/runs/${queued}/cancel`, { reason: "Cancel only Host B's queued work" });
  await until(() => b.runs.getRun(queued)?.state === "canceled" ? true : undefined, "B cancellation");
  assert.ok(!(await log()).some(x => x.name === "queued-b" || x.name === "overlap-c"));
  assert.equal(a.runs.getRun(held)?.state, "working");
  await writeFile(path.join(root, "hold-a.release"), "release"); await completed(a, held); await completed(c, overlapping);
  const original = JSON.parse((c.db.prepare("SELECT payload_json FROM run_deliveries WHERE run_id = ?").get(runId) as { payload_json: string }).payload_json);
  c.sendWire(original); c.sendWire(original);
  await completed(c, await c.send("after-duplicates"));
  assert.equal((await log()).filter(x => x.name === "collision-C" && x.phase === "start").length, 1);
  c.sendWire({ ...original, instruction: "Changed immutable delivery" });
  await until(() => c.core.getDevicePresence(c.credential.deviceId)!.connectionEpoch > 1 ? true : undefined, "C reconnect after conflicting duplicate");
  await completed(b, await b.send("other-host-survives"));
  await a.close(); await bridge.stop(); bridge = start();
  await ready(b); await completed(b, await b.send("primary-offline"));
  await a.reopen(); await ready(a);
  const revokeHeld = await a.send("hold-revoke"); await started("hold-revoke");
  const revoked = await b.send("revoked-while-queued");
  await until(() => b.runs.getRun(revoked)?.state === "delivered" ? true : undefined, "B accepted before revoke");
  const actor = b.auth.authenticateDevice(b.credential.token, new Date().toISOString());
  b.auth.revokeDeviceCredential(actor.credentialId, new Date().toISOString());
  await writeFile(path.join(root, "hold-revoke.release"), "release"); await completed(a, revokeHeld);
  await completed(c, await c.send("revoked-peer-does-not-block"));
  assert.ok(!(await log()).some(x => x.name === "revoked-while-queued"));
  const crashRun = await a.send("hold-crash"); const orphan = await started("hold-crash");
  bridge.process.kill("SIGKILL"); await bridge.terminal;
  process.kill(orphan.pid, 0); // Actual orphan exists before the core fences it.
  bridge = start(); await ready(c);
  await until(() => { try { process.kill(orphan.pid, 0); return undefined; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; throw error; } }, "old Runtime process fenced");
  await until(() => a.runs.getRun(crashRun)?.state === "outcome_unknown" ? true : undefined, "crashed Run conservatively recovered");
  await completed(c, await c.send("after-crash"));
  assert.equal((await log()).filter(x => x.name === "hold-crash").length, 1);
  await bridge.stop();
  for (const h of hosts) {
    const partition = h === a ? dataDir : path.join(dataDir, "authorities", h.pin.authorityNodeId);
    const inbox = JSON.parse(await readFile(path.join(partition, "inbox", `${runId}.json`), "utf8"));
    assert.equal(inbox.request.instruction, `AUTHORITY_${h.label} CASE_collision-${h.label}`); assert.equal(inbox.state, "completed");
  }
});
