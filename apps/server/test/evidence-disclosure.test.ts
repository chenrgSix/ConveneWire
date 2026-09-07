import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test, { type TestContext } from "node:test";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../src/app.js";
import { CoreRepository } from "../src/data/core-repository.js";
import { openDatabase } from "../src/data/database.js";
import { AuthService } from "../src/security/auth-service.js";
import { TeamRoomService } from "../src/team-room/team-room-service.js";
import { MemberDeviceService } from "../src/registry/member-device-service.js";
import { AgentService } from "../src/registry/agent-service.js";
import { MessageService } from "../src/team-room/message-service.js";
import { AgentTaskRepository } from "../src/task/task-repository.js";
import { RunRepository } from "../src/run/run-repository.js";
import { RunService } from "../src/run/run-service.js";
import { DeliveryService } from "../src/run/delivery-service.js";
import { ContextPlanner } from "../src/task/context-planner.js";
import { BridgeConnectionRegistry } from "../src/bridge/bridge-connection-registry.js";
import { BridgeRunEventService } from "../src/run/bridge-run-event-service.js";
import { ManualTaskWorkService } from "../src/mcp/manual-task-work-service.js";
import { ResultService } from "../src/task/result-service.js";
import { ResultRepository } from "../src/task/result-repository.js";
import { AgentTaskService } from "../src/task/agent-task-service.js";
import type { EvidenceDisclosureIntent } from "@convene-wire/contracts/task-result";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function setup(t: TestContext) {
 const resources = await createTestResources(t,"convenewire-disclosure-");
 let now = new Date().toISOString();
 const databasePath = path.join(resources.directory,"server.sqlite");
 const app=await createServerApp({databasePath,clock:()=>now,logger:false});
 const db=openDatabase(databasePath);
 resources.defer(async()=>{db.close();await app.close();});
 const core=new CoreRepository(db),auth=new AuthService(db),teams=new TeamRoomService(core,auth),registry=new MemberDeviceService(core,auth),agents=new AgentService(core,auth);
 const created=teams.createTeamForUser({userId:"user_disclosure_alice0001",userDisplayName:"Alice",teamName:"Disclosure",now});
 const aliceSession=auth.issueWebSession(created.owner.userId!,now,new Date(Date.parse(now)+7200000).toISOString());
 const alice=auth.authenticateWebSession(aliceSession.secret,now);
 const bobMember=registry.addMember(alice,{teamId:created.team.teamId,userId:"user_disclosure_bob00001",displayName:"Bob",now});
 const bobSession=auth.issueWebSession(bobMember.userId!,now,new Date(Date.parse(now)+7200000).toISOString());
 const bob=auth.authenticateWebSession(bobSession.secret,now);
 const room=teams.createRoom(alice,created.team.teamId,"shared",now);
 const runRepo=new RunRepository(db),tasks=new AgentTaskRepository(db),runs=new RunService(core,runRepo,auth,tasks),messages=new MessageService(core,auth);
 const planner=new ContextPlanner(db,core,tasks);
 const delivery=new DeliveryService(db,core,runRepo,planner,new BridgeConnectionRegistry(),()=>now);
 const eventService=new BridgeRunEventService(core,runRepo,undefined,delivery);
 let ordinal=0;
 function makeOwner(principal:typeof alice,session:typeof aliceSession,name:string) {
   const device=registry.registerOwnDevice(principal,created.team.teamId,name,now),credential=auth.issueDeviceCredential(device.deviceId,now);
   const devicePrincipal=auth.authenticateDevice(credential.secret,now);
   const agent=agents.publishDeviceAgent(devicePrincipal,{agentId:`agent_disclosure_${name.toLowerCase()}0001`,name,role:"Private evidence",runtimeScopeId:hash(name),capabilities:{supportsStart:true,supportsInterrupt:true,supportsResume:false,supportsStreaming:false,supportsHandoff:false,ownerPrivateOutput:true},now});
   return {principal,session,device,credential,devicePrincipal,agent};
 }
 const a=makeOwner(alice,aliceSession,"Alice"),b=makeOwner(bob,bobSession,"Bob");
 teams.replaceRoomParticipants(alice,room.roomId,{memberIds:[created.owner.memberId,bobMember.memberId],agentIds:[a.agent.agentId,b.agent.agentId]},now);
 function newRun(owner:typeof a, complete = true) {
   const trigger=messages.createMemberMessage(owner.principal,{roomId:room.roomId,content:"Collect private facts locally",mentions:[{targetType:"agent",targetAgentId:owner.agent.agentId,displayLabel:owner.agent.name}],now});
   const run=runs.createRunsForMessage(owner.principal,trigger.messageId,now)[0]!;
   const dispatched=delivery.dispatch(run.runId)!;
   assert.equal(dispatched.payload.ownerPrivateOutput,true);
   runRepo.applyEvent(run.runId,{type:"status",sequence:1,status:"delivered"},now);
   eventService.applyStatus(owner.devicePrincipal,{runId:run.runId,traceId:run.traceId,agentId:owner.agent.agentId,sequence:2,status:"working"},now);
   if (complete) eventService.applyStatus(owner.devicePrincipal,{runId:run.runId,traceId:run.traceId,agentId:owner.agent.agentId,sequence:3,status:"completed"},now);
   const task=tasks.get(run.taskId)!;
   const content=`Authorized observation ${++ordinal} from ${owner.agent.name}.`;
   const intent:EvidenceDisclosureIntent={version:1,operationId:`op_disclosure_test_${ordinal}00000000`,deviceId:owner.device.deviceId,agentId:owner.agent.agentId,runId:run.runId,taskId:task.taskId,roomId:room.roomId,definitionRevision:task.definitionRevision,criteriaRevision:task.criteriaRevision,source:{evidenceRef:`evidence_disclosure_${ordinal}00000000`,revision:hash("snapshot"),contentSha256:hash("snapshot"),start:0,end:8},contentSha256:hash(content),contentBytes:Buffer.byteLength(content),audience:"room_members",expiresAt:new Date(Date.parse(now)+3600000).toISOString()};
   return {run,task,intent,content,delivery:dispatched};
 }
 async function request(method:"GET"|"POST",url:string,secret:string,payload?:unknown) {
   return app.inject({method,url,headers:{authorization:`Bearer ${secret}`},...(payload===undefined?{}:{payload:payload as object})});
 }
 const approve=(owner:typeof a,intent:EvidenceDisclosureIntent)=>request("POST","/api/evidence-disclosures",owner.session.secret,intent);
 const publish=(owner:typeof a,grantId:string,content:string)=>request("POST","/api/bridge/evidence-disclosures/publish",owner.credential.secret,{grantId,expectedRevision:1,content});
 return {app,db,core,auth,teams,agents,resources,planner,delivery,eventService,runRepo,tasks,a,b,room,newRun,request,approve,publish,setNow:(value:string)=>{now=value;},now:()=>now};
}

