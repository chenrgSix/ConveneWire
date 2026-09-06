// Separate from the closed-input adapter: only the fixed evidence MCP is allowed.
import { closeSync, openSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { evidenceCodexConfig } from "./evidence-codex-config.mjs";
const [executable, model, quotaDirectory, maximum, role] = process.argv.slice(2);
if (!executable || model !== "gpt-5.4-mini" || !["8", "12"].includes(maximum) || !["Baseline", "Solver", "Reviewer"].includes(role)) {
  throw new Error("Invalid fixed workspace benchmark configuration");
}
let instruction = "";
for await (const chunk of process.stdin) instruction += chunk;
const caseIds = [...new Set([...instruction.matchAll(/\[EVIDENCE_CASE=([a-z]+)\]/gu)].map((match) => match[1]))];
const bundlePath = path.join(process.cwd(), "evidence.json");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
if (caseIds.length !== 1 || !bundle.cases.some((sample) => sample.id === caseIds[0])) throw new Error("Missing unique case scope");
let reservedSlot;
for (let slot = 0; slot < Number(maximum); slot += 1) {
  try {
    closeSync(openSync(path.join(quotaDirectory, `invocation-${slot}`), "wx", 0o600));
    reservedSlot = slot;
    break;
  } catch (error) { if (error.code !== "EEXIST") throw error; }
}
if (reservedSlot === undefined) {
  process.stderr.write("Benchmark invocation limit reached; no provider process started.\n");
  process.exit(1);
}
const receiptDirectory = path.join(quotaDirectory, `receipt-${reservedSlot}`);
mkdirSync(receiptDirectory);
const metadata = { caseId: caseIds[0], role, instructionSha256: createHash("sha256").update(instruction).digest("hex"),
  runtimeSucceeded: false, failure: null,
  diagnostics: { exitCode: null, timedOut: false, itemKinds: [], failureReasons: [] } };
const persist = () => writeFileSync(path.join(receiptDirectory, "invocation.json"), JSON.stringify(metadata));
persist();
const config = evidenceCodexConfig(bundlePath, caseIds[0], receiptDirectory);
const child = spawn(executable, ["exec", "--json", "--sandbox", "read-only", "--ephemeral",
  "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--model", model,
  ...config.flatMap((value) => ["-c", value]), "-"], { stdio: ["pipe", "pipe", "pipe"] });
const terminal = new Promise((resolve) => {
  child.once("error", () => resolve(1));
  child.once("exit", (code) => resolve(code ?? 1));
});
let failed = false;
const fail = (reason) => {
  failed = true;
  if (!metadata.diagnostics.failureReasons.includes(reason)) metadata.diagnostics.failureReasons.push(reason);
};
const timer = setTimeout(() => {
  metadata.diagnostics.timedOut = true;
  fail("process_timeout");
  child.kill("SIGKILL");
}, 300_000);
child.stdin.on("error", () => {});
child.stdin.end(instruction);
child.stderr.resume(); // Never forward provider diagnostics, credentials or usage.
let answer = "";
for await (const line of createInterface({ input: child.stdout })) {
  try {
    const event = JSON.parse(line);
    if (event.type === "item.completed" && event.item?.type === "agent_message") answer = event.item.text;
    if (event.type === "turn.failed") fail("turn_failed");
    if (event.type === "error") fail("cli_error");
    if (event.type?.startsWith("item.") && event.item?.type) {
      const kind = ["agent_message", "reasoning", "mcp_tool_call", "error"].includes(event.item.type) ? event.item.type : "other";
      if (!metadata.diagnostics.itemKinds.includes(kind)) metadata.diagnostics.itemKinds.push(kind);
    }
    if (event.type?.startsWith("item.") && event.item?.type && !["agent_message", "reasoning"].includes(event.item.type)) {
      if (event.item.type === "error") fail("item_error");
      else if (event.item.type !== "mcp_tool_call" || event.item.server !== "evidence" || event.item.tool !== "read_evidence") fail("unapproved_tool");
      else if (event.item.status === "failed" || event.item.error) fail("reader_call_failed");
    }
    persist();
  } catch { fail("invalid_cli_event"); }
}
const result = await terminal;
clearTimeout(timer);
metadata.diagnostics.exitCode = result;
if (result !== 0) fail("nonzero_exit");
const reads = readdirSync(receiptDirectory).filter((name) => name.startsWith("read-"))
  .map((name) => JSON.parse(readFileSync(path.join(receiptDirectory, name), "utf8")));
const availableIds = bundle.cases.find((sample) => sample.id === caseIds[0]).documents.map((doc) => doc.id);
const readIds = new Set(reads.filter((read) => read.accepted).map((read) => read.id));
const missingDocumentIds = availableIds.filter((id) => !readIds.has(id));
metadata.evidenceCoverage = { status: readIds.size === 0 ? "not_read" : missingDocumentIds.length ? "partial" : "complete",
  availableDocuments: availableIds.length, readDocuments: readIds.size, missingDocumentIds };
if (reads.some((read) => !read.accepted)) fail("rejected_evidence_read");
if (!answer.trim()) fail("no_final_answer");
metadata.runtimeSucceeded = !failed;
metadata.failure = metadata.runtimeSucceeded ? null : "Runtime failed, used an unapproved tool or produced no final answer";
persist();
if (metadata.runtimeSucceeded) process.stdout.write(answer.trim() + "\n");
else { process.stderr.write("Evidence benchmark invocation failed; inspect sanitized receipts.\n"); process.exitCode = 1; }
