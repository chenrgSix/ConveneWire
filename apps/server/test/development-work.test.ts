import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { type TestContext } from "node:test";
import type { WorkAuthorization, WorkAuthorizationReceipt, WorkPolicyOffer, ExecutionGrantSummary } from "@convene-wire/contracts/execution-plan";
import { executionOperationDigest, workTaskGrantId } from "@convene-wire/contracts/execution-validation";
import { fixture } from "./helpers/execution-plan-fixture.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { AgentService } from "../src/registry/agent-service.js";

const start = "2026-09-08T00:00:00.000Z";
const fixtures = JSON.parse(await readFile(new URL("../../../packages/contracts/fixtures/work-policy-cases.json", import.meta.url), "utf8"));
const helloCapability = { version: 1, workspaceBoundary: "enforced", preventivePathEnforcement: false, operations: ["prepare", "capture", "verify", "integrate"] };
async function waitFor(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error("Timed out waiting for work negotiation");
}

async function setup(t: TestContext, scheduler = 0) {
  let current = start;
  const f = await fixture(t, () => current, { executionSchedulerSweepMilliseconds: scheduler });
  const core = new CoreRepository(f.database);
  const auth = new AuthService(f.database);
  const principal = auth.authenticateWebSession(f.authorization.slice(7), start);
  const device = new MemberDeviceService(core, auth).registerOwnDevice(principal, f.teamId, "Work policy device", start);
  const credential = auth.issueDeviceCredential(device.deviceId, start);
  const agent = new AgentService(core, auth).publishAgent(principal, { teamId: f.teamId, deviceId: device.deviceId,
    name: "Developer", role: "Development", integrationMode: "managed",
    capabilities: { supportsStart: true, supportsResume: false, supportsStreaming: true, supportsInterrupt: true,
      supportsHandoff: false, supportsWorkspaceLeases: true }, workspaceRef: `workspace_${"a".repeat(64)}`,
    workspaceGeneration: "a".repeat(64), now: start });
  await f.ok("PUT", `/api/rooms/${f.roomId}/participants`, { memberIds: [f.ownerMemberId], agentIds: [agent.agentId] });
  const offer = structuredClone(fixtures.cases.find((entry: { kind: string }) => entry.kind === "workPolicyOffer").instance) as WorkPolicyOffer;
  Object.assign(offer.spec, { agentId: agent.agentId, roomIds: [f.roomId], initiatorMemberIds: [f.ownerMemberId] });
  let socket = await f.app.injectWS("/ws/bridge", { headers: { authorization: `Bearer ${credential.secret}`, host: "127.0.0.1" } });
  t.after(() => socket.terminate());
  const received: Array<{ type: string; payload: { workAuthorization?: WorkAuthorization; [key: string]: any } }> = [];
  socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  const send = async (type: string, payload: unknown) => new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: "msg_work_server_test01", timestamp: current, type, payload }),
      (error?: Error) => error ? reject(error) : resolve());
  });
  const publish = async (grants: ExecutionGrantSummary[] = [], offers = [offer], conversationCapability = true, runtimePolicy?: {filesystemAccess: "local-policy" | "workspace-write"; deviceTrust?: {mode: "full"; revision: number}}) => send("agent.publish", {
    teamId: f.teamId, agentId: agent.agentId, deviceId: device.deviceId, ownerMemberId: f.ownerMemberId, ...(runtimePolicy ? {runtimePolicy} : {}),
    name: agent.name, role: agent.role, runtimeScopeId: "b".repeat(64), workspaceRef: agent.workspaceRef,
    workspaceGeneration: agent.workspaceGeneration, workspaceAlias: "Work repository",
    capabilities: { invocationMode: "managed", ...agent.capabilities, workPolicyOffers: offers, supportsConversationWork: conversationCapability,
      supportsArtifactPublication: true, supportsArtifactMaterialization: true,
      ...(grants.length ? { governedExecution: { ...helloCapability, readyGrants: grants } } : {}) }
  });
  await send("bridge.hello", { bridgeVersion: "0.4.0-test.1", connectionEpoch: 1, deviceId: device.deviceId,
    supportedProtocolVersions: ["1.0"], governedExecution: helloCapability });
  await publish();
  await waitFor(async () => (await f.ok("GET", `/api/rooms/${f.roomId}/development-options`)).options[0]?.state === "available");
  const input = (suffix: string) => ({ operationId: `op_development_${suffix}`, agentId: agent.agentId, policyId: offer.spec.policyId,
    policyDigest: offer.digest, baseCommit: offer.baseCommit, title: `Develop ${suffix}`, goal: `Implement ${suffix} in the selected repository`, criteria: ["Deliver the requested implementation with candidate evidence."] });
  const grant = (request: WorkAuthorization): ExecutionGrantSummary => ({
    grant: { grantId: request.spec.grantId, revision: 1, digest: "f".repeat(64), expiresAt: request.spec.expiresAt },
    repositoryId: request.spec.repositoryId, bindingId: request.spec.bindingId, deviceId: device.deviceId, agentId: agent.agentId,
    planId: request.spec.planId, nodeKey: request.spec.nodeKey, operations: request.spec.operations,
    runtimeProfile: request.spec.runtimeProfile, verificationProfiles: request.spec.verificationProfiles,
    scopePolicy: request.spec.scopePolicy, integrationTargets: [], issuedAt: start, revokedAt: null
  });
  const receipt = (request: WorkAuthorization, granted = grant(request)): WorkAuthorizationReceipt => ({ version: 1,
    deviceId: device.deviceId, authorizationId: request.parent.authorizationId, requestDigest: executionOperationDigest(request),
    status: "authorized", grant: granted, reason: "authorized", observedAt: current });
  return { ...f, get app() { return f.app; }, core, agent, device, get socket() { return socket; }, send, publish, offer, received, input, grant, receipt,
    async reconnect(epoch: number, restart: boolean) {
      socket.terminate();
      if (restart) await f.restart();
      await f.app.ready();
      socket = await f.app.injectWS("/ws/bridge", { headers: { authorization: `Bearer ${credential.secret}`, host: "127.0.0.1" } });
      socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));
      await send("bridge.hello", { bridgeVersion: "0.4.0-test.1", connectionEpoch: epoch, deviceId: device.deviceId,
        supportedProtocolVersions: ["1.0"], governedExecution: helloCapability });
      await publish();
    },
    clock: (value: string) => { current = value; } };
}

