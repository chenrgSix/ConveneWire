import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTestResources } from "../test/resources.mjs";
import { loadReplay, renderReplay, sha256, treatmentInstruction } from "./evidence-access-replay.js";
import { hash, readEvidence } from "./evidence-access-reader.mjs";
import { makeAccess, runtimeConfig, invokeFinalizer } from "./evidence-access-runtime.mjs";
import { assertPlanUnconsumed, claimPlan, verifyFreeze, reserveNext } from "./evidence-access-execute.js";

const replay = loadReplay();
const now = "2026-09-06T02:00:00.000Z";
const access = () => makeAccess(replay, replay.fixture.order[1], now);
const selector = () => ({ name: "read_evidence", arguments: { evidenceRef: replay.documents[0]!.evidenceRef,
  revision: replay.documents[0]!.revision } });
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const receiptValid = ajv.compile(JSON.parse(readFileSync("docs/acceptance/fixtures/qa-072-read-receipt.schema.json", "utf8")));
function checked(input: ReturnType<typeof access>, call = selector(), attempt = 0) {
  const result = readEvidence({ bundle: input.bundle, grant: input.control.grant, currentRun: input.control.run, call, attempt, now });
  assert.ok(receiptValid(result.receipt), JSON.stringify(receiptValid.errors));
  return result;
}

test("all original sources and verbatim contributions are pinned; no later repair or rubric enters model input", () => {
  assert.equal(replay.documents.length, 4);
  for (const doc of replay.documents) {
    const original = execFileSync("git", ["show", `${doc.revision}:${doc.source.path}`], { encoding: "utf8" });
    assert.equal(sha256(original), doc.source.sha256);
    assert.equal(doc.content, original.split(/(?<=\n)/u).slice(doc.source.startLine - 1, doc.source.endLine).join(""));
  }
  assert.equal(replay.contributions.length, 2);
  const instruction = renderReplay(replay);
  for (const contribution of replay.contributions) assert.ok(instruction.includes(contribution.content));
  for (const criterion of replay.fixture.task.criteria) assert.ok(instruction.includes(criterion.description));
  assert.ok(instruction.includes("accepted Runs without offered current Results: 2"));
  assert.ok(instruction.includes("Verified evidence references: None"));
  assert.ok(!instruction.includes("Material correction to the participant claims:")); // historical final excluded
  const rubric = JSON.parse(readFileSync(replay.fixture.provenance[0]!.path, "utf8")).cases[2].rubric;
  for (const item of rubric) assert.ok(!instruction.includes(item.text));
  assert.deepEqual(treatmentInstruction("A"), treatmentInstruction("B"));
  assert.equal(treatmentInstruction("C"), `${instruction}\n\n## Evidence-use requirement\n${replay.fixture.useInstruction}`);
  const common = runtimeConfig("A", "b", "c", "d", "run", "digest");
  const b = runtimeConfig("B", "b", "c", "d", "run", "digest");
  assert.deepEqual(b, runtimeConfig("C", "b", "c", "d", "run", "digest"));
  assert.deepEqual(b.filter((v: string) => !v.startsWith("mcp_servers.")), common);
});

test("receipt records exact full and partial bytes, truncation and UTF-8 boundaries", () => {
  const input = access();
  const full = checked(input);
  assert.equal(full.content, replay.documents[0]!.content);
  assert.equal(full.receipt.contentSha256, hash(full.content));
  assert.equal(full.receipt.returnedBytes, Buffer.byteLength(full.content));
  assert.deepEqual(full.receipt.returnedRange, replay.documents[0]!.allowedRange);
  assert.equal(full.receipt.truncated, false);
  const call: any = selector(); call.arguments.range = { start: 10, end: 30 };
  const partial = checked(input, call);
  assert.equal(partial.content, Buffer.from(full.content).subarray(10, 30).toString());
  input.bundle.maximumReturnBytes = 20;
  const truncated = checked(input);
  assert.equal(truncated.receipt.truncated, true);
  assert.deepEqual(truncated.receipt.returnedRange, { start: 0, end: 20 });
  assert.equal(truncated.receipt.contentSha256, hash(truncated.content));
  const unicode = access();
  const doc = unicode.bundle.documents[0];
  doc.content = "A中B"; doc.contentSha256 = hash(doc.content); doc.allowedRange = { start: 0, end: 5 };
  Object.assign(unicode.control.grant.sources[0], { contentSha256: doc.contentSha256, allowedRange: doc.allowedRange });
  unicode.control.run.grantSha256 = hash(JSON.stringify(unicode.control.grant));
  unicode.bundle.maximumReturnBytes = 3;
  assert.equal(checked(unicode).content, "A");
  call.arguments.range = { start: 2, end: 4 };
  assert.equal(checked(unicode, call).receipt.failureReason, "invalid_utf8_boundary");
});