test("exact disclosure binds independent owner/device identities and reuses unaccepted Results",async t=>{
 const s=await setup(t);const a=s.newRun(s.a),b=s.newRun(s.b);
 const wrong=await s.approve(s.a,b.intent);assert.equal(wrong.statusCode,403,wrong.body);
 assert.equal((await s.request("POST","/api/evidence-disclosures",s.b.credential.secret,b.intent)).statusCode,401);
 for(const [owner,item] of [[s.a,a],[s.b,b]] as const){
  const response=await s.approve(owner,item.intent);assert.equal(response.statusCode,200,response.body);const grant=response.json();
  assert.equal(grant.ownerMemberId,owner.device.ownerMemberId);
  const foreign=owner===s.a?s.b:s.a;
  assert.equal((await s.request("GET",`/api/bridge/evidence-disclosures/${grant.grantId}`,foreign.credential.secret)).statusCode,403);
  assert.equal((await s.publish(owner,grant.grantId,item.content+" tampered")).statusCode,403);
  assert.equal((await s.request("POST","/api/bridge/evidence-disclosures/publish",owner.credential.secret,{grantId:grant.grantId,expectedRevision:1,content:item.content,grantState:{state:"active"}})).statusCode,400);
  const result=await s.publish(owner,grant.grantId,item.content);assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().result.proposal.summary,item.content);assert.equal(result.json().result.state,"proposed");
  assert.equal(result.json().result.review,null);
  const replay=await s.publish(owner,grant.grantId,item.content);assert.equal(replay.json().result.resultId,result.json().result.resultId);assert.equal(replay.json().replayed,true);
 }
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,2);
 const consumer=await s.request("GET",`/api/tasks/${a.task.taskId}/results`,s.a.session.secret);
 assert.equal(consumer.statusCode,200,consumer.body);
 assert.ok(consumer.body.includes(a.content));
 assert.ok(consumer.body.includes(b.content));
 assert.equal(JSON.stringify(s.runRepo.listEvents(a.run.runId)).includes(a.content),false);
});