test("Room creates two exact development Tasks; publication cannot bypass the receipt gate", async (t) => {
  const f = await setup(t, 100);
  const first = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("first0001"));
  const second = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("second0001"));
  assert.notEqual(first.taskId, second.taskId);
  assert.notEqual(first.planId, second.planId);
  const replay = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("first0001"));
  assert.deepEqual(replay, first);
  await waitFor(() => f.received.filter((message) => message.type === "work.authorization.requested").length >= 2);
  const requests = f.received.filter((message) => message.type === "work.authorization.requested").map((message) => message.payload.workAuthorization!);
  for (const request of requests) {
    assert.equal(request.parent.initiatorMemberId, f.ownerMemberId);
    assert.equal(request.spec.grantId, workTaskGrantId(request.parent));
    assert.equal(request.spec.baseCommit, f.offer.baseCommit);
    const task = await f.ok("GET", `/api/tasks/${request.spec.taskId}`);
    assert.equal(task.criteria.length, 1);
    assert.equal(task.budgetPolicy.maxRunAttempts, f.offer.spec.maxRunAttempts);
    const plan = await f.ok("GET", `/api/execution-plans/${request.spec.planId}`);
    assert.equal(plan.current.digest, request.spec.planDigest);
    assert.equal(plan.current.definition.nodes.length, 1);
    assert.deepEqual(plan.current.definition.nodes[0].outputs.map((slot: { kind: string }) => slot.kind), ["commit", "patch"]);
  }
  await f.publish(requests.map(f.grant));
  await waitFor(() => f.core.getAgent(f.agent.agentId)?.capabilities.governedExecution?.readyGrants?.length === 2);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(f.received.filter((message) => message.type === "run.requested").length, 0);
  assert.equal((f.database.prepare("SELECT count(*) AS count FROM runs").get() as { count: number }).count, 0);
  await f.send("work.authorization.receipt", { connectionEpoch: 1, workAuthorizationReceipt: f.receipt(requests[0]!) });
  await waitFor(() => f.received.some((message) => message.type === "run.requested")).catch((error) => {
    assert.fail(`${String(error)} nodes=${JSON.stringify(f.database.prepare("SELECT state, blocker_code FROM execution_node_states").all())} socket=${f.socket.readyState} ledger=${JSON.stringify(f.database.prepare("SELECT state, reason FROM development_work_authorizations").all())} plans=${JSON.stringify(f.database.prepare("SELECT state FROM execution_plans").all())} runs=${JSON.stringify(f.database.prepare("SELECT state FROM runs").all())}`);
  });
  const run = f.received.find((message) => message.type === "run.requested")!;
  assert.equal(run.payload.contextManifest.execution.scope.taskId, first.taskId);
  assert.equal(run.payload.contextManifest.execution.grant.grantId, requests[0]!.spec.grantId);
  assert.equal(f.received.filter((message) => message.type === "run.requested").length, 1);
  assert.equal((await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items.find((item: { taskId: string }) => item.taskId === first.taskId).state, "authorized");
});

