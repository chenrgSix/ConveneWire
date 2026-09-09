import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { RuntimeApprovalRequestedMessage, RunRequestedPayload } from "@convene-wire/contracts/bridge-messages";
import { fixture } from "./helpers/execution-plan-fixture.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { AuthService } from "../src/security/auth-service.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { AgentService } from "../src/registry/agent-service.js";

const initial = "2026-09-09T00:00:00.000Z";
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error("Condition did not settle");
}
async function setup(t: TestContext) {
  let now = initial;
  const f = await fixture(t, () => now);
  const core = new CoreRepository(f.database), auth = new AuthService(f.database);
  const actor = auth.authenticateWebSession(f.authorization.slice(7), now);
  const device = new MemberDeviceService(core, auth).registerOwnDevice(actor, f.teamId, "Owner laptop", now);
  const credential = auth.issueDeviceCredential(device.deviceId, now);
  const agent = new AgentService(core, auth).publishAgent(actor, { teamId: f.teamId, deviceId: device.deviceId,
    name: "Approval Codex", role: "Developer", integrationMode: "managed", now,
    capabilities: { supportsStart: true, supportsResume: true, supportsStreaming: true, supportsInterrupt: true, supportsHandoff: false } });
  await f.ok("PUT", `/api/rooms/${f.roomId}/participants`, { memberIds: [f.ownerMemberId], agentIds: [agent.agentId] });
  const socket = await f.app.injectWS("/ws/bridge", { headers: { authorization: `Bearer ${credential.secret}`, host: "127.0.0.1" } });
  t.after(() => socket.terminate());
  const received: { type: string; payload: RunRequestedPayload }[] = [];
  socket.on("message", data => received.push(JSON.parse(data.toString())));
  const send = (type: string, payload: unknown) => socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: "msg_approvalfixture1", timestamp: now, type, payload }));
  send("bridge.hello", { bridgeVersion: "0.5.4-test.1", connectionEpoch: 1, deviceId: device.deviceId, supportedProtocolVersions: ["1.0"] });
  send("agent.publish", { teamId: f.teamId, deviceId: device.deviceId, ownerMemberId: f.ownerMemberId, agentId: agent.agentId,
    name: agent.name, role: agent.role, runtimeScopeId: "a".repeat(64),
    runtimePolicy: { filesystemAccess: "workspace-write", centralApproval: { revision: 1 } },
    capabilities: { invocationMode: "managed", ...agent.capabilities, supportsConversationWork: true } });
  await until(() => core.getAgent(agent.agentId)?.runtimePolicy?.centralApproval?.revision === 1);
  const sent = await f.ok("POST", `/api/rooms/${f.roomId}/messages`, { content: "Write the approval test file", mentionAgentId: agent.agentId });
  const run = sent.runs[0];
  await until(() => received.some(item => item.type === "run.requested"));
  const delivery = received.find(item => item.type === "run.requested")!.payload;
  assert.deepEqual(delivery.centralApproval, { revision: 1 });
  assert.equal(delivery.deviceTrust, undefined);
  assert.equal(delivery.conversationWork, undefined);
  assert.equal(delivery.contextManifest?.permissions.filesystemAccess, "workspace-write");
  send("run.accepted", { agentId: agent.agentId, runId: run.runId, traceId: run.traceId, sequence: 1 });
  send("run.status", { agentId: agent.agentId, runId: run.runId, traceId: run.traceId, sequence: 2, status: "working" });
  await until(() => f.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(run.runId)!.state === "working");
  const input: RuntimeApprovalRequestedMessage = { protocolVersion: "1.0", messageId: "msg_approvalrequest1", timestamp: now,
    type: "runtime.approval.requested", payload: { requestId: "approval_runtimefixture01", runId: run.runId, agentId: agent.agentId,
      revision: 1, operationKind: "command", details: "Command:\nprintf approved > permission-test.txt\nWorking directory:\n/tmp/fixture",
      expiresAt: new Date(Date.parse(now) + 30_000).toISOString() } };
  const submit = (value: unknown = input, token = `Bearer ${credential.secret}`) => f.request("POST", "/api/bridge/runtime-approvals", value, token);
  const list = () => f.ok("GET", `/api/teams/${f.teamId}/runtime-approvals`);
  return { ...f, core, auth, actor, agent, device, credential, socket, run, input, submit, list,
    time: (value: string) => { now = value; } };
}

test("ordinary Room Run pauses at one exact owner-reviewed request and returns the decision idempotently", async t => {
  const f = await setup(t);
  const pending = await f.submit(); assert.equal(pending.statusCode, 200, pending.body);
  assert.equal(pending.json().payload.decision, "pending");
  const item = (await f.list()).items[0];
  assert.equal(item.request.details, f.input.payload.details);
  const url = `/api/runtime-approvals/${item.requestId}/decision`;
  assert.equal((await f.request("POST", url, { digest: "0".repeat(64), decision: "allow" })).statusCode, 403);
  assert.equal((await f.request("POST", url, { digest: item.digest, decision: "allow", scope: "session" })).statusCode, 400);
  const receipt = await f.ok("POST", url, { digest: item.digest, decision: "allow" });
  assert.deepEqual(await f.ok("POST", url, { digest: item.digest, decision: "allow" }), receipt);
  assert.equal((await f.request("POST", url, { digest: item.digest, decision: "deny" })).statusCode, 403);
  assert.deepEqual((await f.submit()).json().payload, receipt);
  assert.equal((await f.submit({ ...f.input, payload: { ...f.input.payload, details: "Changed command" } })).statusCode, 403);
  assert.equal(f.database.prepare("SELECT count(*) n FROM runtime_approvals").get()!.n, 1);
  assert.equal(f.database.prepare("SELECT count(*) n FROM runs").get()!.n, 1);
});

