import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { workspacePacket, documentsFor, prepareWorkspaces, sha256, workspaceTaskInput, loadWorkspaceRemaining, loadWorkspaceDelivery } from "./workspace-evidence.mjs";
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

async function invoke(t, fakeSource, { exhausted = false, role = "Baseline", maximum = 12 } = {}) {
  const resources = await createTestResources(t, "convenewire-evidence-adapter-");
  const workspaces = prepareWorkspaces(resources.directory);
  const quota = path.join(resources.directory, "quota");
  await mkdir(quota);
  if (exhausted) for (let i = 0; i < maximum; i += 1) await writeFile(path.join(quota, `invocation-${i}`), "");
  const fake = path.join(resources.directory, "fake-codex.mjs");
  await writeFile(fake, `#!${process.execPath}\n${fakeSource}\n`);
  await chmod(fake, 0o700);
  const child = spawnTestProcess(resources, process.execPath,
    [path.resolve("scripts/bench/codex-evidence-answer.mjs"), fake, "gpt-5.4-mini", quota, String(maximum), role],
    { cwd: workspaces[role] ?? workspaces.Baseline, env: { PATH: process.env.PATH }, stdio: ["pipe", "pipe", "pipe"] });
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
  assert.deepEqual(metadata.diagnostics.deniedTools, []);
  assert.equal((await readdir(path.join(result.quota, "receipt-0"))).length, 6);
});

test("denied-tool receipts retain bounded identity without arguments or provider text", async (t) => {
  const source = `
    const items = [
      {type:"mcp_tool_call",server:"another_server",tool:"read_evidence"},
      {type:"mcp_tool_call",server:"evidence",tool:"another_tool"},
      {type:"mcp_tool_call",server:"/private/UNSAFE_NAME",tool:"UNSAFE_NAME\\n"},
      {type:"mcp_tool_call",server:"a".repeat(81),tool:{secret:"UNSAFE_NAME"}},
      ...Array.from({length:12}, (_, i) => ({type:"mcp_tool_call",server:"evidence",tool:"denied_"+i}))
    ];
    for (const item of items) for (const type of ["item.started", "item.completed"]) {
      console.log(JSON.stringify({type,item:{...item,arguments:{credential:"PRIVATE_ARGUMENT"},command:"PRIVATE_COMMAND",result:"PRIVATE_OUTPUT",error:"PRIVATE_ERROR"}}));
    }
    console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Must not be delivered"}}));
  `;
  const result = await invoke(t, source);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  const text = await readFile(path.join(result.quota, "receipt-0/invocation.json"), "utf8");
  const metadata = JSON.parse(text);
  assert.deepEqual(metadata.diagnostics.failureReasons, ["unapproved_tool"]);
  const denied = metadata.diagnostics.deniedTools;
  assert.equal(denied.length, 8);
  assert.deepEqual(denied.slice(0, 3), [
    {kind:"mcp_tool_call",server:"another_server",tool:"read_evidence"},
    {kind:"mcp_tool_call",server:"evidence",tool:"another_tool"},
    {kind:"mcp_tool_call",server:null,tool:null}
  ]);
  assert.ok(denied.every((entry) => Object.keys(entry).join(",") === "kind,server,tool"));
  assert.doesNotMatch(text, /UNSAFE_NAME|PRIVATE_|Must not be delivered|\/private\//u);
});

test("adapter retains a transcript-only Finalizer answer and reports missing evidence separately", async (t) => {
  const result = await invoke(t, 'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Transcript-only final answer"}}));',
    { role: "Reviewer", maximum: 8 });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "Transcript-only final answer\n");
  const metadata = JSON.parse(await readFile(path.join(result.quota, "receipt-0/invocation.json"), "utf8"));
  assert.equal(metadata.runtimeSucceeded, true);
  assert.deepEqual(metadata.diagnostics.failureReasons, []);
  assert.deepEqual(metadata.evidenceCoverage, { status: "not_read", availableDocuments: 3, readDocuments: 0,
    missingDocumentIds: ["delivery-schema", "delivery-type", "delivery-enum"] });
});