test("changed command, unallowed initiator and scope cannot create development work", async (t) => {
  const f = await setup(t);
  const value = f.input("immutable01");
  await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, value);
  for (const changed of [{ ...value, goal: "Different intent" }, { ...value, operationId: "op_development_source01", baseCommit: "0".repeat(40) },
    { ...value, operationId: "op_development_command01", command: "git push" }]) {
    const response = await f.request("POST", `/api/rooms/${f.roomId}/development-tasks`, changed);
    assert.ok(response.statusCode >= 400, response.body);
  }
  const denied = structuredClone(f.offer); denied.spec.initiatorMemberIds = ["member_unallowed01"];
  await f.publish([], [denied]);
  await waitFor(async () => (await f.ok("GET", `/api/rooms/${f.roomId}/development-options`)).options[0]?.state === "unavailable");
  const response = await f.request("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("unallowed01"));
  assert.equal(response.statusCode, 409, response.body);
  assert.equal((f.database.prepare("SELECT count(*) AS count FROM development_work_authorizations").get() as { count: number }).count, 1);
  assert.throws(() => f.database.prepare("UPDATE development_work_authorizations SET request_digest = ?").run("0".repeat(64)), /immutable/u);
});

test("expired negotiation cannot be resurrected by a late receipt", async (t) => {
  const f = await setup(t, 100);
  const task = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("expired0001"));
  await waitFor(() => f.received.some((message) => message.type === "work.authorization.requested"));
  const request = f.received.find((message) => message.type === "work.authorization.requested")!.payload.workAuthorization!;
  f.clock("2026-09-08T00:02:00.000Z");
  assert.equal((await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items[0].state, "expired");
  await f.publish([f.grant(request)]);
  await f.send("work.authorization.receipt", { connectionEpoch: 1, workAuthorizationReceipt: f.receipt(request) });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(f.received.filter((message) => message.type === "run.requested").length, 0);
  const replay = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("expired0001"));
  assert.equal(replay.taskId, task.taskId);
  assert.equal(replay.state, "expired");
});

