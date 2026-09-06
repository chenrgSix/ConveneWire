import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { evidenceCodexConfig } from "./evidence-codex-config.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { hash } from "./evidence-access-reader.mjs";

export function runtimeConfig(treatment, bundlePath, controlPath, receiptDirectory, runId, grantDigest) {
  const common = evidenceCodexConfig("", "", "").filter(value => !value.startsWith("mcp_servers."));
  if (treatment === "A") return common;
  return [...common, `mcp_servers.evidence.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.evidence.args=${JSON.stringify([path.resolve("scripts/bench/evidence-access-reader.mjs"), bundlePath,
      controlPath, receiptDirectory, runId, grantDigest])}`,
    'mcp_servers.evidence.enabled_tools=["read_evidence"]', 'mcp_servers.evidence.required=true'];
}

export function makeAccess(replay, scheduled, observedAt) {
  const { fixture, documents } = replay;
  const scope = { experimentId: fixture.identity, authorityId: "authority_qa072_owner_excerpts_v1",
    taskId: fixture.task.taskId, roomId: fixture.task.roomId, runId: scheduled.runId };
  const grant = scheduled.treatment === "A" ? null : { ...scope,
    expiresAt: new Date(Date.parse(observedAt) + fixture.runtime.timeoutMilliseconds).toISOString(),
    sources: fixture.sources.map(({ evidenceRef, revision, contentSha256, allowedRange }) => ({ evidenceRef, revision, contentSha256, allowedRange })) };
  return {
    bundle: { ...scope, maximumReadCalls: fixture.runtime.maximumReadCalls,
      maximumReturnBytes: fixture.runtime.maximumReturnBytes, documents: structuredClone(documents) },
    control: { run: { ...scope, state: "active", grantSha256: hash(JSON.stringify(grant)) }, grant }
  };
}

export async function invokeFinalizer({ resources, replay, scheduled, executable, instruction, directory, env = process.env,
  configOverrides = [], onProgress = () => {}, onOfflineDiagnostic = () => {} }) {
  const observedAt = new Date().toISOString();
  const { bundle, control } = makeAccess(replay, scheduled, observedAt);
  const receiptDirectory = path.join(directory, "receipts"), workspace = path.join(directory, "workspace");
  mkdirSync(receiptDirectory); mkdirSync(workspace);
  const bundlePath = path.join(directory, "bundle.json"), controlPath = path.join(directory, "control.json");
  // Provider cwd is empty. Only the dedicated MCP process receives source bytes; no rubric/answers are materialized.
  if (scheduled.treatment !== "A") writeFileSync(bundlePath, JSON.stringify(bundle), { mode: 0o600 });
  writeFileSync(controlPath, JSON.stringify(control), { mode: 0o600 });
  const config = runtimeConfig(scheduled.treatment, bundlePath, controlPath, receiptDirectory,
    scheduled.runId, hash(JSON.stringify(control.grant)));
  const child = spawnTestProcess(resources, executable, ["exec", "--json", "--sandbox", "read-only", "--ephemeral",
    "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--model", replay.fixture.runtime.model,
    ...[...config, ...configOverrides].flatMap(value => ["-c", value]), "-"],
  { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.process.once("close", resolve));
  const failures = [], itemKinds = [], toolCalls = [];
  let finalAnswer = "", finalAnswerAt = null, timedOut = false;
  const fail = reason => { if (!failures.includes(reason)) failures.push(reason); };
  const timer = setTimeout(() => { timedOut = true; fail("timeout"); void child.stop(); }, replay.fixture.runtime.timeoutMilliseconds);
  child.process.stdin.on("error", () => {});
  child.process.stdin.end(instruction);
  if (configOverrides.includes('model_providers.fixture.requires_openai_auth=false')) {
    child.process.stderr.on("data", chunk => onOfflineDiagnostic(chunk.toString()));
  } else child.process.stderr.resume(); // Never retain real provider diagnostics, credentials or usage counters.
  try {
    for await (const line of createInterface({ input: child.process.stdout })) {
      let event;
      try { event = JSON.parse(line); } catch { fail("invalid_cli_event"); continue; }
      if (["turn.failed", "error"].includes(event.type)) fail(event.type);
      if (!event.type?.startsWith("item.") || !event.item?.type) continue;
      const item = event.item;
      const kind = ["agent_message", "reasoning", "mcp_tool_call", "tool_search", "error"].includes(item.type) ? item.type : "other";
      if (!itemKinds.includes(kind)) itemKinds.push(kind);
      if (kind === "agent_message" && event.type === "item.completed") {
        if (typeof item.text !== "string") { fail("invalid_answer"); continue; }
        if (Buffer.byteLength(item.text) > replay.fixture.runtime.maximumAnswerBytes) fail("answer_byte_limit");
        finalAnswer = Buffer.from(item.text).subarray(0, replay.fixture.runtime.maximumAnswerBytes).toString("utf8");
        finalAnswerAt = new Date().toISOString();
      } else if (kind === "mcp_tool_call") {
        const allowed = scheduled.treatment !== "A" && item.server === "evidence" && item.tool === "read_evidence";
        if (event.type === "item.completed") toolCalls.push({ allowed, status: item.status === "completed" ? "completed" : "failed" });
        if (!allowed) { fail("unapproved_tool"); void child.stop(); }
        else if (item.status === "failed" || item.error) fail("tool_return_failed");
        if (toolCalls.length > replay.fixture.runtime.maximumReadCalls) { fail("tool_call_limit"); void child.stop(); }
      } else if (kind === "other") { fail("unapproved_tool"); void child.stop(); }
      else if (kind === "error") fail("item_error");
      onProgress({ finalAnswer, finalAnswerAt, failures, itemKinds, toolCalls });
    }
  } finally { clearTimeout(timer); }
  const terminal = await child.terminal;
  await closed;
  if (terminal.code !== 0 || terminal.error) fail("process_failed");
  if (!finalAnswer.trim()) fail("no_final_answer");
  const reads = readdirSync(receiptDirectory).sort().map(name => JSON.parse(readFileSync(path.join(receiptDirectory, name), "utf8")));
  control.run.state = "terminal";
  writeFileSync(controlPath, JSON.stringify(control), { mode: 0o600 });
  const endedAt = new Date().toISOString();
  const answerBody = finalAnswer.replace(/<agentroom-assessment>[\s\S]*?<\/agentroom-assessment>/gu, "").trim();
  return { ...scheduled, observedAt, endedAt, finalAnswerAt,
    instructionSha256: hash(instruction), requestedModel: replay.fixture.runtime.model,
    observedProviderModel: null, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    outcome: timedOut ? "timed_out" : failures.length ? "failed" : "completed",
    exitCode: terminal.code, elapsedMilliseconds: Date.parse(endedAt) - Date.parse(observedAt),
    finalAnswer, answerSha256: hash(finalAnswer),
    outputWordCount: answerBody ? answerBody.split(/\s+/u).length : 0,
    outputWordInstructionMet: !answerBody || answerBody.split(/\s+/u).length < replay.fixture.runtime.answerWordInstruction,
    failures, itemKinds, toolCalls, grant: control.grant, reads };
}
