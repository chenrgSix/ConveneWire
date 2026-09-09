// Deterministic Codex protocol fixture. No model/provider requests.
import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
import path from "node:path";
if (process.argv.includes("--version")) { console.log("codex-cli 0.153.4"); process.exit(0); }
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let cwd, thread, target;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === 1) send({ id: 1, result: { userAgent: "ConveneWire approval fixture" } });
  if (message.id === 2) {
    if (message.params.sandbox !== "workspace-write" || message.params.approvalPolicy !== "on-request" || message.params.approvalsReviewer !== "user") process.exit(31);
    cwd = message.params.cwd;
    thread = message.params.threadId ?? `thread-${process.pid}`;
    send({ id: 2, result: { thread: { id: thread }, approvalPolicy:"on-request", approvalsReviewer:"user" } });
  }
  if (message.id === 3) {
    const instruction = message.params.input[0].text.split("Current request:\n").at(-1);
    const files = instruction.startsWith("FILE_APPROVAL_TEST");
    target = path.join(cwd, `permission-${process.pid}.txt`);
    await writeFile(path.join(cwd, `request-${process.pid}.json`), JSON.stringify({ pid: process.pid, target, files }));
    send({ id: 3, result: { turn: { id: "turn-approval" } } });
    if (files) send({ method: "item/started", params: { threadId: thread, turnId: "turn-approval",
      item: { id: "operation-1", type: "fileChange", status: "inProgress", changes: [{ path: target, kind: { type: "add" }, diff: "+approved\n" }] } } });
    send({ id: 8, method: files ? "item/fileChange/requestApproval" : "item/commandExecution/requestApproval",
      params: { threadId: thread, turnId: "turn-approval", itemId: "operation-1", startedAtMs: Date.now(),
        ...(files ? {} : { command: `printf approved > permission-${process.pid}.txt`, cwd }), reason: "验证在中心审批后继续当前任务" } });
  }
  if (message.id === 8) {
    if (message.result.decision === "accept") await writeFile(target, "approved\n");
    else if (message.result.decision !== "decline") process.exit(32);
    send({ method: "item/completed", params: { threadId: thread, turnId: "turn-approval",
      item: { id: "reply-1", type: "agentMessage", text: message.result.decision === "accept" ? "中心已允许，本次测试文件已写入。" : "中心已拒绝，本次操作未执行。" } } });
    send({ method: "turn/completed", params: { threadId: thread, turn: { id: "turn-approval", status: "completed" } } });
  }
}