test("authority joins reject cross-Run/Task/Room/owner, terminal, expiry and grant substitution", () => {
  for (const key of ["runId", "taskId", "roomId", "authorityId", "experimentId"]) {
    const input = access(); input.control.run[key] = "wrong";
    assert.equal(checked(input).receipt.failureReason, "authorization_mismatch", key);
  }
  for (const state of ["terminal", "reserved"]) {
    const input = access(); input.control.run.state = state;
    assert.equal(checked(input).receipt.failureReason, "authorization_mismatch");
  }
  const expired = access(); expired.control.grant.expiresAt = now;
  expired.control.run.grantSha256 = hash(JSON.stringify(expired.control.grant));
  assert.equal(checked(expired).receipt.failureReason, "authorization_mismatch");
  const substituted = access(); substituted.control.grant.sources = [];
  assert.equal(checked(substituted).receipt.failureReason, "authorization_mismatch");
  const baseline = makeAccess(replay, replay.fixture.order[0], now);
  assert.equal(checked(baseline).receipt.failureReason, "authorization_mismatch");
});

test("reader rejects stale revisions, corrupt bytes, missing scopes, invalid ranges and arbitrary selectors", () => {
  const call: any = selector(); call.arguments.revision = "a".repeat(40);
  assert.equal(checked(access(), call).receipt.failureReason, "source_pin_mismatch");
  for (const args of [{ ...selector().arguments, runId: "foreign" }, { evidenceRef: "../../auth.json", revision: "a".repeat(40) },
    { ...selector().arguments, range: { start: -1, end: 10 } }, { ...selector().arguments, range: { start: 0, end: 99999 } }]) {
    assert.notEqual(checked(access(), { name: "read_evidence", arguments: args } as any).receipt.status, "returned");
  }
  const corrupt = access(); corrupt.bundle.documents[0].content += "different";
  assert.equal(checked(corrupt).receipt.failureReason, "source_digest_mismatch");
  const missing = access(); missing.control.grant.sources = [];
  missing.control.run.grantSha256 = hash(JSON.stringify(missing.control.grant));
  assert.equal(checked(missing).receipt.failureReason, "source_pin_mismatch");
  assert.equal(checked(access(), selector(), 8).receipt.failureReason, "read_limit");
});

test("durable invocation reservation cannot retry, reorder or exceed nine", () => {
  const report = { attempts: [] as Array<{ slot: number; state: string }> };
  assert.throws(() => reserveNext(report, 1));
  for (let slot = 0; slot < 9; slot++) reserveNext(report, slot);
  assert.throws(() => reserveNext(report, 8));
  assert.throws(() => reserveNext(report, 9));
});