test("revocation wins before commit; committed evidence resolves after revocation without creating duplicates",async t=>{
 const s=await setup(t);
 const withheld=s.newRun(s.b),pending=await s.approve(s.b,withheld.intent);assert.equal(pending.statusCode,200,pending.body);
 const grant=pending.json();
 // Model the network window: Bridge read active, then revoke commits while its POST is in flight.
 assert.equal((await s.request("GET",`/api/bridge/evidence-disclosures/${grant.grantId}`,s.b.credential.secret)).json().state,"active");
 assert.equal((await s.request("POST",`/api/evidence-disclosures/${grant.grantId}/revoke`,s.a.session.secret,{expectedRevision:1})).statusCode,403);
 assert.equal((await s.request("POST",`/api/evidence-disclosures/${grant.grantId}/revoke`,s.b.session.secret,{expectedRevision:1})).statusCode,200);
 assert.equal((await s.publish(s.b,grant.grantId,withheld.content)).statusCode,403);
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,0);
 const item=s.newRun(s.a),approved=await s.approve(s.a,item.intent);const id=approved.json().grantId;
 const first=await s.publish(s.a,id,item.content);assert.equal(first.statusCode,200,first.body);
 await s.request("POST",`/api/evidence-disclosures/${id}/revoke`,s.a.session.secret,{expectedRevision:1});
 const recovered=await s.request("GET",`/api/bridge/evidence-disclosures/${id}/result`,s.a.credential.secret);
 assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().result.resultId,first.json().result.resultId);
 assert.equal((await s.publish(s.a,id,item.content)).json().replayed,true);
 assert.equal((await s.publish(s.a,id,item.content+"changed")).statusCode,403);
 s.db.prepare("UPDATE device_credentials SET revoked_at=? WHERE credential_id=?").run(s.now(),s.a.devicePrincipal.credentialId);
 assert.equal((await s.request("GET",`/api/bridge/evidence-disclosures/${id}/result`,s.a.credential.secret)).statusCode,401);
});

test("invalid scope, revisions, expiry, reserved operations and ordinary Result bypass fail closed",async t=>{
 const s=await setup(t),item=s.newRun(s.a),foreign=s.newRun(s.b);
 for(const changes of [{runId:foreign.run.runId},{deviceId:s.b.device.deviceId},{criteriaRevision:99},{source:{...item.intent.source,end:0}},{expiresAt:s.now()}]){
   const response=await s.approve(s.a,{...item.intent,...changes});assert.ok(response.statusCode>=400,response.body);
 }
 const approved=await s.approve(s.a,item.intent);assert.equal(approved.statusCode,200,approved.body);
 const grantId=approved.json().grantId;
 const sourceChanged=await s.approve(s.a,{...item.intent,source:{...item.intent.source,start:1}});assert.equal(sourceChanged.statusCode,403);
 const proposal={operationId:item.intent.operationId,taskId:item.task.taskId,definitionRevision:1,criteriaRevision:1,proposedAtTaskRevision:item.task.taskRevision,supersedesResultId:null,outcome:"informational",summary:item.content,risks:[],openQuestions:[],nextActions:[],criterionClaims:[],sources:[{evidenceRefId:item.intent.source.evidenceRef,kind:"run_event",runId:item.run.runId,sequence:3}]};
 const bypass=await s.request("POST","/api/bridge/results",s.a.credential.secret,{actorKind:"managed_agent",agentId:s.a.agent.agentId,runId:item.run.runId,proposal});assert.equal(bypass.statusCode,400,bypass.body);
 const reserved=await s.request("POST",`/api/tasks/${item.task.taskId}/results`,s.a.session.secret,proposal);assert.ok(reserved.statusCode>=400,reserved.body);
 s.setNow(item.intent.expiresAt);assert.equal((await s.publish(s.a,grantId,item.content)).statusCode,403);
});

