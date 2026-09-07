import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { setup } from "../../apps/server/test/evidence-disclosure-fixture.js";
import { spawnTestProcess } from "../../scripts/test/child-process.mjs";
import { DiscussionRepository } from "../../apps/server/src/discussion/discussion-repository.js";

const execute = promisify(execFile);
async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for production disclosure Discussion");
}

test("two real Bridge processes retain private candidates and finalize only exact owner releases", { timeout: 120000, skip: process.platform === "win32" }, async t => {
  const s = await setup(t);
  const serverUrl = await s.app.listen({ host: "127.0.0.1", port: 0 });
  const binary = path.join(s.resources.directory, "convenewire-bridge");
  await execute(process.env.CONVENE_WIRE_GO_BIN ?? "go", ["build", "-o", binary, "./cmd/convenewire-bridge"], {
    cwd: path.resolve(import.meta.dirname, "../../bridge"), timeout: 60000
  });
  const helper = path.join(s.resources.directory, "runtime.mjs");
  await writeFile(helper, [
    'import { readFileSync } from "node:fs";',
    'const input = readFileSync(0, "utf8");',
    'if (process.argv[2] === "private") process.stdout.write(readFileSync("source.txt", "utf8"));',
    'else if (input.includes("## Owner-released evidence")) {',
    '  if (!input.includes("Code owner approved digest validation.") || !input.includes("Operations owner reports retirement is blocked.")) process.exit(3);',
    '  if (input.includes("PRIVATE-CODE-SENTINEL") || input.includes("PRIVATE-OPS-SENTINEL")) process.exit(4);',
    '  process.stdout.write("Authorized evidence combined: digest validation exists; retirement remains blocked. No unavailable production state is inferred.");',
    '} else process.stdout.write("Await authorized owner evidence before deciding.");'
  ].join("\n"));
  const processes = [];
  const configurations = [];
  for (const [owner, name, sentinel, release] of [
    [s.a, "CodePrivate", "PRIVATE-CODE-SENTINEL", "Code owner approved digest validation."],
    [s.b, "OpsPrivate", "PRIVATE-OPS-SENTINEL", "Operations owner reports retirement is blocked."]
  ] as const) {
    const directory = path.join(s.resources.directory, name);
    const dataDir = path.join(directory, "data");
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dataDir, "device-credential.json"), JSON.stringify({ serverUrl,
      deviceId: owner.device.deviceId, ownerMemberId: owner.device.ownerMemberId,
      teamId: owner.device.teamId, token: owner.credential.secret, expiresAt: null }), { mode: 0o600 });
    await writeFile(path.join(directory, "source.txt"), `${sentinel}\n${release}`, { mode: 0o600 });
    await writeFile(path.join(directory, "release.txt"), release, { mode: 0o600 });
    const config = path.join(directory, "bridge.json");
    const agents = [{ name, role: "Private source", adapter: "generic", command: [process.execPath, helper, "private"],
      workspace: directory, envAllowlist: [], ownerPrivateOutput: true },
    ...(name === "CodePrivate" ? [{ name: "SharedFinalizer", role: "Reviewer", adapter: "generic",
      command: [process.execPath, helper, "public"], workspace: directory, envAllowlist: [] }] : [])];
    await writeFile(config, JSON.stringify({ serverUrl, deviceName: name, dataDir, agents }), { mode: 0o600 });
    const child = spawnTestProcess(s.resources, binary, ["run", "--config", config], { stdio: ["ignore", "pipe", "pipe"] });
    let diagnostic = "";
    child.process.stderr?.on("data", value => { diagnostic = (diagnostic + String(value)).slice(-3000); });
    processes.push(child);
    configurations.push({ owner, name, sentinel, release, directory, dataDir, config });
    await until(() => {
      if (child.process.exitCode !== null) throw new Error(`Bridge exited: ${diagnostic}`);
      const agent = s.core.listAgents(owner.device.teamId).find(item => item.name === name);
      return agent?.presence === "ready" ? agent : undefined;
    });
  }
  const agents = s.core.listAgents(s.a.device.teamId);
  const code = agents.find(item => item.name === "CodePrivate")!;
  const ops = agents.find(item => item.name === "OpsPrivate")!;
  const finalizer = agents.find(item => item.name === "SharedFinalizer")!;
  s.teams.replaceRoomParticipants(s.a.principal, s.room.roomId, {
    memberIds: [s.a.device.ownerMemberId, s.b.device.ownerMemberId],
    agentIds: [code.agentId, ops.agentId, finalizer.agentId]
  }, s.now());
  const response = await s.request("POST", `/api/rooms/${s.room.roomId}/discussions`, s.a.session.secret, {
    goal: "Combine Code and Operations evidence without disclosing private source files.",
    participantAgentIds: [code.agentId, ops.agentId, finalizer.agentId], mode: "review", outputMode: "final_answer",
    policy: { initialLeaseTurns: 1, automaticMaxTurns: 1, hardMaxTurns: 3, waveTimeoutSeconds: 300,
      participantSelectionMode: "all_eligible" }
  });
  assert.equal(response.statusCode, 200, response.body);
  const id = response.json().discussion.discussionId;
  const repository = new DiscussionRepository(s.db);
  await until(() => repository.listTurns(id).every(turn => turn.runId && s.runRepo.getRun(turn.runId)?.state === "completed") ? true : undefined);
  for (const item of configurations) {
    const agent = item.name === "CodePrivate" ? code : ops;
    const turn = repository.listTurns(id).find(value => value.speakerAgentId === agent.agentId)!;
    assert.equal(turn.terminalReason, "awaiting_owner_disclosure");
    const candidate = path.join(item.dataDir, "private-output", `${turn.runId}.txt`);
    assert.ok((await readFile(candidate, "utf8")).includes(item.sentinel));
    assert.equal((await stat(candidate)).mode & 0o077, 0);
    const bundle = path.join(item.directory, "release-bundle.json");
    await execute(binary, ["disclosure", "prepare", "--config", item.config, "--agent", item.name,
      "--run-id", turn.runId!, "--source-file", path.join(item.directory, "source.txt"),
      "--release-file", path.join(item.directory, "release.txt"), "--evidence-ref", `evidence_${item.name}_snapshot`, "--bundle", bundle]);
    const intent = JSON.parse(await readFile(`${bundle}.request.json`, "utf8"));
    const approval = await s.approve(item.owner, intent);
    assert.equal(approval.statusCode, 200, approval.body);
    await execute(binary, ["disclosure", "publish", "--config", item.config, "--agent", item.name,
      "--bundle", bundle, "--grant-id", approval.json().grantId]);
    assert.equal(repository.getTurn(turn.turnId)?.terminalReason, "disclosure_released");
  }
  const finished = await s.request("POST", `/api/discussions/${id}/actions`, s.a.session.secret, { action: "finish" });
  assert.equal(finished.statusCode, 200, finished.body);
  await until(() => repository.get(id)?.state === "completed" ? true : undefined);
  const final = repository.listTurns(id).find(turn => turn.kind === "finalization")!;
  assert.equal(final.state, "completed");
  assert.equal(final.speakerAgentId, finalizer.agentId);
  const finalMessage = s.core.getMessage(final.outputMessageId!)!;
  assert.match(finalMessage.content, /Authorized evidence combined/u);
  assert.equal(repository.listTurns(id).length, 4);
  for (const item of configurations) {
    const central = JSON.stringify(s.db.prepare("SELECT content FROM messages WHERE room_id = ?").all(s.room.roomId)) +
      JSON.stringify(s.db.prepare("SELECT instruction FROM runs WHERE room_id = ?").all(s.room.roomId));
    assert.equal(central.includes(item.sentinel), false);
    assert.ok(s.runRepo.getRun(final.runId!)!.instruction.includes(item.release));
  }
  for (const child of processes) await child.stop();
});
