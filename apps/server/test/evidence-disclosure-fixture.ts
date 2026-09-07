import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import type { TestContext } from "node:test";
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
import type { EvidenceDisclosureIntent } from "@convene-wire/contracts/task-result";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export async function setup(t: TestContext) {
  const resources = await createTestResources(t,"convenewire-disclosure-");
  let now = new Date().toISOString();
  const databasePath = path.join(resources.directory,"server.sqlite");
  let app=await createServerApp({databasePath,clock:()=>now,logger:false});
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
  return {get app(){return app;},db,core,auth,teams,agents,resources,planner,delivery,eventService,runRepo,tasks,a,b,room,newRun,request,approve,publish,setNow:(value:string)=>{now=value;},now:()=>now,
    restart:async()=>{await app.close();app=await createServerApp({databasePath,clock:()=>now,logger:false});}};
}