test("canceled Task invalidates pending work before a late authorization receipt", async (t) => {
  const f = await setup(t, 100);
  const created = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("canceled001"));
  await waitFor(() => f.received.some((message) => message.type === "work.authorization.requested"));
  const request = f.received.find((message) => message.type === "work.authorization.requested")!.payload.workAuthorization!;
  const task = await f.ok("GET", `/api/tasks/${created.taskId}`);
  await f.ok("POST", `/api/tasks/${created.taskId}/control`, {
    operationId: "op_work_cancel0001", expectedTaskRevision: task.taskRevision, lifecycleState: "canceled"
  });
  await f.publish([f.grant(request)]);
  await f.send("work.authorization.receipt", { connectionEpoch: 1, workAuthorizationReceipt: f.receipt(request) });
  await waitFor(async () => (await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items[0].state === "canceled");
  assert.equal((f.database.prepare("SELECT count(*) AS count FROM runs").get() as { count: number }).count, 0);
});

test("Central restart and Bridge reconnect replay the exact request without duplicating Tasks", async (t) => {
  const f = await setup(t);
  const created = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("restarted01"));
  await waitFor(() => f.received.some((message) => message.type === "work.authorization.requested"));
  const request = f.received.find((message) => message.type === "work.authorization.requested")!.payload.workAuthorization!;
  await f.reconnect(2, true);
  await waitFor(() => f.received.filter((message) => message.type === "work.authorization.requested").length === 2);
  const replay = f.received.filter((message) => message.type === "work.authorization.requested")[1]!;
  assert.equal(replay.payload.connectionEpoch, 2);
  assert.deepEqual(replay.payload.workAuthorization, request);
  await f.publish([f.grant(request)]);
  await f.send("work.authorization.receipt", { connectionEpoch: 2, workAuthorizationReceipt: f.receipt(request) });
  await waitFor(async () => (await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items[0].state === "authorized");
  const repeated = await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("restarted01"));
  assert.equal(repeated.taskId, created.taskId);
  assert.equal((f.database.prepare("SELECT count(*) AS count FROM development_work_authorizations").get() as { count: number }).count, 1);
});

for (const invalid of ["stale epoch", "changed digest", "unpublished grant"] as const) {
  test(`${invalid} cannot authorize development work`, async (t) => {
    const f = await setup(t, 100);
    await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("rejected001"));
    await waitFor(() => f.received.some((message) => message.type === "work.authorization.requested"));
    const request = f.received.find((message) => message.type === "work.authorization.requested")!.payload.workAuthorization!;
    if (invalid !== "unpublished grant") await f.publish([f.grant(request)]);
    const receipt = f.receipt(request);
    if (invalid === "changed digest") receipt.requestDigest = "0".repeat(64);
    await f.send("work.authorization.receipt", { connectionEpoch: invalid === "stale epoch" ? 2 : 1, workAuthorizationReceipt: receipt });
    await waitFor(() => f.socket.readyState >= 2);
    assert.equal((await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items[0].state, "pending");
    assert.equal((f.database.prepare("SELECT count(*) AS count FROM runs").get() as { count: number }).count, 0);
  });
}


async function conversation(f: Awaited<ReturnType<typeof setup>>, content: string, proposal = true, taskId?: string) {
  const input = { content, mentionAgentId: f.agent.agentId, clientMessageId: `client_${crypto.randomUUID().replaceAll("-", "_")}`, ...(taskId ? {taskId} : {}) };
  const sent = await f.ok("POST", `/api/rooms/${f.roomId}/messages`, input);
  const run = sent.runs[0];
  await waitFor(() => f.received.some((m) => m.type === "run.requested" && m.payload.runId === run.runId));
  const delivery = f.received.find((m) => m.type === "run.requested" && m.payload.runId === run.runId)!.payload;
  assert.equal(delivery.conversationWork, true);
  const identity = { runId: run.runId, traceId: run.traceId, agentId: f.agent.agentId };
  await f.send("run.accepted", {...identity, sequence: 1, deliveryAttemptId: delivery.deliveryAttemptId});
  await f.send("run.status", {...identity, sequence: 2, status: "working"});
  const reply = {...identity, sequence: 3, content: proposal ? "Preparing the requested work." : "Read-only review: no file changes were requested.",
    ...(proposal ? {developmentProposal: {title: "Conversation change", criteria: ["Meet the original request and retain verification evidence."]}} : {})};
  await f.send("run.reply", reply);
  await waitFor(() => f.database.prepare("SELECT 1 FROM run_events WHERE run_id = ? AND sequence = 3").get(run.runId) !== undefined);
  return {run, delivery, identity, input, reply,
    complete: () => f.send("run.status", {...identity, sequence: 4, status: "completed"})};
}