test("adapter rejects unapproved tools, absent answers, failed output and all quota sizes", async (t) => {
  const valid = `await import(${JSON.stringify(path.resolve("scripts/bench/synthetic-evidence-codex.mjs"))});`;
  const bad = 'console.log(JSON.stringify({type:"item.completed",item:{type:"command_execution"}}));';
  for (const source of [valid + bad,
    'console.log(JSON.stringify({type:"turn.completed"}));',
    valid + 'console.log(JSON.stringify({type:"turn.failed"}));']) {
    const result = await invoke(t, source);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
  }
  for (const maximum of [3, 8, 12]) {
    const exhausted = await invoke(t, 'console.log("MUST_NOT_START");', { exhausted: true, maximum });
    assert.equal(exhausted.code, 1);
    assert.match(exhausted.stderr, /invocation limit/u);
    assert.equal(exhausted.stdout, "");
    assert.equal((await readdir(exhausted.quota)).length, maximum);
  }
  const wrongRole = await invoke(t, 'console.log("MUST_NOT_START");', { role: "owner" });
  assert.equal(wrongRole.code, 1);
  assert.deepEqual(await readdir(wrongRole.quota), []);
});

test("delivery-only proposal pins the completed baseline and exactly three new calls", () => {
  const { manifest, samples } = loadWorkspaceDelivery();
  assert.deepEqual(samples.map((sample) => sample.id), ["delivery"]);
  assert.equal(manifest.priorInvocations, 15);
  assert.equal(manifest.maximumPhaseInvocations, 18);
  for (const change of [
    (copy) => { copy.priorReports[2].sha256 = "0".repeat(64); },
    (copy) => { copy.priorReports.pop(); },
    (copy) => { copy.priorReports[3] = copy.priorReports[0]; },
    (copy) => { copy.priorReports[3].sha256 = "0".repeat(64); },
    (copy) => { copy.baseline.resultIndex = 1; },
    (copy) => { copy.arms.push("single_agent"); },
    (copy) => { copy.maximumNewInvocations = 4; },
    (copy) => { copy.maximumPhaseInvocations = 17; }
  ]) {
    const copy = structuredClone(manifest);
    change(copy);
    assert.throws(() => loadWorkspaceDelivery(copy));
  }
});

test("pending delivery plan permits offline inspection but refuses real admission", () => {
  const { manifest } = loadWorkspaceDelivery();
  const pending = { ...manifest, authorization: "pending-owner-cap-increase" };
  assert.equal(loadWorkspaceDelivery(pending).manifest.maximumNewInvocations, 3);
  assert.throws(() => loadWorkspaceDelivery(pending, { requireApproval: true }), /explicit Owner approval/u);
  // This validates a receipt field, not actual human consent or permission to call a provider.
  const approvedFixture = { ...manifest, authorization: "owner-approved" };
  assert.equal(loadWorkspaceDelivery(approvedFixture, { requireApproval: true }).manifest.maximumPhaseInvocations, 18);
  assert.throws(() => loadWorkspaceDelivery({ ...approvedFixture, maximumPhaseInvocations: 19 }, { requireApproval: true }));
});

test("remaining manifest pins failed evidence and excludes every previously started case within 13 calls", () => {
  const { manifest, samples } = loadWorkspaceRemaining();
  assert.deepEqual(samples.map((sample) => sample.id), ["cancellation", "windows"]);
  for (const change of [
    (copy) => { copy.packetSha256 = "0".repeat(64); },
    (copy) => { copy.priorReports[1].sha256 = "0".repeat(64); },
    (copy) => { copy.caseIds.unshift("delivery"); },
    (copy) => { copy.maximumNewInvocations = 12; },
    (copy) => { copy.maximumPhaseInvocations = 17; }
  ]) {
    const copy = structuredClone(manifest);
    change(copy);
    assert.throws(() => loadWorkspaceRemaining(copy));
  }
});
