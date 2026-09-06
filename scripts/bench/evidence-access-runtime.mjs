import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { evidenceCodexConfig } from "./evidence-codex-config.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
import { evidenceToolDefinition, hash } from "./evidence-access-reader.mjs";
import { boundedUtf8, createInvocationObserver } from "./evidence-invocation-observer.mjs";

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
  const scope = { experimentId: fixture.identity, authorityId: fixture.authorityId ?? "authority_qa072_owner_excerpts_v1",
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
  const finalPath = path.join(directory, "terminal-answer.txt");
  const child = spawnTestProcess(resources, executable, ["exec", "--json", "--output-last-message", finalPath, "--sandbox", "read-only", "--ephemeral",
    "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--model", replay.fixture.runtime.model,
    ...[...config, ...configOverrides].flatMap(value => ["-c", value]), "-"],
  { cwd: workspace, env, stdio: ["pipe", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.process.once("close", resolve));
  const observer = createInvocationObserver({ treatment: scheduled.treatment, ...replay.fixture.runtime });
  const { state, fail } = observer;
  const { failures, itemKinds, toolEvents, messages } = state;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; fail("timeout"); void child.stop(); }, replay.fixture.runtime.timeoutMilliseconds);
  child.process.stdin.on("error", () => {});
  child.process.stdin.end(instruction);
  if (configOverrides.includes('model_providers.fixture.requires_openai_auth=false')) {
    child.process.stderr.on("data", chunk => onOfflineDiagnostic(chunk.toString()));
  } else child.process.stderr.resume(); // Never retain real provider diagnostics, credentials or usage counters.
  try {
    for await (const line of createInterface({ input: child.process.stdout })) {
      let event;
      try { event = JSON.parse(line); } catch { fail("invalid_cli_event"); void child.stop(); continue; }
      const stop = observer.observe(event);
      // Record identity before initiating shutdown, including item.started rejections.
      onProgress(structuredClone(state));
      if (stop) void child.stop();
    }
  } finally { clearTimeout(timer); }
  const terminal = await child.terminal;
  await closed;
  if (terminal.code !== 0 || terminal.error) fail("process_failed");
  if (!state.turnCompleted || state.turnFailed) fail("terminal_turn_incomplete");
  let candidateAnswer = "";
  if (existsSync(finalPath)) {
    const file = openSync(finalPath, "r");
    try {
      const bytes = Buffer.alloc(replay.fixture.runtime.maximumAnswerBytes + 1);
      const length = readSync(file, bytes, 0, bytes.length, 0);
      if (length > replay.fixture.runtime.maximumAnswerBytes) fail("answer_byte_limit");
      candidateAnswer = boundedUtf8(bytes.subarray(0, length), replay.fixture.runtime.maximumAnswerBytes).trim();
    } finally { closeSync(file); }
  }
  if (!candidateAnswer) fail("no_final_answer");
  const matched = messages.findLast(message => message.text.trim() === candidateAnswer);
  if (matched?.phase === "commentary") fail("no_final_answer");
  const lifecyclePath = path.join(directory, "reader-lifecycle.jsonl");
  const readerLifecycle = existsSync(lifecyclePath) ? readFileSync(lifecyclePath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const catalogs = readerLifecycle.filter(event => event.stage === "tools_listed");
  if (scheduled.treatment !== "A") {
    if (!catalogs.length) fail("reader_catalog_unobserved");
    if (catalogs.some(event => event.runId !== scheduled.runId || event.definitionSha256 !== hash(JSON.stringify(evidenceToolDefinition(bundle))))) {
      fail("reader_catalog_mismatch");
    }
  }
  const finalAnswer = failures.length === 0 ? candidateAnswer : "";
  const finalAnswerAt = finalAnswer ? matched?.observedAt ?? new Date().toISOString() : null;
  const progressMessages = messages.filter(message => !finalAnswer || message !== matched);
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
    candidateAnswer,
    progressMessages, failures, itemKinds, toolEvents, omittedToolEvents: state.omittedToolEvents,
    omittedMessages: state.omittedMessages, turnCompleted: state.turnCompleted, readerLifecycle,
    evidenceAccess: { configured: scheduled.treatment !== "A", catalogListed: readerLifecycle.some(event => event.stage === "tools_listed"),
      modelDiscovery: "not_observable_in_cli_json", sourceReturns: reads.filter(read => read.receipt.status === "returned").length },
    grant: control.grant, reads };
}