test("real MCP transport emits receipt/content pairs and retains read count across restarts", async t => {
  const resources = await createTestResources(t, "convenewire-qa072-reader-");
  const input = makeAccess(replay, replay.fixture.order[1], new Date().toISOString());
  const bundle = path.join(resources.directory, "bundle.json"), control = path.join(resources.directory, "control.json");
  const receipts = path.join(resources.directory, "receipts"); mkdirSync(receipts);
  writeFileSync(bundle, JSON.stringify(input.bundle)); writeFileSync(control, JSON.stringify(input.control));
  for (let phase = 0; phase < 2; phase++) {
    const client = new Client({ name: "qa072-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [path.resolve("scripts/bench/evidence-access-reader.mjs"), bundle, control, receipts,
        input.control.run.runId, hash(JSON.stringify(input.control.grant))], env: { PATH: process.env.PATH! }, stderr: "pipe" });
    await client.connect(transport);
    try {
      const tools = await client.listTools(); assert.equal(tools.tools.length, 1);
      for (let n = 0; n < (phase ? 5 : 4); n++) {
        const response: any = await client.callTool(selector());
        const returned = JSON.parse(response.content[0].text);
        assert.ok(receiptValid(returned.receipt));
        assert.equal(returned.receipt.status, phase === 1 && n === 4 ? "denied" : "returned");
      }
    } finally { await client.close(); }
  }
  assert.equal(readdirSync(receipts).length, 9);
});