test("ordinary mention continues through owner policy with original context and exact replay", async (t) => {
  const f = await setup(t, 100);
  await f.ok("POST", `/api/rooms/${f.roomId}/messages`, {content: "Keep the existing purple style and keyboard interactions."});
  const c = await conversation(f, "@Developer Fix the input box without changing its keyboard behavior.");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 0);
  await c.complete();
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested")).catch((error) => { throw new Error(`${error}; proposals=${JSON.stringify(f.database.prepare("SELECT state, reason FROM conversation_development_requests").all())}; source=${JSON.stringify(f.database.prepare("SELECT state FROM runs").all())}`); });
  const authorization = f.received.find((m) => m.type === "work.authorization.requested")!.payload.workAuthorization!;
  const work = (await f.ok("GET", `/api/rooms/${f.roomId}/development-tasks`)).items[0];
  const root = await f.ok("GET", `/api/tasks/${work.rootTaskId}`);
  assert.equal((f.database.prepare("SELECT source_task_id FROM conversation_development_requests").get() as {source_task_id: string}).source_task_id, c.run.taskId);
  assert.match(root.goal, /Fix the input box/u);
  assert.match(root.goal, /existing purple style/u);
  const sourceMessages = f.core.listMessagesThrough(f.roomId, 9999, 100).filter((m) => m.taskId === c.run.taskId);
  assert.ok(sourceMessages.some((m) => m.content.includes(work.rootTaskId)));
  const replay = await f.ok("POST", `/api/rooms/${f.roomId}/messages`, c.input);
  assert.equal(replay.message.messageId, c.run.triggerMessageId);
  await f.send("run.reply", c.reply); await c.complete();
  await f.publish([f.grant(authorization)]);
  await f.send("work.authorization.receipt", {connectionEpoch: 1, workAuthorizationReceipt: f.receipt(authorization)});
  await waitFor(() => f.received.filter((m) => m.type === "run.requested").length === 2);
  const child = f.received.filter((m) => m.type === "run.requested")[1]!.payload;
  assert.equal(child.conversationWork, undefined);
  assert.equal(child.contextManifest.execution.scope.taskId, work.taskId);
  assert.equal(f.database.prepare("SELECT count(*) n FROM conversation_development_requests").get()!.n, 1);
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 1);
});

test("reading and discussion text stays a normal answer without a development plan", async (t) => {
  const f = await setup(t, 100);
  const c = await conversation(f, "Review this code and explain how to fix it; do not modify any file.", false);
  await c.complete();
  await waitFor(() => f.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(c.run.runId)!.state === "completed");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.database.prepare("SELECT count(*) n FROM conversation_development_requests").get()!.n, 0);
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 0);
  assert.equal(f.received.filter((m) => m.type === "run.requested").length, 1);
});

for (const outcome of ["failed", "canceled", "outcome_unknown", "input_required"] as const) {
  test(`conversation ${outcome} cannot admit a development continuation`, async (t) => {
    const f = await setup(t, 100);
    const c = await conversation(f, "Fix the input box.");
    await f.send("run.status", {...c.identity, sequence: 4, status: outcome,
      ...(outcome === "input_required" ? {clarification: {kind: "task", question: "Which project?"}} : {})});
    await waitFor(() => f.database.prepare("SELECT state FROM conversation_development_requests").get()!.state === "canceled");
    await f.send("run.reply", c.reply);
    assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 0);
  });
}