test("private Run has no reply, activity, clarification, assessment or error body egress",async t=>{
 const s=await setup(t),item=s.newRun(s.a,false);
 const identity={runId:item.run.runId,traceId:item.run.traceId,agentId:s.a.agent.agentId,sequence:3};
 const sentinel="PRIVATE_SOURCE_MUST_STAY_LOCAL";
 assert.throws(()=>s.eventService.applyReply(s.a.devicePrincipal,{...identity,content:sentinel},s.now()),/Private/);
 assert.throws(()=>s.eventService.applyOutput(s.a.devicePrincipal,{...identity,content:sentinel},s.now()),/Private/);
 assert.throws(()=>s.eventService.applyActivity(s.a.devicePrincipal,{...identity,activityId:"test",kind:"tool",phase:"completed",content:sentinel},s.now()),/Private/);
 assert.throws(()=>s.eventService.applyStatus(s.a.devicePrincipal,{...identity,status:"failed",error:{code:"PRIVATE_OUTPUT_WITHHELD",message:sentinel,retryable:false}},s.now()),/content-free/);
 assert.throws(()=>s.eventService.applyStatus(s.a.devicePrincipal,{...identity,status:"working",session:{disposition:"started",contextCursor:0}},s.now()),/content-free/);
 s.eventService.applyStatus(s.a.devicePrincipal,{...identity,status:"failed",error:{code:"PRIVATE_OUTPUT_WITHHELD",message:"Private output remains on the owner device.",retryable:false}},s.now());
 assert.equal(s.runRepo.getRun(item.run.runId)?.state,"failed");
 assert.equal(JSON.stringify(s.core.listMessagesAfter(s.room.roomId,0,50)).includes(sentinel),false);
 assert.equal(JSON.stringify(s.runRepo.listEvents(item.run.runId)).includes(sentinel),false);
});

test("private delivery is negotiated per connection epoch; reconnect cannot inherit an old capability",()=>{
 const registry=new BridgeConnectionRegistry();const sent:string[]=[];
 const socket={send:(text:string)=>sent.push(text),close:()=>{}};
 const message={type:"run.requested",payload:{targetAgentId:"agent_private_0001",ownerPrivateOutput:true}};
 registry.register("device_private0001",1,socket);
 assert.equal(registry.send("device_private0001",message),false);
 registry.recordPrivateOutputAgent("device_private0001",1,"agent_private_0001",true);
 assert.equal(registry.send("device_private0001",message),true);
 registry.register("device_private0001",2,socket);
 assert.equal(registry.recordPrivateOutputAgent("device_private0001",1,"agent_private_0001",true),false);
 assert.equal(registry.send("device_private0001",message),false);
 registry.recordPrivateOutputAgent("device_private0001",2,"agent_private_0001",true);
 assert.equal(registry.send("device_private0001",message),true);
 registry.recordPrivateOutputAgent("device_private0001",2,"agent_private_0001",false);
 assert.equal(registry.send("device_private0001",message),false);
 assert.equal(sent.length,2);
});

