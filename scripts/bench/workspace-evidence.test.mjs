import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { workspacePacket, documentsFor, prepareWorkspaces, sha256, workspaceTaskInput } from "./workspace-evidence.mjs";
import { createTestResources } from "../test/resources.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";

test("frozen sources reproduce exact Git excerpts and fair disjoint access without rubrics", async (t) => {
  const resources = await createTestResources(t, "convenewire-evidence-packet-");
  const workspaces = prepareWorkspaces(resources.directory);
  assert.equal(workspacePacket.cases.length, 3);
  assert.equal(workspacePacket.maximumInvocations, 12);
  assert.equal(workspacePacket.maximumReads, 8);
  for (const sample of workspacePacket.cases) {
    assert.equal(sample.rubric.length, 4);
    const solver = documentsFor(sample, "Solver"), reviewer = documentsFor(sample, "Reviewer");
    assert.ok(solver.length && reviewer.length);
    assert.deepEqual(documentsFor(sample, "Baseline"), [...solver, ...reviewer]);
    assert.equal(new Set(sample.documents.map(({ id }) => id)).size, sample.documents.length);
    for (const doc of sample.documents) {
      const source = execFileSync("git", ["show", `${doc.source.commit}:${doc.source.path}`], { encoding: "utf8" });
      assert.equal(sha256(source), doc.source.sha256);
      assert.equal(doc.content, source.split(/(?<=\n)/u).slice(doc.source.startLine - 1, doc.source.endLine).join(""));
      assert.equal(sha256(doc.content), doc.sha256);
      assert.ok(doc.source.commit.length === 40);
    }
    for (const role of Object.keys(workspaces)) {
      const materialized = JSON.parse(await readFile(path.join(workspaces[role], "evidence.json"), "utf8"));
      const scoped = materialized.cases.find(({ id }) => id === sample.id);
      assert.deepEqual(scoped.documents, documentsFor(sample, role));
      assert.deepEqual(Object.keys(scoped).sort(), ["documents", "id"]);
      for (const criterion of sample.rubric) assert.ok(!JSON.stringify(materialized).includes(criterion.text));
    }
    assert.match(workspaceTaskInput(sample, "fixed review"), /fixed review$/u);
  }
});

async function connect(workspace, receipt) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.resolve("scripts/bench/evidence-reader.mjs"), path.join(workspace, "evidence.json"), "delivery", receipt],
    env: { PATH: process.env.PATH }, stderr: "pipe" });
  const client = new Client({ name: "offline-test", version: "1" });
  await client.connect(transport);
  return client;
}

test("MCP serves only fixed IDs and preserves its read limit across process restart", async (t) => {
  const resources = await createTestResources(t, "convenewire-evidence-scope-");
  const workspaces = prepareWorkspaces(resources.directory);
  const receipt = path.join(resources.directory, "receipts");
  await mkdir(receipt);
  let client = await connect(workspaces.Solver, receipt);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools[0].inputSchema.properties.id.enum, ["delivery-parser", "delivery-observation"]);
    const valid = await client.callTool({ name: "read_evidence", arguments: { id: "delivery-parser" } });
    assert.equal(JSON.parse(valid.content[0].text).sha256, workspacePacket.cases[0].documents[0].sha256);
    for (const args of [{ id: "delivery-schema" }, { id: "../../config.toml" }, { id: "delivery-parser", role: "Baseline" }]) {
      assert.equal((await client.callTool({ name: "read_evidence", arguments: args })).isError, true);
    }
  } finally { await client.close(); }
  client = await connect(workspaces.Solver, receipt);
  try {
    for (let index = 0; index < 4; index += 1) assert.ok(!(await client.callTool({ name: "read_evidence", arguments: { id: "delivery-parser" } })).isError);
    assert.equal((await client.callTool({ name: "read_evidence", arguments: { id: "delivery-parser" } })).isError, true);
    const names = await readdir(receipt);
    assert.equal(names.length, 8);
    const text = (await Promise.all(names.map((name) => readFile(path.join(receipt, name), "utf8")))).join("");
    assert.ok(!text.includes("config.toml") && !text.includes("role"));
  } finally { await client.close(); }
});

async function invoke(t, fakeSource, { exhausted = false, role = "Baseline" } = {}) {
  const resources = await createTestResources(t, "convenewire-evidence-adapter-");
  const workspaces = prepareWorkspaces(resources.directory);
  const quota = path.join(resources.directory, "quota");
  await mkdir(quota);
  if (exhausted) for (let i = 0; i < 12; i += 1) await writeFile(path.join(quota, `invocation-${i}`), "");
  const fake = path.join(resources.directory, "fake-codex.mjs");
  await writeFile(fake, `#!${process.execPath}\n${fakeSource}\n`);
  await chmod(fake, 0o700);
  const child = spawnTestProcess(resources, process.execPath,
    [path.resolve("scripts/bench/codex-evidence-answer.mjs"), fake, "gpt-5.4-mini", quota, "12", role],
    { cwd: workspaces.Baseline, env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.process.stdout.on("data", (chunk) => { stdout += chunk; });
  child.process.stderr.on("data", (chunk) => { stderr += chunk; });
  child.process.stdin.end(workspaceTaskInput(workspacePacket.cases[0], "check facts"));
  const closed = new Promise((resolve) => child.process.once("close", resolve));
  const result = await child.terminal;
  await closed;
  return { ...result, stdout, stderr, quota };
}

test("adapter executes actual MCP reads and emits only the accepted final answer", async (t) => {
  const result = await invoke(t, `import ${JSON.stringify(path.resolve("scripts/bench/synthetic-evidence-codex.mjs"))};`);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Synthetic transport check only:/u);
  const metadata = JSON.parse(await readFile(path.join(result.quota, "receipt-0/invocation.json"), "utf8"));
  assert.equal(metadata.runtimeSucceeded, true);
  assert.equal((await readdir(path.join(result.quota, "receipt-0"))).length, 6);
});

test("adapter rejects unapproved tools, missing reads, failed output and exhausted quota", async (t) => {
  const valid = `await import(${JSON.stringify(path.resolve("scripts/bench/synthetic-evidence-codex.mjs"))});`;
  const bad = 'console.log(JSON.stringify({type:"item.completed",item:{type:"command_execution"}}));';
  for (const source of [valid + bad,
    'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"No reads"}}));',
    valid + 'console.log(JSON.stringify({type:"turn.failed"}));']) {
    const result = await invoke(t, source);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
  }
  const exhausted = await invoke(t, 'console.log("MUST_NOT_START");', { exhausted: true });
  assert.equal(exhausted.code, 1);
  assert.match(exhausted.stderr, /invocation limit/u);
  assert.equal(exhausted.stdout, "");
  const wrongRole = await invoke(t, 'console.log("MUST_NOT_START");', { role: "owner" });
  assert.equal(wrongRole.code, 1);
  assert.deepEqual(await readdir(wrongRole.quota), []);
});