test("missing owner policy returns a blocker in the original conversation", async (t) => {
  const f = await setup(t, 100);
  await f.publish([], []);
  await waitFor(async () => (await f.ok("GET", `/api/rooms/${f.roomId}/development-options`)).options[0].state === "unavailable");
  const c = await conversation(f, "Implement the requested UI change."); await c.complete();
  await waitFor(() => f.database.prepare("SELECT state FROM conversation_development_requests").get()!.state === "blocked");
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 0);
  assert.ok(f.core.listMessagesThrough(f.roomId, 9999, 100).some((m) => m.taskId === c.run.taskId && m.content.includes("完成一次")));
});

test("a pending proposal survives Central restart and cannot duplicate work", async (t) => {
  const f = await setup(t, 100);
  const c = await conversation(f, "Implement the requested change.");
  await f.reconnect(2, true);
  await c.complete();
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested")).catch((error) => { throw new Error(`${error}; proposals=${JSON.stringify(f.database.prepare("SELECT state, reason FROM conversation_development_requests").all())}; source=${JSON.stringify(f.database.prepare("SELECT state FROM runs").all())}`); });
  await f.send("run.reply", c.reply);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 1);
});

test("changed proposal replay cannot replace the original intent", async (t) => {
  const f = await setup(t, 100);
  const c = await conversation(f, "Implement the requested change.");
  await f.send("run.reply", {...c.reply, developmentProposal: {title: "Other goal", criteria: ["Replace the original goal"]}});
  await waitFor(() => f.socket.readyState >= 2);
  const stored = f.database.prepare("SELECT proposal_json FROM conversation_development_requests").get()!;
  assert.equal(JSON.parse(stored.proposal_json).title, "Conversation change");
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 0);
});

test("a completed proposal waits for a disconnected device and resumes without resubmission", async (t) => {
  const f = await setup(t, 100);
  const c = await conversation(f, "Implement the requested change.");
  await c.complete();
  f.socket.terminate();
  await waitFor(() => f.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(c.run.runId)!.state === "completed");
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(f.database.prepare("SELECT state FROM conversation_development_requests").get()!.state, "pending");
  assert.ok(f.core.listMessagesThrough(f.roomId, 9999, 100).some((m) => m.content.includes("连接恢复后会自动继续")));
  await f.reconnect(2, true);
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested"));
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n, 1);
});

test("expired continuation retains its budget ceiling until the process outcome is known", async (t) => {
  const f = await setup(t, 100);
  const c = await conversation(f, "Implement the requested change."); await c.complete();
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested"));
  const authorization = f.received.find((m) => m.type === "work.authorization.requested")!.payload.workAuthorization!;
  await f.publish([f.grant(authorization)]);
  await f.send("work.authorization.receipt", {connectionEpoch: 1, workAuthorizationReceipt: f.receipt(authorization)});
  await waitFor(() => f.received.filter((m) => m.type === "run.requested").length === 2);
  const child = f.received.filter((m) => m.type === "run.requested")[1]!.payload;
  const before = f.database.prepare("SELECT reserved_attempts, reserved_seconds FROM conversation_development_requests").get()!;
  f.clock(authorization.spec.expiresAt);
  await waitFor(() => f.database.prepare("SELECT state FROM conversation_development_requests").get()!.state === "canceled");
  assert.deepEqual(f.database.prepare("SELECT reserved_attempts, reserved_seconds FROM conversation_development_requests").get(), before);
  assert.ok(f.database.prepare("SELECT 1 FROM run_cancellation_intents WHERE run_id = ?").get(child.runId));
});