test("publication rollback leaves neither Result nor grant receipt and can retry after repair",async t=>{
 const s=await setup(t),item=s.newRun(s.a),grant=(await s.approve(s.a,item.intent)).json();
 s.db.exec(`CREATE TRIGGER disclosure_injected_failure BEFORE UPDATE OF result_id ON evidence_disclosure_grants
 WHEN NEW.result_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected commit failure'); END;`);
 assert.equal((await s.publish(s.a,grant.grantId,item.content)).statusCode,400);
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,0);
 assert.equal((await s.request("GET",`/api/bridge/evidence-disclosures/${grant.grantId}`,s.a.credential.secret)).json().resultId,null);
 assert.equal((s.db.prepare("SELECT count(*) n FROM messages WHERE sender_id = 'result_lifecycle'").get() as {n:number}).n,0);
 assert.equal(s.tasks.get(item.task.taskId)?.taskRevision,item.task.taskRevision);
 s.db.exec("DROP TRIGGER disclosure_injected_failure");
 assert.equal((await s.publish(s.a,grant.grantId,item.content)).statusCode,200);
});

test("actual Go Bridge client publishes through production HTTP and resolves the same committed Result",{timeout:120000},async t=>{
 const s=await setup(t),item=s.newRun(s.b),grant=(await s.approve(s.b,item.intent)).json();
 const sourcePath=path.join(s.resources.directory,"private-source.txt");await writeFile(sourcePath,"snapshot",{mode:0o600});
 const address=await s.app.listen({host:"127.0.0.1",port:0});
 const inputPath=path.join(s.resources.directory,"go-client-input.json");
 await writeFile(inputPath,JSON.stringify({URL:address,Credential:{serverUrl:address,deviceId:s.b.device.deviceId,ownerMemberId:s.b.device.ownerMemberId,teamId:s.b.device.teamId,token:s.b.credential.secret},Prepared:{intent:item.intent,content:item.content,sourcePath},GrantID:grant.grantId}),{mode:0o600});
 const output=await promisify(execFile)("go",["test","./internal/result","-run","^TestDisclosureProductionInterop$","-count=1"],{cwd:path.resolve(import.meta.dirname,"../../../bridge"),env:{...process.env,CONVENE_WIRE_DISCLOSURE_INTEROP_INPUT:inputPath},timeout:110000,maxBuffer:1<<20});
 assert.match(output.stdout,/ok/u);
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,1);
});

test("in-flight HTTP publication cannot commit after acknowledged revocation",{timeout:15000},async t=>{
 const s=await setup(t);
 let entered!:()=>void,release!:()=>void;
 const received=new Promise<void>(resolve=>{entered=resolve;});
 const blocked=new Promise<void>(resolve=>{release=resolve;});
 s.resources.defer(()=>release());
 s.app.addHook("preHandler",async request=>{
   if(request.url==="/api/bridge/evidence-disclosures/publish"){
     assert.equal((request.body as {content:string}).content,"Authorized observation 1 from Bob.");
     entered();await blocked;
   }
 });
 const item=s.newRun(s.b),grant=(await s.approve(s.b,item.intent)).json();
 const address=await s.app.listen({host:"127.0.0.1",port:0});
 const pending=fetch(`${address}/api/bridge/evidence-disclosures/publish`,{method:"POST",headers:{authorization:`Bearer ${s.b.credential.secret}`,"content-type":"application/json"},body:JSON.stringify({grantId:grant.grantId,expectedRevision:1,content:item.content})});
 await received; // Central has already received the content, but has not entered commit.
 const revoked=await s.request("POST",`/api/evidence-disclosures/${grant.grantId}/revoke`,s.b.session.secret,{expectedRevision:1});assert.equal(revoked.statusCode,200,revoked.body);
 release();const response=await pending;assert.equal(response.status,403);await response.arrayBuffer();
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,0);
});

test("current Room membership and Device ownership are checked again at publication",async t=>{
 const s=await setup(t),item=s.newRun(s.b),grant=(await s.approve(s.b,item.intent)).json();
 s.teams.replaceRoomParticipants(s.a.principal,s.room.roomId,{memberIds:[s.a.device.ownerMemberId],agentIds:[s.a.agent.agentId,s.b.agent.agentId]},s.now());
 assert.equal((await s.publish(s.b,grant.grantId,item.content)).statusCode,403);
 s.teams.replaceRoomParticipants(s.a.principal,s.room.roomId,{memberIds:[s.a.device.ownerMemberId,s.b.device.ownerMemberId],agentIds:[s.a.agent.agentId,s.b.agent.agentId]},s.now());
 s.db.prepare("UPDATE devices SET status='revoked', revoked_at=? WHERE device_id=?").run(s.now(),s.b.device.deviceId);
 assert.equal((await s.publish(s.b,grant.grantId,item.content)).statusCode,401);
});


