import assert from "node:assert/strict";
import test from "node:test";
import { desktopHubFixture, until } from "./helpers/desktop-handoff-fixture.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { requireDesktopRun } from "../src/local-node/desktop-handoff.js";

test("native-only review, immutable scope, tagged delivery and release never recreate a session",async t=>{
  const f=await desktopHubFixture(t);const taskId=f.task.taskId, adoptionId="adoption_fixture_original_0001";
  const scopeResponse=await f.control({action:"scope",taskId});assert.equal(scopeResponse.statusCode,200,scopeResponse.body);const scope=scopeResponse.json();
  assert.deepEqual(scope.audience,["Local Owner","Local Codex (Agent)"]);
  for(const headers of [f.owner,{...f.controlHeaders,origin:`http://${f.host}`}]){
    assert.equal((await f.app.inject({method:"POST",url:"/api/local-node/control/handoff",headers,payload:{action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest}})).statusCode,403);
  }
  for(const extra of [{threadId:"private"},{audienceDigest:"0".repeat(64)}])assert.notEqual((await f.control({action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest,...extra})).statusCode,200);
  await f.ok("POST",`/api/local-node/tasks/${taskId}/codex/open`);
  assert.equal((await f.app.inject({url:"/api/local-node/control/state",headers:f.controlHeaders})).json().handoffTaskId,taskId);
  const confirmation=await f.control({action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest});assert.equal(confirmation.statusCode,200,confirmation.body);
  assert.equal((await f.control({action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest})).statusCode,200);
  const sent=await f.ok("POST",`/api/rooms/${f.room.roomId}/messages`,{taskId,content:"Continue the original work",mentionAgentId:f.agent.agentId});
  await until(()=>f.messages.some(m=>m.type==="run.requested"));
  const delivery=f.messages.find(m=>m.type==="run.requested").payload;
  assert.equal(delivery.desktopAdoptionId,adoptionId);assert.equal(delivery.desktopAudienceDigest,scope.audienceDigest);
  assert.equal(delivery.conversationWork,undefined);assert.equal(delivery.deviceTrust,undefined);
  assert.equal((await f.control({action:"validate",taskId,adoptionId,audienceDigest:scope.audienceDigest,runId:sent.runs[0].runId})).statusCode,200);
  const record=JSON.stringify(f.database.prepare("SELECT * FROM desktop_handoffs").all());assert.ok(!record.includes("threadId"));assert.ok(!record.includes("workspace"));
  assert.equal((await f.control({action:"release",taskId,adoptionId})).statusCode,200);
  assert.throws(()=>requireDesktopRun(f.database,f.core,sent.runs[0].runId));
  assert.equal((await f.control({action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest})).statusCode,400);
  assert.equal((await f.ok("GET",`/api/local-node/tasks/${taskId}/codex`)).state,"released");
});

test("changed audience and assignment block execution and publication; historical runs retain their frozen audience",async t=>{
  const f=await desktopHubFixture(t);const taskId=f.task.taskId,adoptionId="adoption_fixture_audience_0001";
  const scope=(await f.control({action:"scope",taskId})).json();
  assert.equal((await f.control({action:"confirm",taskId,adoptionId,audienceDigest:scope.audienceDigest})).statusCode,200);
  const sent=await f.ok("POST",`/api/rooms/${f.room.roomId}/messages`,{taskId,content:"Do the scoped work",mentionAgentId:f.agent.agentId});const run=sent.runs[0];
  await until(()=>f.messages.some(m=>m.type==="run.requested"));
  const extra=new MemberDeviceService(f.core,f.auth).addMember(f.actor,{teamId:f.teamId,userId:"user_handoff_other001",displayName:"New reader",now:f.now});
  await f.ok("PUT",`/api/rooms/${f.room.roomId}/participants`,{memberIds:[f.ownerMemberId,extra.memberId],agentIds:[f.agent.agentId]});
  assert.throws(()=>requireDesktopRun(f.database,f.core,run.runId));
  assert.equal((await f.ok("GET",`/api/local-node/tasks/${taskId}/codex`)).state,"paused");
  f.send("run.accepted",{runId:run.runId,traceId:run.traceId,agentId:f.agent.agentId,sequence:1});
  f.send("run.reply",{runId:run.runId,traceId:run.traceId,agentId:f.agent.agentId,sequence:2,content:"MUST_NOT_LEAK"});
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(f.database.prepare("SELECT 1 FROM messages WHERE content = 'MUST_NOT_LEAK'").get(),undefined);
  // A release remains possible after audience changes and does not remove the tombstone.
  assert.equal((await f.control({action:"release",taskId,adoptionId})).statusCode,200);
  assert.equal(f.database.prepare("SELECT state FROM desktop_handoffs WHERE task_id = ?").get(taskId)?.state,"released");
});

test("existing work and another Agent cannot be adopted",async t=>{
  const f=await desktopHubFixture(t);const taskId=f.task.taskId;
  await f.ok("POST",`/api/rooms/${f.room.roomId}/messages`,{taskId,content:"An earlier run",mentionAgentId:f.agent.agentId});
  assert.notEqual((await f.control({action:"scope",taskId})).statusCode,200);
  assert.notEqual((await f.control({action:"confirm",taskId,adoptionId:"adoption_fixture_late_0001",audienceDigest:"a".repeat(64)})).statusCode,200);
});


test("canceling an unconfirmed local review leaves a fresh Task available", async t => {
  const f = await desktopHubFixture(t);
  const taskId = f.task.taskId;
  const response = await f.control({action: "release", taskId, adoptionId: "adoption_unconfirmed_0001"});
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().adoptionId, "");
  assert.equal((await f.control({action: "scope", taskId})).json().state, "available");
  assert.equal(f.database.prepare("SELECT count(*) AS count FROM desktop_handoffs").get()?.count, 0);
});