test("continuation reserves the source Task budget and prevents concurrent overspend", async (t) => {
  const f = await setup(t, 100);
  const task = await f.ok("POST", `/api/rooms/${f.roomId}/tasks`, {title: "Bounded source", goal: "Fix the existing input",
    primaryAgentId: f.agent.agentId, lifecycleState: "ready", budgetPolicy: {maxRunAttempts: 2, maxExecutionDurationSeconds: 120}});
  const c = await conversation(f, "Fix the input box.", true, task.taskId); await c.complete();
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested"));
  const authorization = f.received.find((m) => m.type === "work.authorization.requested")!.payload.workAuthorization!;
  assert.equal(authorization.parent.maxRunAttempts, 1);
  assert.ok(Date.parse(authorization.spec.expiresAt)-Date.parse(start) <= 120000);
  const extra = await f.request("POST", `/api/rooms/${f.roomId}/messages`, {taskId: task.taskId, content: "One more execution", mentionAgentId: f.agent.agentId});
  assert.ok(extra.statusCode >= 400, extra.body);
  assert.equal((f.database.prepare("SELECT count(*) n FROM runs WHERE task_id = ?").get(task.taskId) as {n:number}).n,1);
});

test("canceling the original Task fences even an already authorized continuation", async (t) => {
  const f = await setup(t, 100);
  const task = await f.ok("POST", `/api/rooms/${f.roomId}/tasks`, {title: "Cancelable source", goal: "Fix input",
    primaryAgentId: f.agent.agentId, lifecycleState: "ready"});
  const c = await conversation(f, "Fix the input box.", true, task.taskId); await c.complete();
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested"));
  const authorization = f.received.find((m) => m.type === "work.authorization.requested")!.payload.workAuthorization!;
  await f.publish([f.grant(authorization)]);
  await f.send("work.authorization.receipt", {connectionEpoch: 1, workAuthorizationReceipt: f.receipt(authorization)});
  await waitFor(() => f.received.filter((m) => m.type === "run.requested").length === 2);
  const child = f.received.filter((m) => m.type === "run.requested")[1]!.payload;
  const current = await f.ok("GET", `/api/tasks/${task.taskId}`);
  await f.ok("POST", `/api/tasks/${task.taskId}/control`, {operationId:"op_conversation_cancel01",expectedTaskRevision:current.taskRevision,lifecycleState:"canceled"});
  await waitFor(() => f.database.prepare("SELECT 1 FROM run_cancellation_intents WHERE run_id = ?").get(child.runId) !== undefined);
  assert.equal((f.database.prepare("SELECT state FROM conversation_development_requests").get() as {state:string}).state,"canceled");
  await f.send("run.reply",c.reply);
  assert.equal((f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get() as {n:number}).n,1);
});

test("a legacy delivery cannot acquire development authority by adding a proposal", async (t) => {
  const f = await setup(t, 100); await f.publish([], [f.offer], false);
  await waitFor(() => f.core.getAgent(f.agent.agentId)?.capabilities.supportsConversationWork === false);
  const posted=await f.ok("POST",`/api/rooms/${f.roomId}/messages`,{content:"Legacy conversation",mentionAgentId:f.agent.agentId});
  const run=posted.runs[0];
  await waitFor(()=>f.received.some(m=>m.type==="run.requested"));
  assert.equal(f.received.find(m=>m.type==="run.requested")!.payload.conversationWork,undefined);
  await f.send("run.reply",{runId:run.runId,agentId:f.agent.agentId,traceId:run.traceId,sequence:1,content:"Forged proposal",developmentProposal:{title:"Forged",criteria:["Write anyway"]}});
  await waitFor(()=>f.socket.readyState>=2);
  assert.equal((f.database.prepare("SELECT count(*) n FROM conversation_development_requests").get() as {n:number}).n,0);
});