// Exercises the exact installed CLI -> discovery -> new reader -> answer path with no account/provider.
test("installed CLI A/B/C bootstrap has only the intended tool delta and exact receipt returns", { timeout: 120_000 }, async t => {
  const resources = await createTestResources(t, "convenewire-qa072-cli-");
  const codexHome = path.join(resources.directory, "codex-home"); mkdirSync(codexHome);
  const executable = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
  for (const treatment of ["A", "B", "C"] as const) {
    let calls = 0, serverError: unknown, offlineDiagnostics = "";
    const server = http.createServer(async (request, response) => {
      try {
        assert.equal(request.url, "/v1/responses"); assert.equal(request.headers.authorization, undefined);
        let body = ""; for await (const chunk of request) body += chunk;
        const input = JSON.parse(body); calls++;
        assert.ok(calls <= 3);
        assert.ok(!input.tools.some((tool: any) => ["shell", "exec_command", "web_search", "spawn_agent"].includes(tool.name ?? tool.type)));
        let item;
        if (treatment !== "A" && calls === 1) {
          item = { id: "ts_fixture", type: "tool_search_call", execution: "client", call_id: "call_search", status: "completed",
            arguments: { query: "evidence read_evidence", limit: 1 } };
        } else if (treatment !== "A" && calls === 2) {
          const discovered = input.input.find((entry: any) => entry.type === "tool_search_output");
          assert.deepEqual(discovered.tools.map((tool: any) => tool.name), ["mcp__evidence"]);
          item = { id: "fc_fixture", type: "function_call", call_id: "call_read", status: "completed",
            namespace: "mcp__evidence", name: "read_evidence", arguments: JSON.stringify(selector().arguments) };
        } else {
          if (treatment !== "A") {
            const output = input.input.find((entry: any) => entry.type === "function_call_output" && entry.call_id === "call_read");
            assert.ok(JSON.stringify(output).includes("package console"));
            assert.ok(JSON.stringify(output).includes(replay.documents[0]!.contentSha256));
          } else assert.ok(!JSON.stringify(input.tools).includes("mcp__evidence"));
          item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed",
            content: [{ type: "output_text", text: "Offline bootstrap only.", annotations: [] }] };
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [{ type: "response.created", response: { id: `resp_${calls}`, status: "in_progress" } },
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id: `resp_${calls}`, status: "completed", output: [item] } }]) response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      } catch (error) { serverError = error; response.writeHead(400); response.end('{"error":{"message":"OFFLINE_FAILED"}}'); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const directory = path.join(resources.directory, treatment); mkdirSync(directory);
    try {
      const result = await invokeFinalizer({ resources, replay, scheduled: replay.fixture.order.find(row => row.treatment === treatment),
        executable, directory, instruction: treatmentInstruction(treatment), onOfflineDiagnostic: (text: string) => { offlineDiagnostics += text; }, env: { PATH: process.env.PATH, CODEX_HOME: codexHome },
        configOverrides: ['model_provider="fixture"', 'model_providers.fixture.name="Offline fixture"',
          `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,
          'model_providers.fixture.wire_api="responses"', 'model_providers.fixture.requires_openai_auth=false',
          'model_providers.fixture.request_max_retries=0', 'model_providers.fixture.stream_max_retries=0'] });
      if (serverError) throw serverError;
      assert.equal(result.outcome, "completed", JSON.stringify(result.failures) + offlineDiagnostics);
      assert.equal(calls, treatment === "A" ? 1 : 3);
      assert.equal(result.reads.length, treatment === "A" ? 0 : 1);
      for (const read of result.reads) assert.ok(receiptValid(read.receipt));
      // C's incomplete evidence use is a content/compliance outcome, never a new completion policy.
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});

test("runtime retains failed progress without reporting a delivered answer or substituting a retry", async t => {
  const resources = await createTestResources(t, "convenewire-qa072-failure-");
  const fake = path.join(resources.directory, "fake.mjs");
  writeFileSync(fake, `#!${process.execPath}\nfor await(const x of process.stdin){}; console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Retain this failed answer."}})); console.log(JSON.stringify({type:"turn.failed"}));\n`);
  chmodSync(fake, 0o700);
  const directory = path.join(resources.directory, "failed"); mkdirSync(directory);
  const result = await invokeFinalizer({ resources, replay, scheduled: replay.fixture.order[0], executable: fake,
    directory, instruction: treatmentInstruction("A") });
  assert.equal(result.outcome, "failed"); assert.equal(result.finalAnswer, "");
  assert.equal(result.finalAnswerAt, null);
  assert.deepEqual(result.progressMessages.map((message: any) => message.text), ["Retain this failed answer."]);
  assert.deepEqual(result.failures, ["turn.failed", "terminal_turn_incomplete", "no_final_answer"]);
});


test("an already claimed phase cannot restart and changed pins reject admission", async t => {
  const resources = await createTestResources(t, "convenewire-qa072-admission-");
  const report = path.join(resources.directory, "report.json");
  claimPlan({ state: "executing", attempts: [{ slot: 0, state: "reserved" }] }, report);
  assert.throws(() => claimPlan({ state: "executing", attempts: [] }, report), /EEXIST/u);
  assert.throws(() => verifyFreeze({ files: [{ path: "scripts/bench/evidence-access-reader.mjs", sha256: "wrong" }] }), /Changed frozen file/u);
  assert.throws(() => assertPlanUnconsumed(), /QA-072 is consumed/u);
  const closed = spawnSync(process.execPath, ["--import", "tsx", "scripts/bench/evidence-access-execute.ts", "--execute-qa072-frozen-nine"],
    { encoding: "utf8", timeout: 10_000, env: { PATH: resources.directory } });
  assert.equal(closed.status, 1);
  assert.match(closed.stdout, /QA-072 is consumed/u);
  assert.doesNotMatch(closed.stdout + closed.stderr, /ENOENT|Changed frozen file/u);
});

for (const mode of ["success", "missing_turn", "commentary", "failed_candidate", "byte_limit", "missing_catalog", "wrong_catalog"] as const) {
  test(`terminal answer handling: ${mode}`, async t => {
    const resources = await createTestResources(t, "convenewire-qa073-terminal-");
    const fake = path.join(resources.directory, "fake.mjs");
    const directory = path.join(resources.directory, "invocation"); mkdirSync(directory);
    const text = mode === "byte_limit" ? "中".repeat(100) : "Retained text.";
    const catalogMode = mode.endsWith("catalog");
    writeFileSync(fake, `#!${process.execPath}
import { writeFileSync } from "node:fs";
for await (const input of process.stdin) {}
writeFileSync(process.argv[process.argv.indexOf("--output-last-message") + 1], ${JSON.stringify(text)});
console.log(JSON.stringify({ type: "item.completed", item: { id: "msg_1", type: "agent_message", phase: ${JSON.stringify(mode === "commentary" ? "commentary" : "final_answer")}, text: ${JSON.stringify(text)} } }));
${mode === "missing_turn" ? "" : `console.log(JSON.stringify({ type: ${JSON.stringify(mode === "failed_candidate" ? "turn.failed" : "turn.completed")} }));`}
`);
    chmodSync(fake, 0o700);
    if (mode === "wrong_catalog") writeFileSync(path.join(directory, "reader-lifecycle.jsonl"), JSON.stringify({ stage: "tools_listed", definitionSha256: "wrong" }) + "\n");
    const bounded = structuredClone(replay); bounded.fixture.runtime.maximumAnswerBytes = 128;
    const result = await invokeFinalizer({ resources, replay: bounded, scheduled: replay.fixture.order[catalogMode ? 1 : 0], executable: fake,
      directory, instruction: treatmentInstruction(catalogMode ? "B" : "A") });
    assert.equal(result.outcome, mode === "success" ? "completed" : "failed");
    assert.equal(result.finalAnswer, mode === "success" ? text : "");
    assert.ok(Buffer.byteLength(result.candidateAnswer) <= 128);
    assert.ok(!result.candidateAnswer.includes("�"));
    assert.equal(result.progressMessages.length, mode === "success" ? 0 : 1);
    if (mode !== "success") assert.equal(result.finalAnswerAt, null);
    const reason = { missing_turn: "terminal_turn_incomplete", commentary: "no_final_answer", failed_candidate: "turn.failed",
      byte_limit: "answer_byte_limit", missing_catalog: "reader_catalog_unobserved", wrong_catalog: "reader_catalog_mismatch" };
    if (mode !== "success") assert.ok(result.failures.includes(reason[mode]));
  });
}

test("runtime publishes rejected started tool identity before stopping the process", async t => {
  const resources = await createTestResources(t, "convenewire-qa073-started-");
  const fake = path.join(resources.directory, "fake.mjs"), directory = path.join(resources.directory, "invocation");
  mkdirSync(directory);
  writeFileSync(fake, `#!${process.execPath}
for await (const input of process.stdin) {}
console.log(JSON.stringify({ type: "item.started", item: { id: "call_1", type: "mcp_tool_call", server: "foreign", tool: "list_resources", arguments: { secret: "NEVER_RETAIN" } } }));
setInterval(() => {}, 1000);
`);
  chmodSync(fake, 0o700);
  const snapshots: any[] = [];
  const result = await invokeFinalizer({ resources, replay, scheduled: replay.fixture.order[0], executable: fake,
    directory, instruction: treatmentInstruction("A"), onProgress: (partial: unknown) => snapshots.push(partial) });
  assert.equal(result.outcome, "failed");
  assert.equal(snapshots[0].toolEvents[0].tool, "list_resources");
  assert.equal(snapshots[0].toolEvents[0].decision, "rejected");
  assert.deepEqual(result.toolEvents, snapshots[0].toolEvents);
  assert.ok(!JSON.stringify(result).includes("NEVER_RETAIN"));
});

for (const mode of ["unapproved", "timeout"] as const) test(`runtime ${mode} remains a distinct consumed failure`, async t => {
  const resources = await createTestResources(t, "convenewire-qa072-terminal-");
  const fake = path.join(resources.directory, "fake.mjs");
  writeFileSync(fake, `#!${process.execPath}\nfor await(const x of process.stdin){}; ${mode === "unapproved" ? 'console.log(JSON.stringify({type:"item.completed",item:{type:"command_execution"}}));' : ''} setInterval(()=>{},1000);\n`);
  chmodSync(fake, 0o700);
  const directory = path.join(resources.directory, "invocation"); mkdirSync(directory);
  const bounded = structuredClone(replay); bounded.fixture.runtime.timeoutMilliseconds = 500;
  const result = await invokeFinalizer({ resources, replay: bounded, scheduled: replay.fixture.order[0], executable: fake,
    directory, instruction: treatmentInstruction("A") });
  assert.equal(result.outcome, mode === "timeout" ? "timed_out" : "failed");
  assert.ok(result.failures.includes(mode === "timeout" ? "timeout" : "unapproved_tool"));
  assert.equal(result.finalAnswer, "");
});
