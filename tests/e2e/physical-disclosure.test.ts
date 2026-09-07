import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { setup } from "../../apps/server/test/evidence-disclosure-fixture.js";
import { DiscussionRepository } from "../../apps/server/src/discussion/discussion-repository.js";
import { spawnTestProcess } from "../../scripts/test/child-process.mjs";
import { physicalConfig, PhysicalWindowsHost, ps } from "./physical-disclosure-host.js";

const execute = promisify(execFile);
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const codeRelease = "Code owner approved digest validation.";
const opsRelease = "Operations owner reports retirement is blocked.";
const codeSentinel = "QA085-PRIVATE-CODE-SENTINEL";
const opsSentinel = "QA085-PRIVATE-OPS-SENTINEL";

async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const limit = Date.now() + 30000;
  while (Date.now() < limit) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Physical disclosure observation timed out");
}

// Explicit physical test; routine local/CI test discovery must not contact hosts.
test("QA-085 physical macOS/Windows disclosure and independent identity denials", {
  skip: process.env.CONVENE_WIRE_PHYSICAL_DISCLOSURE !== "1", timeout: 480000
}, async t => {
  const config = await physicalConfig();
  const remote = new PhysicalWindowsHost(config);
  const s = await setup(t);
  const checks: { name: string; outcome: "pass"; observedAt: string; detail?: unknown }[] = [];
  const record = (name: string, detail?: unknown) => checks.push({ name, outcome: "pass", observedAt: new Date().toISOString(), ...(detail === undefined ? {} : { detail }) });
  const marker = randomUUID(), remoteRoot = `${config.workspace}\\.cache\\qa085-${marker}`;
  const report: Record<string, unknown> = { task: "QA-085", version: 1, startedAt: new Date().toISOString(),
    controller: "one authorized test controller", owners: "two independent test Member/Device identities",
    runtime: "deterministic Generic; zero external-model calls", transport: "production HTTP/WebSocket over host-pinned SSH loopback tunnel",
    checks, outcome: "running" };
  // Retain a sanitized incomplete/failure record as well as successful evidence.
  t.after(async () => {
    if (!checks.some(check => check.name === "remote_owned_root_removed_and_checkout_unchanged")) report.outcome = "incomplete";
    report.finishedAt = new Date().toISOString();
    await writeFile(config.reportFile, JSON.stringify(report, null, 2));
  });

  const before = await remote.run(`git -C ${ps(config.workspace)} rev-parse HEAD; git -C ${ps(config.workspace)} status --porcelain`);
  assert.match(before, /^[a-f0-9]{40}$/u, "Physical checkout must initially be clean");
  report.remoteCheckoutBase = before;
  report.localSource = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
  const pinnedFiles = ["tests/e2e/physical-disclosure-host.ts", "tests/e2e/physical-disclosure.test.ts",
    "tests/e2e/disclosure-discussion.test.ts", "apps/server/test/evidence-disclosure-fixture.ts",
    "bridge/internal/privatefs/privatefs.go", "bridge/internal/privatefs/privatefs_windows.go",
    "bridge/internal/privatefs/privatefs_unix.go", "bridge/internal/runtime/private_output.go",
    "bridge/cmd/convenewire-bridge/disclosure.go", "bridge/internal/config/config.go",
    "docs/adr/0058-protect-windows-private-output.md"];
  report.sourceFileSha256 = Object.fromEntries(await Promise.all(pinnedFiles.map(async name => [name, sha(await readFile(name))])));
  report.windowsBinarySha256 = sha(await readFile(config.windowsBinary));
  const platform = await remote.run(`& ${ps(config.node)} -p 'JSON.stringify({platform:process.platform,arch:process.arch,node:process.version})'`);
  assert.equal(JSON.parse(platform).platform, "win32");
  report.windowsRuntime = JSON.parse(platform);
  report.windowsMachine = JSON.parse(await remote.run("Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model | ConvertTo-Json -Compress"));
  report.sshHostPinSha256 = sha(await readFile(config.knownHostsFile));
  report.controllerPlatform = process.platform;
  assert.equal(process.platform, "darwin", "This acceptance freezes macOS plus native Windows");
  assert.notEqual(s.a.device.ownerMemberId, s.b.device.ownerMemberId);
  assert.notEqual(s.a.credential.secret, s.b.credential.secret);
  record("distinct_members_and_device_credentials");
  await remote.createRoot(remoteRoot, marker);
  s.resources.defer(async () => {
    await remote.removeRoot(remoteRoot, marker);
    const after = await remote.run(`git -C ${ps(config.workspace)} rev-parse HEAD; git -C ${ps(config.workspace)} status --porcelain`);
    assert.equal(after, before);
    record("remote_owned_root_removed_and_checkout_unchanged");
  });
  const serverUrl = await s.app.listen({ host: "127.0.0.1", port: 0 });
  const port = new URL(serverUrl).port;
  const tunnel = spawnTestProcess(s.resources, "ssh", [...remote.options, "-N", "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=10", "-R", `127.0.0.1:${port}:127.0.0.1:${port}`, config.host], { stdio: ["ignore", "pipe", "pipe"] });
  await until(async () => {
    try { return (await remote.run(`(Invoke-WebRequest -UseBasicParsing -Uri ${ps(serverUrl + "/api/health/live")}).StatusCode`)) === "200" ? true : undefined; }
    catch { if (tunnel.process.exitCode !== null) throw new Error("Physical tunnel failed"); return undefined; }
  });
  record("host_pinned_tunnel_reaches_production_central");
  const binary = path.join(s.resources.directory, "bridge");
  await execute("go", ["build", "-o", binary, "./cmd/convenewire-bridge"], { cwd: path.resolve("bridge"), timeout: 90000 });
  report.macBinarySha256 = sha(await readFile(binary));
  await remote.put(config.windowsBinary, `${remoteRoot}\\bridge.exe`);
  assert.equal((await remote.run(`(Get-FileHash -Algorithm SHA256 -LiteralPath ${ps(`${remoteRoot}\\bridge.exe`)}).Hash`)).toLowerCase(), report.windowsBinarySha256);
  record("native_windows_binary_hash_verified");

  const helper = path.join(s.resources.directory, "runtime.mjs");
  await writeFile(helper, [
    'import {readFileSync} from "node:fs";',
    'const input=readFileSync(0,"utf8");',
    'if(process.argv[2]==="private")process.stdout.write(readFileSync("source.txt","utf8"));',
    'else if(input.includes("## Owner-released evidence")){',
    `if(input.includes(${JSON.stringify(codeSentinel)})||input.includes(${JSON.stringify(opsSentinel)}))process.exit(4);`,
    `if(!input.includes(${JSON.stringify(codeRelease)}))process.exit(5);`,
    `if(input.includes(${JSON.stringify(opsRelease)}))process.stdout.write("Authorized evidence combined: digest validation exists; retirement remains blocked.");`,
    'else if(input.includes("disclosure_unavailable"))process.stdout.write("Code digest validation exists. Operations evidence is unavailable; current cutover and retirement status cannot be determined. Request a new authorized Operations snapshot.");',
    'else process.exit(6);',
    '}else process.stdout.write("Await authorized owner evidence before deciding.");'
  ].join("\n"));
  await remote.put(helper, `${remoteRoot}\\runtime.mjs`);
  const localDir = path.join(s.resources.directory, "mac-owner"), dataDir = path.join(localDir, "data");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(localDir, "source.txt"), `${codeSentinel}\n${codeRelease}`, { mode: 0o600 });
  await writeFile(path.join(localDir, "release.txt"), codeRelease, { mode: 0o600 });
  await writeFile(path.join(dataDir, "device-credential.json"), JSON.stringify({ serverUrl, deviceId: s.a.device.deviceId,
    ownerMemberId: s.a.device.ownerMemberId, teamId: s.a.device.teamId, token: s.a.credential.secret, expiresAt: null }), { mode: 0o600 });
  const localConfig = path.join(localDir, "bridge.json");
  await mkdir(path.join(localDir, "public"));
  await writeFile(localConfig, JSON.stringify({ serverUrl, deviceName: "QA085Mac", dataDir, agents: [
    { name: "CodePrivate", role: "Private Code", adapter: "generic", command: [process.execPath, helper, "private"], workspace: localDir, envAllowlist: [], ownerPrivateOutput: true },
    { name: "SharedFinalizer", role: "Reviewer", adapter: "generic", command: [process.execPath, helper, "public"], workspace: path.join(localDir, "public"), envAllowlist: [] }
  ] }), { mode: 0o600 });
  const remoteData = `${remoteRoot}\\data`, remoteConfig = `${remoteRoot}\\bridge.json`;
  await remote.run(`New-Item -ItemType Directory -Path ${ps(remoteData)} | Out-Null
    [IO.File]::WriteAllText(${ps(`${remoteRoot}\\source.txt`)},${ps(`${opsSentinel}\n${opsRelease}`)})
    [IO.File]::WriteAllText(${ps(`${remoteRoot}\\release.txt`)},${ps(opsRelease)})`);
  await remote.putJson(path.join(s.resources.directory, "remote-credential.json"), `${remoteData}\\device-credential.json`, {
    serverUrl, deviceId: s.b.device.deviceId, ownerMemberId: s.b.device.ownerMemberId, teamId: s.b.device.teamId,
    token: s.b.credential.secret, expiresAt: null
  });
  await remote.putJson(path.join(s.resources.directory, "remote-config.json"), remoteConfig, { serverUrl,
    deviceName: "QA085Windows", dataDir: remoteData, agents: [{ name: "OpsPrivate", role: "Private Operations",
      adapter: "generic", command: [config.node, `${remoteRoot}\\runtime.mjs`, "private"], workspace: remoteRoot,
      envAllowlist: [], ownerPrivateOutput: true }] });
  // Only the Windows test identity's session is transferred for its owner HTTP
  // approvals. The Mac owner's session is never provisioned to the Windows host.
  await remote.putJson(path.join(s.resources.directory, "remote-session.json"), `${remoteRoot}\\owner-session.json`, { token: s.b.session.secret });
  const localBridge = () => spawnTestProcess(s.resources, binary, ["run", "--config", localConfig], { stdio: ["ignore", "pipe", "pipe"] });
  let mac = localBridge(), win = await remote.bridge(s.resources, remoteRoot, remoteConfig);
  const ready = async (name: string) => until(() => {
    const agent = s.core.listAgents(s.a.device.teamId).find(value => value.name === name);
    return agent?.presence === "ready" ? agent : undefined;
  });
  const code = await ready("CodePrivate"), ops = await ready("OpsPrivate"), finalizer = await ready("SharedFinalizer");
  assert.equal(code.deviceId, s.a.device.deviceId);
  assert.equal(ops.deviceId, s.b.device.deviceId);
  s.teams.replaceRoomParticipants(s.a.principal, s.room.roomId, {
    memberIds: [s.a.device.ownerMemberId, s.b.device.ownerMemberId], agentIds: [code.agentId, ops.agentId, finalizer.agentId]
  }, s.now());
  record("two_physical_bridges_advertise_bound_private_agents");
  const repository = new DiscussionRepository(s.db);
  async function request(method: string, url: string, secret: string, body?: unknown) {
    const response = await fetch(serverUrl + url, { method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  }
  async function approveWindows(requestFile: string) {
    const output = await remote.run(`$s=Get-Content -Raw -LiteralPath ${ps(`${remoteRoot}\\owner-session.json`)} | ConvertFrom-Json
      $body=Get-Content -Raw -LiteralPath ${ps(requestFile)}
      Invoke-RestMethod -Method Post -Uri ${ps(serverUrl + "/api/evidence-disclosures")} -Headers @{Authorization=('Bearer '+$s.token)} -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 20 -Compress`);
    return JSON.parse(output);
  }
  async function start(name: string) {
    const created = await request("POST", `/api/rooms/${s.room.roomId}/tasks`, s.a.session.secret, {
      title: `QA085 ${name}`, goal: "Combine only approved Code and Operations evidence; preserve unavailable operational state.",
      criteria: [{ criterionKey: "criterion_authorized_sources", description: "Use both authorized sources when available; never include raw private source.", required: true, ordinal: 1 },
        { criterionKey: "criterion_unknown_operations", description: "If Operations is unavailable, preserve cutover and retirement uncertainty and request an authorized snapshot.", required: true, ordinal: 2 }],
      assignments: [{ agentId: code.agentId, role: "contributor" }, { agentId: ops.agentId, role: "contributor" }, { agentId: finalizer.agentId, role: "primary" }]
    });
    assert.equal(created.status, 200);
    const task = created.body;
    const activated = await request("POST", `/api/tasks/${task.taskId}/control`, s.a.session.secret, {
      operationId: `op_qa085_${randomUUID().replaceAll("-", "")}`, expectedTaskRevision: task.taskRevision, lifecycleState: "active"
    });
    assert.equal(activated.status, 200);
    const response = await request("POST", `/api/rooms/${s.room.roomId}/discussions`, s.a.session.secret, {
      goal: task.goal, taskId: task.taskId, participantAgentIds: [code.agentId, ops.agentId, finalizer.agentId],
      mode: "review", outputMode: "final_answer", policy: { initialLeaseTurns: 1, automaticMaxTurns: 1,
        hardMaxTurns: 3, waveTimeoutSeconds: 300, participantSelectionMode: "all_eligible" }
    });
    assert.equal(response.status, 200);
    const id = response.body.discussion.discussionId;
    await until(() => {
      const turns = repository.listTurns(id);
      return turns.length === 3 && turns.every(turn => turn.runId && s.runRepo.getRun(turn.runId)?.state === "completed") ? true : undefined;
    });
    const a = repository.listTurns(id).find(turn => turn.speakerAgentId === code.agentId)!;
    const b = repository.listTurns(id).find(turn => turn.speakerAgentId === ops.agentId)!;
    assert.equal(a.terminalReason, "awaiting_owner_disclosure");
    assert.equal(b.terminalReason, "awaiting_owner_disclosure");
    const candidate = `${remoteData}\\private-output\\${b.runId}.txt`;
    const acl = JSON.parse(await remote.run(`$f=Get-Item -LiteralPath ${ps(candidate)}; $a=Get-Acl -LiteralPath $f.FullName
      @{protected=$a.AreAccessRulesProtected;owner=$a.Owner;containsPrivate=(Get-Content -Raw -LiteralPath $f.FullName).Contains(${ps(opsSentinel)});sddl=$a.Sddl} | ConvertTo-Json -Compress`));
    assert.equal(acl.protected, true);
    assert.equal(acl.containsPrivate, true);
    assert.equal((await readFile(path.join(dataDir, "private-output", `${a.runId}.txt`), "utf8")).includes(codeSentinel), true);
    record(`${name}_private_candidates_local_and_waiting`, { windowsProtectedDacl: acl.protected });
    const localBundle = path.join(localDir, `${name}.json`), remoteBundle = `${remoteRoot}\\${name}.json`;
    await execute(binary, ["disclosure", "prepare", "--config", localConfig, "--agent", "CodePrivate", "--run-id", a.runId!,
      "--source-file", path.join(localDir, "source.txt"), "--release-file", path.join(localDir, "release.txt"),
      "--evidence-ref", "evidence_qa085_code_snapshot", "--bundle", localBundle]);
    await remote.run(`& ${ps(`${remoteRoot}\\bridge.exe`)} 'disclosure' 'prepare' '--config' ${ps(remoteConfig)} '--agent' 'OpsPrivate'
      '--run-id' ${ps(b.runId!)} '--source-file' ${ps(`${remoteRoot}\\source.txt`)} '--release-file' ${ps(`${remoteRoot}\\release.txt`)}
      '--evidence-ref' 'evidence_qa085_ops_snapshot' '--bundle' ${ps(remoteBundle)}; exit $LASTEXITCODE`.replaceAll(/\n\s+/gu, " "));
    const ai = JSON.parse(await readFile(`${localBundle}.request.json`, "utf8")), bi = await remote.readJson(`${remoteBundle}.request.json`);
    return { id, a, b, ai, bi, localBundle, remoteBundle };
  }
  async function publishLocal(bundle: string, grantId: string) {
    return (await execute(binary, ["disclosure", "publish", "--config", localConfig, "--agent", "CodePrivate", "--bundle", bundle, "--grant-id", grantId])).stdout;
  }
  async function publishWindows(bundle: string, grantId: string) {
    return remote.run(`& ${ps(`${remoteRoot}\\bridge.exe`)} 'disclosure' 'publish' '--config' ${ps(remoteConfig)} '--agent' 'OpsPrivate' '--bundle' ${ps(bundle)} '--grant-id' ${ps(grantId)}; exit $LASTEXITCODE`);
  }
  async function finish(id: string, revoked: boolean) {
    const response = await request("POST", `/api/discussions/${id}/actions`, s.a.session.secret, { action: "finish" });
    assert.equal(response.status, 200);
    await until(() => repository.get(id)?.state === "completed" ? true : undefined);
    const final = repository.listTurns(id).find(turn => turn.kind === "finalization")!;
    assert.equal(final.state, "completed");
    const run = s.runRepo.getRun(final.runId!)!;
    const content = s.core.getMessage(final.outputMessageId!)!.content;
    assert.ok(run.instruction.includes(codeRelease) && run.instruction.includes("criterion_authorized_sources"));
    assert.equal(run.instruction.includes(opsRelease), !revoked);
    assert.match(content, revoked ? /Operations evidence is unavailable.*Request a new authorized Operations snapshot/u : /retirement remains blocked/u);
    assert.equal(repository.listTurns(id).length, 4);
    const shared = JSON.stringify(s.db.prepare("SELECT content FROM messages").all()) + JSON.stringify(s.db.prepare("SELECT instruction FROM runs").all()) +
      JSON.stringify(s.db.prepare("SELECT * FROM run_events").all());
    assert.equal(shared.includes(codeSentinel) || shared.includes(opsSentinel), false);
    record(revoked ? "revoked_final_preserves_uncertainty" : "normal_two_source_finalization", {
      discussionId: id, finalRunId: final.runId, finalMessageId: final.outputMessageId, finalText: content,
      finalInstructionSha256: sha(run.instruction), turns: 4, rawSentinelsShared: false
    });
  }

  const normal = await start("normal");
  assert.equal((await request("POST", "/api/evidence-disclosures", s.a.session.secret, normal.bi)).status, 403);
  assert.equal((await request("POST", "/api/evidence-disclosures", s.b.session.secret, normal.ai)).status, 403);
  record("cross_owner_approval_denied_both_directions");
  const ag = await request("POST", "/api/evidence-disclosures", s.a.session.secret, normal.ai);
  assert.equal(ag.status, 200);
  const bg = await approveWindows(`${normal.remoteBundle}.request.json`);
  assert.equal((await request("GET", `/api/bridge/evidence-disclosures/${bg.grantId}`, s.a.credential.secret)).status, 403);
  assert.equal((await request("POST", "/api/bridge/evidence-disclosures/publish", s.a.credential.secret,
    { grantId: bg.grantId, expectedRevision: 1, content: opsRelease })).status, 403);
  assert.equal((await request("POST", "/api/bridge/evidence-disclosures/publish", s.b.credential.secret,
    { grantId: ag.body.grantId, expectedRevision: 1, content: codeRelease })).status, 403);
  record("cross_owner_device_grant_read_and_publication_denied");
  assert.equal((await request("POST", "/api/bridge/evidence-disclosures/publish", s.b.credential.secret,
    { grantId: bg.grantId, expectedRevision: 1, content: opsRelease + " unapproved" })).status, 403);
  assert.equal((await request("POST", "/api/bridge/evidence-disclosures/publish", s.b.credential.secret,
    { grantId: "disclosure_qa085_forged000000", expectedRevision: 1, content: opsRelease })).status, 403);
  record("changed_content_and_unissued_grant_denied");
  await publishLocal(normal.localBundle, ag.body.grantId);
  await publishWindows(normal.remoteBundle, bg.grantId);
  const admitted = repository.getTurn(normal.b.turnId)!.assessment;
  await mac.stop();
  const offlineFinish = await request("POST", `/api/discussions/${normal.id}/actions`, s.a.session.secret, { action: "finish" });
  assert.equal(offlineFinish.status, 200);
  const offlineFinal = await until(() => repository.listTurns(normal.id).find(turn => turn.kind === "finalization"));
  const frozenInstruction = s.runRepo.getRun(offlineFinal.runId!)!.instruction;
  assert.notEqual(s.runRepo.getRun(offlineFinal.runId!)!.state, "completed");
  record("offline_finalizer_input_frozen_before_delivery", { finalRunId: offlineFinal.runId, instructionSha256: sha(frozenInstruction) });
  await win.stop();
  await s.restart();
  await s.app.listen({ host: "127.0.0.1", port: Number(port) });
  win = await remote.bridge(s.resources, remoteRoot, remoteConfig);
  mac = localBridge();
  await ready("OpsPrivate");
  await ready("SharedFinalizer");
  assert.match(await publishWindows(normal.remoteBundle, bg.grantId), /replayed=true/u);
  assert.deepEqual(repository.getTurn(normal.b.turnId)!.assessment, admitted);
  assert.equal(s.runRepo.getRun(offlineFinal.runId!)!.instruction, frozenInstruction);
  const duplicates = s.db.prepare("SELECT count(*) AS n FROM task_results WHERE proposed_by_run_id = ?").get(normal.b.runId) as { n: number };
  assert.equal(duplicates.n, 1);
  record("windows_bridge_and_central_restart_exact_retry_no_duplicate");
  await finish(normal.id, false);
  assert.equal(repository.listTurns(normal.id).find(turn => turn.kind === "finalization")?.runId, offlineFinal.runId);
  record("offline_finalizer_reconnect_preserves_same_run_and_input");

  const revoked = await start("revoked");
  const rag = await request("POST", "/api/evidence-disclosures", s.a.session.secret, revoked.ai);
  assert.equal(rag.status, 200);
  const rbg = await approveWindows(`${revoked.remoteBundle}.request.json`);
  await publishLocal(revoked.localBundle, rag.body.grantId);
  const revoke = await request("POST", `/api/evidence-disclosures/${rbg.grantId}/revoke`, s.b.session.secret, { expectedRevision: 1 });
  assert.equal(revoke.status, 200);
  await assert.rejects(publishWindows(revoked.remoteBundle, rbg.grantId));
  assert.equal((await request("POST", "/api/bridge/evidence-disclosures/publish", s.b.credential.secret,
    { grantId: rbg.grantId, expectedRevision: 1, content: opsRelease })).status, 403);
  record("revoked_windows_disclosure_denied_locally_and_at_central");
  await finish(revoked.id, true);
  assert.equal(repository.getTurn(revoked.b.turnId)?.terminalReason, "disclosure_unavailable");
  await win.stop();
  await mac.stop();
  await tunnel.stop();
  report.outcome = "passed";
});