test("an out-of-order proposal after terminal completion cannot create work", async (t) => {
  const f=await setup(t,100);
  const c=await conversation(f,"Read and explain only.",false); await c.complete();
  await waitFor(()=>(f.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(c.run.runId) as {state:string}).state==="completed");
  await f.send("run.reply",{...c.reply,developmentProposal:{title:"Late write",criteria:["Modify files"]}});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal((f.database.prepare("SELECT count(*) n FROM conversation_development_requests").get() as {n:number}).n,0);
});


test("trusted device consent is visible, frozen and revoked before a queued Run can dispatch", async (t) => {
  const f = await setup(t, 100);
  await f.publish([], [], true, {filesystemAccess:"local-policy", deviceTrust:{mode:"full",revision:1}});
  await waitFor(() => f.core.getAgent(f.agent.agentId)?.runtimePolicy?.deviceTrust?.revision === 1).catch((error) => {throw new Error(`${error}; socket=${f.socket.readyState}; policy=${JSON.stringify(f.core.getAgent(f.agent.agentId)?.runtimePolicy)}`);});
  const sent = await f.ok("POST", `/api/rooms/${f.roomId}/messages`, {content:"Fix the input directly.",mentionAgentId:f.agent.agentId});
  const run = sent.runs[0];
  await waitFor(() => f.received.some((m) => m.type === "run.requested" && m.payload.runId === run.runId));
  const payload = f.received.find((m) => m.type === "run.requested" && m.payload.runId === run.runId)!.payload;
  assert.deepEqual(payload.deviceTrust,{mode:"full",revision:1});
  assert.equal(payload.contextManifest.permissions.deviceTrustRevision,1);
  assert.equal(payload.contextManifest.permissions.filesystemAccess,"full-access");
  assert.equal(payload.conversationWork,undefined);
  assert.equal(f.database.prepare("SELECT count(*) n FROM development_work_authorizations").get()!.n,0);
  f.socket.terminate(); await f.reconnect(2,false);
  await waitFor(() => f.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(run.runId)!.state === "failed");
  assert.equal(f.received.filter((m) => m.type === "run.requested" && m.payload.runId === run.runId).length,1);
});

test("a governed Run retains scoped authority on a fully trusted device", async (t) => {
  const f = await setup(t, 100);
  await f.ok("POST", `/api/rooms/${f.roomId}/development-tasks`, f.input("trustedscoped01"));
  await waitFor(() => f.received.some((m) => m.type === "work.authorization.requested"));
  const request = f.received.find((m) => m.type === "work.authorization.requested")!.payload.workAuthorization!;
  await f.publish([f.grant(request)], [f.offer], true, {filesystemAccess:"local-policy", deviceTrust:{mode:"full", revision:1}});
  await waitFor(() => f.core.getAgent(f.agent.agentId)?.runtimePolicy?.deviceTrust?.revision === 1);
  await f.send("work.authorization.receipt", {connectionEpoch:1, workAuthorizationReceipt:f.receipt(request)});
  await waitFor(() => f.received.some((m) => m.type === "run.requested"));
  const payload = f.received.find((m) => m.type === "run.requested")!.payload;
  assert.ok(payload.contextManifest.execution);
  assert.equal(payload.deviceTrust, undefined);
  assert.equal(payload.contextManifest.permissions.deviceTrustRevision, undefined);
  assert.equal(payload.contextManifest.permissions.filesystemAccess, "local-policy");
  assert.equal(payload.contextManifest.permissions.networkAccess, "not_recorded");
});

test("a web Agent registration cannot forge device full trust",async(t)=>{
  const f=await setup(t);
  const result=await f.request("POST",`/api/teams/${f.teamId}/agents`,{deviceId:f.device.deviceId,name:"Forged",role:"Developer",integrationMode:"managed",capabilities:f.agent.capabilities,runtimePolicy:{filesystemAccess:"local-policy",deviceTrust:{mode:"full",revision:1}}});
  assert.ok(result.statusCode>=400,result.body);
});
