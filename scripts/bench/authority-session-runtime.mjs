import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { spawnTestProcess } from "../test/child-process.mjs";
import { evidenceToolDefinition, hash } from "./evidence-access-reader.mjs";
import { boundedUtf8, createAuthorityObserver } from "./authority-session-observer.mjs";

// Shared read grants/configuration are unchanged; consumed experiments keep their frozen executor.
import { runtimeConfig, makeAccess } from "./evidence-access-runtime.mjs";
import assert from "node:assert/strict";
export async function invokeAuthoritySession({ resources, replay, scheduled, executable, instruction, directory, env = process.env,
  configOverrides = [], signal, onProgress = () => {}, onOfflineDiagnostic = () => {} }) {
  assert.ok(configOverrides.every(value => /^(model_provider|model_providers\.fixture\.[a-z_]+)=/.test(value)), "Only fixture provider overrides are permitted");
  assert.equal(scheduled.treatment, "B", "Authority profile requires a scoped reader");
  if (signal?.aborted) throw new Error("AUTHORITY_SESSION_CANCELED");
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
  const observer = createAuthorityObserver({ treatment: scheduled.treatment, ...replay.fixture.runtime });
  const { state, fail } = observer;
  const { failures, itemKinds, toolEvents, messages } = state;
  let timedOut = false;
  const cancel = () => { fail("canceled"); void child.stop(); };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
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
  } catch { fail("stream_failed"); await child.stop(); }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
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
    protocolProfile: "authority-session-v1", instructionSha256: hash(instruction), requestedModel: replay.fixture.runtime.model,
    observedProviderModel: null, reasoningEffort: replay.fixture.runtime.reasoningEffort,
    outcome: failures.includes("canceled") ? "canceled" : timedOut ? "timed_out" : failures.length ? "failed" : "completed",
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
