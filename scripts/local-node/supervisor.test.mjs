import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, rename, rm, mkdir, readdir, stat } from "node:fs/promises";
import { createPublicKey } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { buildBundle } from "./bundle.mjs";
import { relayHostname } from "@convene-wire/contracts/relay-proof";

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

test("native Local Node completes Codex/Pi Run and Discussion, then restores the same Owner and execution state", { timeout: process.env.CONVENE_WIRE_LOCAL_NODE_PREVIEW_FILE ? 420_000 : 240_000 }, async (t) => {
  const resources = await createTestResources(t, "convenewire-local-node-e2e-");
  const root = resources.directory;
  const bundle = path.join(root, "hub");
  const manifest = await buildBundle(bundle);
  const hostBinary = path.join(root, `convenewire-node${suffix}`);
  const fixtureBinary = path.join(root, `offline-runtime${suffix}`);
  const fixtureFile = path.join(repository, "scripts/local-node/fixtures/offline-runtime.go");
  await exec("go", ["build", "-o", hostBinary, "./cmd/convenewire-node"], { cwd: path.join(repository, "bridge") });
  await exec("go", ["build", "-o", fixtureBinary, fixtureFile], { cwd: root });
  const dataRoot = path.join(root, "node-data");
  const launch = (nodeRoot = dataRoot) => {
    const host = spawnTestProcess(resources, hostBinary, ["--stdio", "--hub-bundle", bundle, "--data-dir", nodeRoot, "--workspace", root], {
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
    const event = (kind, accepts = () => true) => until(() => {
      const found = events.find((entry) => entry.event === kind && accepts(entry));
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
  t.diagnostic(`Native bundle: ${manifest.platform}/${manifest.arch}, Node ${manifest.nodeVersion}, source ${manifest.sourceCommit}, ${manifest.sourceState}`);
  const defaultRelay = await request("/api/local-node/relay");
  assert.equal(defaultRelay.provider, null);
  assert.deepEqual(defaultRelay.saved, { enabled: false, origin: null });
  assert.deepEqual(defaultRelay.running, { state: "disabled", origin: null, errorCode: null, certificateExpiresAt: null });
  assert.equal(defaultRelay.pending, null);
  const unboundConsole = new URL((await running.event("console")).consoleUrl);
  const unboundHeaders = { authorization: `Bearer ${unboundConsole.searchParams.get("token")}` };
  assert.equal((await fetch(unboundConsole.origin + "/api/desktop-codex", { headers: unboundHeaders })).status, 409,
    "a host without a user home keeps desktop adoption unavailable while ordinary local work remains usable");
  const unboundState = await fetch(unboundConsole.origin + "/api/state", { headers: unboundHeaders }).then(response => response.json());
  assert.equal(unboundState.paired, false);
  assert.equal(unboundState.bridgeRunning, true);
  assert.equal(unboundState.connection.state, "stopped");
  assert.equal(unboundState.localNodeId, ready.nodeId);
  assert.equal((await request("/api/local-node")).teamId, null);
  assert.deepEqual(await request("/api/teams"), []);
  assert.equal((await fetch(unboundConsole.origin + "/api/peers/joins", { headers: unboundHeaders })).status, 200);
  const unboundAdded = await fetch(unboundConsole.origin + "/api/agents", { method: "POST",
    headers: { ...unboundHeaders, "content-type": "application/json" },
    body: JSON.stringify({ kind: "codex", name: "Local Solver", role: "Solver", executablePath: fixtureBinary, workspace: root }) });
  const independentAgent = await unboundAdded.json();
  assert.equal(unboundAdded.status, 201, JSON.stringify(independentAgent));
  await until(async () => {
    const state = await fetch(unboundConsole.origin + "/api/peers/status", { headers: unboundHeaders }).then(response => response.json());
    return state.state === "running";
  }, "unpaired native core restarts after configuring its first Agent");
  await assert.rejects(readFile(path.join(dataRoot, "bridge", "device-credential.json")), { code: "ENOENT" });
  const { team } = await request("/api/teams", { name: "Local fixture Team" });
  const room = await request(`/api/teams/${team.teamId}/rooms`, { name: "Local work" });
  await request(`/api/local-node/teams/${team.teamId}/bind`, undefined, "POST");
  await request("/api/local-node/open-console", undefined, "POST");
  const consoleEvent = await running.event("console", entry => entry.consoleUrl !== unboundConsole.href);
  const consoleURL = new URL(consoleEvent.consoleUrl);
  assert.equal((await fetch(unboundConsole.origin + "/api/peers/joins", { headers: unboundHeaders })).status, 401);
  const consoleRequest = async (route, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(consoleURL.origin + route, { method, headers: { authorization: `Bearer ${consoleURL.searchParams.get("token")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  const initial = await consoleRequest("/api/state");
  assert.equal(initial.body.localNodeId, ready.nodeId); assert.equal(initial.body.paired, true);
  assert.equal(initial.body.agents.length, 1);
  assert.equal(initial.body.agents[0].agentId, independentAgent.agentId);
  await until(async () => {
    const peers = await consoleRequest("/api/peers/status");
    assert.equal(peers.status, 200, JSON.stringify(peers.body));
    assert.deepEqual(peers.body.connections, []);
    return peers.body.state === "running";
  }, "native Peer owner capability reaches the actual Console");
  assert.deepEqual((await consoleRequest("/api/peers/approvals")).body, { approvals: [] });
  const pendingPeerJoins = await consoleRequest("/api/peers/joins");
  assert.equal(pendingPeerJoins.status, 200, JSON.stringify(pendingPeerJoins.body));
  assert.deepEqual(pendingPeerJoins.body, { pending: [] });
  const peerDepartures = await consoleRequest("/api/peers/departures");
  assert.equal(peerDepartures.status, 200, JSON.stringify(peerDepartures.body));
  assert.deepEqual(peerDepartures.body, { departures: [] });
  assert.equal((await consoleRequest("/api/peers/invitations/confirm", { participant: { nodeId: "node_foreign001" } })).status, 400);
  const foreignPeerDecision = await fetch(`${consoleURL.origin}/api/peers/approvals/approval_foreign001`, {
    method: "POST", headers: { authorization: `Bearer ${consoleURL.searchParams.get("token")}`, origin: "https://foreign-peer.example", "content-type": "application/json" },
    body: JSON.stringify({ allow: true })
  });
  assert.equal(foreignPeerDecision.status, 403);
  await foreignPeerDecision.body?.cancel();
  assert.equal((await consoleRequest("/api/enrollment/restart", {})).status, 409);
  const agents = await until(async () => {
    const list = await request(`/api/teams/${team.teamId}/agents`);
    return list.length === 1 && list[0].presence === "ready" ? list : null;
  }, "Agent registration");
  assert.equal(agents[0].configuredModel, "fixture-default-codex");
  assert.ok(Number.isFinite(Date.parse(agents[0].modelReportedAt)));
  await assert.rejects(readFile(path.join(root, "fixture-calls.jsonl")), { code: "ENOENT" });
  const exportReview = await consoleRequest("/api/peers/exports");
  assert.equal(exportReview.status, 200, JSON.stringify(exportReview.body));
  assert.equal(exportReview.body.state.participant.nodeId, ready.nodeId);
  assert.deepEqual(exportReview.body.state.connections, []);
  assert.equal(exportReview.body.sources.length, 1);
  assert.equal(exportReview.body.sources[0].localAgentId, agents[0].agentId);
  assert.equal(exportReview.body.sources[0].workspace, root);
  assert.equal(exportReview.body.sources[0].available, true);
  assert.match(exportReview.body.sources[0].configurationDigest, /^[a-f0-9]{64}$/u);
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
  const reviewer = await consoleRequest("/api/agents", { kind: "pi", name: "Local Reviewer", role: "Reviewer", executablePath: fixtureBinary, workspace: root });
  assert.equal(reviewer.status, 201, JSON.stringify(reviewer.body));
  const participants = await until(async () => {
    const list = await request(`/api/teams/${team.teamId}/agents`);
    return list.length === 2 && list.every((agent) => agent.presence === "ready") ? list : null;
  }, "two ready Agents");
  assert.equal(participants.find(agent => agent.name === "Local Solver").configuredModel, "fixture-default-codex");
  assert.equal(participants.find(agent => agent.name === "Local Reviewer").configuredModel, null);
  const started = await request(`/api/rooms/${room.roomId}/discussions`, {
    goal: "Use the offline fixture to verify that the Owner retains final control of this local discussion.",
    participantAgentIds: participants.map((agent) => agent.agentId), mode: "review", outputMode: "decision_record",
    policy: { initialLeaseTurns: 1, automaticMaxTurns: 1, hardMaxTurns: 3, maxDurationSeconds: 300,
      plateauWindow: 2, minimumCompletionConfidence: 0.8, finalizationReserveTurns: 1, requireReviewer: true, allowAutomaticFinish: false }
  });
  const discussionId = started.discussion.discussionId;
  const boundary = await until(async () => {
    const view = await request(`/api/discussions/${discussionId}`);
    if (!["active", "stop_requested", "awaiting_extension"].includes(view.discussion.state)) throw new Error(`Unexpected Discussion boundary: ${JSON.stringify(view)}`);
    return view.discussion.state === "awaiting_extension" ? view : null;
  }, "Discussion Owner boundary");
  assert.equal(boundary.turns.length, 2);
  assert.ok(boundary.turns.every((turn) => turn.state === "completed" && turn.assessment));
  await request(`/api/discussions/${discussionId}/actions`, { action: "finish" });
  const completed = await until(async () => {
    const view = await request(`/api/discussions/${discussionId}`);
    return view.discussion.state === "completed" ? view : null;
  }, "Discussion finalization");
  assert.equal(completed.discussion.stateReason, "user_requested_finish");
  assert.equal(completed.discussion.budget.agentRunsUsed, 3);
  assert.equal(completed.turns.filter((turn) => turn.kind === "finalization" && turn.state === "completed").length, 1);
  assert.deepEqual(completed.waves.map((wave) => [wave.phase, wave.state, wave.expectedMembers]), [
    ["contribution", "completed", 2], ["finalization", "completed", 1]
  ]);
  const identityBefore = await readFile(path.join(dataRoot, "identity.json"));
  const processRoot = path.join(dataRoot, "bridge", "core-node-processes");
  const processOwnerBefore = await readFile(path.join(processRoot, "node-process-owner.json"));
  const processOwner = JSON.parse(processOwnerBefore);
  assert.equal(processOwner.nodeId, ready.nodeId);
  assert.equal(processOwner.localUserId, ownerId);
  assert.equal(Object.hasOwn(processOwner, "deviceId"), false);
  const processRecords = path.join(processRoot, "governed-runtime-processes");
  const [processNamespace] = await readdir(processRecords);
  const processFiles = await readdir(path.join(processRecords, processNamespace));
  const prepared = processFiles.filter(name => name.endsWith(".prepared.json"));
  assert.equal(prepared.length, 4, "every actual Runtime child must belong to the Node process owner");
  for (const file of prepared) {
    const record = JSON.parse(await readFile(path.join(processRecords, processNamespace, file), "utf8"));
    assert.equal(record.version, 4); assert.deepEqual(record.nodeOwner, processOwner);
    assert.equal(Object.hasOwn(record, "owner"), false);
    assert.ok(processFiles.includes(file.replace(".prepared.json", ".finished.json")), "process completion was not durably recorded");
  }
  const callsBefore = await readFile(path.join(root, "fixture-calls.jsonl"), "utf8");
  assert.deepEqual([...new Set(callsBefore.trim().split("\n").map(line => JSON.parse(line).runtimeKind))].sort(), ["codex", "pi"]);
  assert.equal(callsBefore.trim().split("\n").length, 4);
  const snapshot = path.join(root, "snapshot");
  await assert.rejects(exec(hostBinary, ["--data-dir", dataRoot, "--backup", snapshot]), /already|owned|lock/i);
  const duplicate = launch();
  const duplicateResult = await duplicate.host.terminal;
  assert.notEqual(duplicateResult.code, 0); assert.equal(duplicate.events.length, 0);
  await duplicate.host.stop();
  // Review and stage configuration through the actual local Owner API. Saving
  // does not bind another port; the native startup is the activation boundary.
  const available = net.createServer(); available.listen(0, "127.0.0.1"); await once(available, "listening");
  const peerPort = available.address().port;
  await new Promise(resolve => available.close(resolve));
  const peerOrigin = `https://127.0.0.1:${peerPort}`;
  const ingressDirectory = path.join(dataRoot, "peer-ingress");
  const cert = await readFile(path.join(repository, "apps/server/test/fixtures/peer-ingress/server-cert.pem"));
  const key = await readFile(path.join(repository, "apps/server/test/fixtures/peer-ingress/server-key.pem"));
  const networkBefore = await request("/api/local-node/network");
  assert.equal(networkBefore.running, null); assert.equal(networkBefore.pending, null);
  const selection = {enabled: true, origin: peerOrigin, listenHost: "127.0.0.1", certificatePem: cert.toString(), privateKeyPem: key.toString()};
  const review = await request("/api/local-node/network/review", {revisionDigest: networkBefore.revisionDigest, selection});
  const pendingInput = {revisionDigest: networkBefore.revisionDigest, reviewDigest: review.reviewDigest, selection};
  const saved = await request("/api/local-node/network/save", pendingInput);
  assert.deepEqual(await request("/api/local-node/network/save", pendingInput), saved);
  const staged = await request("/api/local-node/network");
  assert.equal(staged.running, null); assert.equal(staged.saved, null); assert.equal(staged.pending.origin, peerOrigin);
  assert.equal(JSON.stringify(staged).includes("PRIVATE KEY"), false);
  const peerRequest = (route, headers = {}) => new Promise((resolve, reject) => {
    const request = https.get(peerOrigin + route, { ca: cert, agent: false, headers }, response => {
      let body = ""; response.on("data", chunk => body += chunk); response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode, body }));
    });
    request.once("error", reject); request.setTimeout(10_000, () => request.destroy(new Error("Peer fixture timeout")));
  });
  await assert.rejects(peerRequest("/api/auth/status"));
  await running.stop();
  await assert.rejects(fetch(ready.origin + "/api/health/ready"));
  const collision = net.createServer();
  collision.listen(Number(new URL(ready.origin).port), "127.0.0.1"); await once(collision, "listening");
  try {
    const blocked = launch();
    const blockedResult = await blocked.host.terminal;
    assert.notEqual(blockedResult.code, 0); assert.equal(blocked.events.length, 0); await blocked.host.stop();
  } finally { await new Promise((resolve) => collision.close(resolve)); }
  const peerCollision = net.createServer(); peerCollision.listen(peerPort, "127.0.0.1"); await once(peerCollision, "listening");
  try {
    const blocked = launch(); const result = await blocked.host.terminal;
    assert.notEqual(result.code, 0); assert.equal(blocked.events.length, 0); await blocked.host.stop();
    await assert.rejects(fetch(ready.origin + "/api/health/ready"));
  } finally { await new Promise(resolve => peerCollision.close(resolve)); }
  assert.deepEqual(await readFile(path.join(dataRoot, "identity.json")), identityBefore);
  running = launch();
  const reopened = await running.event("ready");
  assert.equal(reopened.origin, ready.origin); assert.equal(reopened.nodeId, ready.nodeId);
  const peerStatus = await peerRequest("/api/auth/status");
  assert.equal(peerStatus.status, 200); assert.equal(JSON.parse(peerStatus.body).peerOnly, true);
  assert.equal((await peerRequest("/api/local-node/control/state")).status, 403);
  assert.equal((await peerRequest("/api/auth/session", { authorization: `Bearer ${owner.session.token}` })).status, 403);
  owner = await ownerEntry(reopened); assert.equal(owner.user.userId, ownerId);
  const appliedNetwork = await request("/api/local-node/network");
  assert.equal(appliedNetwork.pending, null); assert.equal(appliedNetwork.running.origin, peerOrigin);
  assert.equal(appliedNetwork.running.certificateFingerprint, review.certificateFingerprint);
  const ingressConfig = await readFile(path.join(ingressDirectory, "config.json"), "utf8");
  const ingressKeyFile = JSON.parse(ingressConfig).privateKeyFile;

  await running.event("console");
  const restored = await until(async () => {
    const list = await request(`/api/teams/${team.teamId}/agents`);
    return list.length === 2 && list.every((agent) => agent.presence === "ready") ? list : null;
  }, "restart Agent readiness");
  assert.deepEqual(restored.map((agent) => agent.agentId).sort(), participants.map((agent) => agent.agentId).sort());
  assert.equal((await request(`/api/rooms/${room.roomId}/runs`)).find((item) => item.runId === runId).state, "completed");
  const recoveredDiscussion = await request(`/api/discussions/${discussionId}`);
  assert.equal(recoveredDiscussion.discussion.state, "completed");
  assert.deepEqual(recoveredDiscussion.turns.map((turn) => turn.runId), completed.turns.map((turn) => turn.runId));
  assert.equal(await readFile(path.join(root, "fixture-calls.jsonl"), "utf8"), callsBefore, "restart executed completed work again");
  await running.stop();
  await assert.rejects(peerRequest("/api/auth/status"));
  await exec(hostBinary, ["--data-dir", dataRoot, "--backup", snapshot]);
  await rename(dataRoot, path.join(root, "preserved-stopped-node"));
  await exec(hostBinary, ["--data-dir", dataRoot, "--restore", snapshot]);
  running = launch();
  const recovered = await running.event("ready");
  assert.equal(recovered.origin, ready.origin); assert.equal(recovered.nodeId, ready.nodeId);
  assert.equal(await readFile(path.join(ingressDirectory, "config.json"), "utf8"), ingressConfig);
  assert.deepEqual(await readFile(path.join(ingressDirectory, ingressKeyFile)), key);
  assert.equal((await peerRequest("/api/auth/status")).status, 200);
  owner = await ownerEntry(recovered); assert.equal(owner.user.userId, ownerId);
  await running.event("console");
  assert.equal((await request(`/api/discussions/${discussionId}`)).discussion.state, "completed");
  assert.equal(await readFile(path.join(root, "fixture-calls.jsonl"), "utf8"), callsBefore, "restore replayed completed work");
  assert.deepEqual(await readFile(path.join(processRoot, "node-process-owner.json")), processOwnerBefore);
  // A fresh request must still execute through the restored Bridge inbox.
  await until(async () => (await request(`/api/teams/${team.teamId}/agents`)).every((agent) => agent.presence === "ready"), "restored Bridge readiness");
  const next = await request(`/api/rooms/${room.roomId}/messages`, { content: "Verify a new request after restore", mentionAgentId: agents[0].agentId });
  await until(async () => (await request(`/api/rooms/${room.roomId}/runs`)).find((run) => run.runId === next.runs[0].runId)?.state === "completed", "post-restore Run");
  assert.equal((await readFile(path.join(root, "fixture-calls.jsonl"), "utf8")).trim().split("\n").length, 5);
  await running.stop();
  await t.test("disabled Relay configuration and private cache survive native backup and restore without starting ACME", async () => {
    const disabledRoot = path.join(root, "disabled-relay-node");
    let disabled = launch(disabledRoot);
    const first = await disabled.event("ready");
    const firstOwner = await ownerEntry(first);
    await disabled.stop();
    const identity = await readFile(path.join(disabledRoot, "identity.json"));
    const { localAuthorityPrivateKey } = await import(pathToFileURL(path.join(bundle, "apps/server/dist/security/authority-service.js")));
    const publicKey = createPublicKey(localAuthorityPrivateKey({ identity: JSON.parse(identity) }))
      .export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
    const profile = { schemaVersion: 1, id: "disabled-native-fixture", displayName: "Disabled native fixture",
      relayOrigin: "https://relay.native.invalid", nodeDomain: "nodes.native.invalid",
      acmeDirectoryUrl: "https://ca.native.invalid/directory", termsUrl: "https://ca.native.invalid/terms" };
    const relayOrigin = `https://${relayHostname(publicKey, profile.nodeDomain)}`;
    const relayRoot = path.join(disabledRoot, "relay");
    const configuration = Buffer.from(JSON.stringify({ schemaVersion: 1, profile, origin: relayOrigin, enabled: false, termsAccepted: true }));
    // This deliberately opaque cache must be backed up byte-for-byte and never
    // parsed while the Owner's saved Relay choice is disabled.
    const cache = Buffer.from("disabled-native-private-cache-fixture\n");
    await writeFile(path.join(relayRoot, "config.json"), configuration, { mode: 0o600 });
    await writeFile(path.join(relayRoot, "certificates.json"), cache, { mode: 0o600 });
    const checkDisabled = async (entry) => {
      const localOwner = await ownerEntry(entry);
      assert.equal(localOwner.user.userId, firstOwner.user.userId);
      const response = await fetch(entry.origin + "/api/local-node/relay", { headers: {
        authorization: `Bearer ${localOwner.session.token}`, origin: entry.origin } });
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.deepEqual(status.provider, profile);
      assert.deepEqual(status.saved, { enabled: false, origin: relayOrigin });
      assert.deepEqual(status.running, defaultRelay.running);
      assert.equal(status.pending, null);
      assert.equal(JSON.stringify(status).includes(cache.toString().trim()), false);
    };
    disabled = launch(disabledRoot);
    await checkDisabled(await disabled.event("ready"));
    await disabled.stop();
    const relaySnapshot = path.join(root, "disabled-relay-snapshot");
    await exec(hostBinary, ["--data-dir", disabledRoot, "--backup", relaySnapshot]);
    await rename(disabledRoot, path.join(root, "preserved-disabled-relay-node"));
    await exec(hostBinary, ["--data-dir", disabledRoot, "--restore", relaySnapshot]);
    assert.deepEqual(await readFile(path.join(disabledRoot, "identity.json")), identity);
    for (const [name, bytes] of [["config.json", configuration], ["certificates.json", cache]]) {
      assert.deepEqual(await readFile(path.join(relayRoot, name)), bytes);
      if (process.platform !== "win32") assert.equal((await stat(path.join(relayRoot, name))).mode & 0o777, 0o600);
    }
    disabled = launch(disabledRoot);
    const recoveredRelay = await disabled.event("ready");
    assert.equal(recoveredRelay.origin, first.origin);
    assert.equal(recoveredRelay.nodeId, first.nodeId);
    await checkDisabled(recoveredRelay);
    await disabled.stop();
  });
  if (process.env.CONVENE_WIRE_LOCAL_NODE_PREVIEW_FILE) {
    const previewFile = path.resolve(process.env.CONVENE_WIRE_LOCAL_NODE_PREVIEW_FILE);
    running = launch();
    const previewReady = await running.event("ready");
    const previewConsole = await running.event("console");
    await writeFile(previewFile, JSON.stringify({ ...previewReady, ...previewConsole, teamId: team.teamId, roomId: room.roomId, discussionId }), { flag: "wx", mode: 0o600 });
    resources.defer(() => rm(previewFile, { force: true }));
    resources.defer(() => rm(`${previewFile}.done`, { force: true }));
    await until(async () => readFile(`${previewFile}.done`).then(() => true, () => false), "browser preview completion", 300_000);
    await running.stop();
  }
});