test("authorized manual Finalizer reads released Results through the existing Task tool service",async t=>{
 const s=await setup(t),a=s.newRun(s.a),b=s.newRun(s.b);
 for(const [owner,item] of [[s.a,a],[s.b,b]] as const){const grant=(await s.approve(owner,item.intent)).json();assert.equal((await s.publish(owner,grant.grantId,item.content)).statusCode,200);}
 const manual=s.agents.publishAgent(s.a.principal,{teamId:s.a.device.teamId,deviceId:null,name:"Finalizer",role:"Evidence consumer",integrationMode:"manual",capabilities:{supportsStart:false,supportsInterrupt:false,supportsResume:false,supportsStreaming:false,supportsHandoff:true},now:s.now()});
 s.teams.replaceRoomParticipants(s.a.principal,s.room.roomId,{memberIds:[s.a.device.ownerMemberId,s.b.device.ownerMemberId],agentIds:[s.a.agent.agentId,s.b.agent.agentId,manual.agentId]},s.now());
 const credential=s.auth.issueMcpCredential(s.a.principal,manual.agentId,s.now());
 const principal=s.auth.authenticateMcp(credential.secret,s.now());
 const repository=new ResultRepository(s.db);
 const results=new ResultService(s.db,repository,new AgentTaskService(s.tasks,s.core,s.auth),s.tasks,s.runRepo,s.core,s.auth);
 const work=new ManualTaskWorkService(s.core,s.tasks,s.runRepo,repository,results);
 const received=work.listResults(principal,a.task.taskId);
 assert.deepEqual(new Set(received.map(r=>r.proposal.summary)),new Set([a.content,b.content]));
 s.teams.replaceRoomParticipants(s.a.principal,s.room.roomId,{memberIds:[s.a.device.ownerMemberId,s.b.device.ownerMemberId],agentIds:[s.a.agent.agentId,s.b.agent.agentId]},s.now());
 assert.throws(()=>work.listResults(principal,a.task.taskId),/access denied/);
});

test("lost publication ACK survives a Central restart and resolves after grant revocation",{timeout:20000},async t=>{
 const s=await setup(t);let dropped=false;
 s.app.addHook("onSend",async (request,reply,payload)=>{
   if(request.url==="/api/bridge/evidence-disclosures/publish" && !dropped && reply.statusCode===200){dropped=true;reply.raw.destroy();}
   return payload;
 });
 const item=s.newRun(s.a),grant=(await s.approve(s.a,item.intent)).json();
 const address=await s.app.listen({host:"127.0.0.1",port:0});
 await assert.rejects(fetch(`${address}/api/bridge/evidence-disclosures/publish`,{method:"POST",headers:{authorization:`Bearer ${s.a.credential.secret}`,"content-type":"application/json"},body:JSON.stringify({grantId:grant.grantId,expectedRevision:1,content:item.content})}));
 assert.equal(dropped,true);
 const committed=(s.db.prepare("SELECT result_id FROM task_results").get() as {result_id:string}).result_id;
 await s.app.close();
 const restarted=await createServerApp({databasePath:path.join(s.resources.directory,"server.sqlite"),clock:s.now,logger:false});
 s.resources.defer(()=>restarted.close());
 const revoked=await restarted.inject({method:"POST",url:`/api/evidence-disclosures/${grant.grantId}/revoke`,headers:{authorization:`Bearer ${s.a.session.secret}`},payload:{expectedRevision:1}});assert.equal(revoked.statusCode,200,revoked.body);
 const recovered=await restarted.inject({method:"GET",url:`/api/bridge/evidence-disclosures/${grant.grantId}/result`,headers:{authorization:`Bearer ${s.a.credential.secret}`}});
 assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().result.resultId,committed);assert.equal(recovered.json().replayed,true);
 assert.equal((s.db.prepare("SELECT count(*) n FROM task_results").get() as {n:number}).n,1);
});