for (const condition of ["deny", "timeout", "cancel", "disconnect", "revision", "room_removed", "restart"] as const) {
  test(`approval cannot allow after ${condition}`, async t => {
    const f = await setup(t);
    assert.equal((await f.submit()).statusCode, 200);
    const item = (await f.list()).items[0];
    if (condition === "deny") await f.ok("POST", `/api/runtime-approvals/${item.requestId}/decision`, { digest: item.digest, decision: "deny" });
    if (condition === "timeout") f.time("2026-09-09T00:00:31.000Z");
    if (condition === "cancel") await f.ok("POST", `/api/runs/${f.run.runId}/cancel`, { reason: "Canceled test" });
    if (condition === "disconnect") { f.socket.terminate(); await new Promise(resolve => setTimeout(resolve, 30)); }
    if (condition === "revision") f.database.prepare("UPDATE agents SET runtime_policy_json = ? WHERE agent_id = ?")
      .run(JSON.stringify({ filesystemAccess: "workspace-write", centralApproval: { revision: 2 } }), f.agent.agentId);
    if (condition === "room_removed") await f.ok("PUT", `/api/rooms/${f.roomId}/participants`, { memberIds: [f.ownerMemberId], agentIds: [] });
    if (condition === "restart") await f.restart();
    assert.equal((await f.request("POST", `/api/runtime-approvals/${item.requestId}/decision`, { digest: item.digest, decision: "allow" })).statusCode, 403);
    assert.equal((await f.submit()).json().payload.decision, condition === "deny" ? "deny" : "expired");
  });
}

test("forged consent, foreign Device, Web/MCP credentials and sensitive details cannot create approval authority", async t => {
  const f = await setup(t);
  for (const fields of [{ revision: 2 }, { runId: "run_foreign0001" }, { agentId: "agent_foreign0001" },
    { details: "token=private-value-12345678" }]) {
    const response = await f.submit({ ...f.input, payload: { ...f.input.payload, ...fields } });
    assert.equal(response.statusCode, 403, response.body);
  }
  assert.equal((await f.submit(f.input, f.authorization)).statusCode, 401);
  const device = new MemberDeviceService(f.core, f.auth).registerOwnDevice(f.actor, f.teamId, "Different device", initial);
  const credential = f.auth.issueDeviceCredential(device.deviceId, initial);
  assert.equal((await f.submit(f.input, `Bearer ${credential.secret}`)).statusCode, 403);
  const registration = await f.request("POST", `/api/teams/${f.teamId}/agents`, { deviceId: f.device.deviceId,
    name: "Forged", role: "Developer", integrationMode: "managed", capabilities: f.agent.capabilities,
    runtimePolicy: { filesystemAccess: "workspace-write", centralApproval: { revision: 1 } } });
  assert.notEqual(registration.statusCode, 200);
  assert.equal(f.database.prepare("SELECT count(*) n FROM runtime_approvals").get()!.n, 0);
});

test("another Team owner cannot inspect or decide the Device owner's request", async t => {
  const f = await setup(t);
  const other = new MemberDeviceService(f.core, f.auth).addMember(f.actor, {
    teamId: f.teamId, userId: "user_approvalother01", displayName: "Another administrator", now: initial
  });
  f.database.prepare("UPDATE team_members SET role = 'owner' WHERE member_id = ?").run(other.memberId);
  await f.ok("PUT", `/api/rooms/${f.roomId}/participants`, { memberIds: [f.ownerMemberId, other.memberId], agentIds: [f.agent.agentId] });
  const session = f.auth.issueWebSession(other.userId!, initial, "2026-09-10T00:00:00.000Z");
  assert.equal((await f.submit()).statusCode, 200);
  const item = (await f.list()).items[0];
  assert.deepEqual((await f.ok("GET", `/api/teams/${f.teamId}/runtime-approvals`, undefined, `Bearer ${session.secret}`)).items, []);
  assert.equal((await f.request("POST", `/api/runtime-approvals/${item.requestId}/decision`,
    { digest: item.digest, decision: "allow" }, `Bearer ${session.secret}`)).statusCode, 403);
  assert.equal((await f.submit()).json().payload.decision, "pending");
});

test("cancellation expires delivery while preserving the original human decision", async t => {
  const f = await setup(t);
  assert.equal((await f.submit()).statusCode, 200);
  const item = (await f.list()).items[0];
  await f.ok("POST", `/api/runtime-approvals/${item.requestId}/decision`, { digest: item.digest, decision: "allow" });
  await f.ok("POST", `/api/runs/${f.run.runId}/cancel`, { reason: "Cancel before delivery" });
  assert.equal((await f.submit()).json().payload.decision, "expired");
  assert.equal(f.database.prepare("SELECT decided_decision FROM runtime_approvals WHERE request_id = ?").get(item.requestId)!.decided_decision, "allow");
});
