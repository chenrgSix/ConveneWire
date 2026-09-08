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
  const publish = async (grants: ExecutionGrantSummary[] = [], offers = [offer]) => send("agent.publish", {
    teamId: f.teamId, agentId: agent.agentId, deviceId: device.deviceId, ownerMemberId: f.ownerMemberId,
    name: agent.name, role: agent.role, runtimeScopeId: "b".repeat(64), workspaceRef: agent.workspaceRef,
    workspaceGeneration: agent.workspaceGeneration, workspaceAlias: "Work repository",
    capabilities: { invocationMode: "managed", ...agent.capabilities, workPolicyOffers: offers,
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
