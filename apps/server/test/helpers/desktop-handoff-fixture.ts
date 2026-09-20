import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { TestContext } from "node:test";
import type { HTTPMethods } from "fastify";
import Database from "better-sqlite3";
import { createTestResources } from "../../../../scripts/test/resources.mjs";
import { createServerApp } from "../../src/app.js";
import { CoreRepository } from "../../src/data/core-repository.js";
import { AuthService } from "../../src/security/auth-service.js";
import { AgentService } from "../../src/registry/agent-service.js";
import type { LocalNodeLaunch } from "@convene-wire/contracts/local-node";
export async function until(check: () => boolean) {
    for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}
    throw new Error("handoff fixture did not settle");
}
export async function desktopHubFixture(t: TestContext, port = 48129) {
    const resources = await createTestResources(t, "convenewire-handoff-hub-");
    const secret = () => randomBytes(32).toString("base64url");
    const localNode: LocalNodeLaunch = {schemaVersion:1,controlToken:secret(),identity:{schemaVersion:1,nodeId:`node_${secret()}`,ownerUserId:`user_${secret()}`,port,secret:secret()}};
    const now = new Date().toISOString(), host = `127.0.0.1:${port}`;
    const databasePath = path.join(resources.directory,"hub.sqlite");
    const app = await createServerApp({databasePath,localNode,clock:()=>now,executionSchedulerSweepMilliseconds:0});
    resources.defer(async()=>{for(const socket of app.websocketServer.clients)socket.terminate();await app.close();});
    const controlHeaders = {host,"x-convenewire-node-control":localNode.controlToken};
    const entry = await app.inject({method:"POST",url:"/api/local-node/control/entry",headers:controlHeaders});
    const ticket = entry.json().url.split("/").at(-1);
    const login = await app.inject({method:"POST",url:"/api/local-node/session",headers:{host},payload:{ticket}});
    const owner = {host,origin:`http://${host}`,authorization:`Bearer ${login.json().session.token}`};
    const request = (method: HTTPMethods,url: string,payload?: unknown,headers=owner) => app.inject({method,url,headers,...(payload===undefined?{}:{payload:payload as object})});
    const ok = async(method: HTTPMethods,url: string,payload?: unknown) => {const r=await request(method,url,payload);assert.equal(r.statusCode,200,r.body);return r.json();};
    const created = await ok("POST","/api/teams",{name:"Handoff Team"});
    const teamId=created.team.teamId, ownerMemberId=created.owner.memberId;
    await ok("POST",`/api/local-node/teams/${teamId}/bind`);
    const binding=(await app.inject({url:"/api/local-node/control/binding",headers:controlHeaders})).json().binding;
    const room = await ok("POST",`/api/teams/${teamId}/rooms`,{name:"Existing work"});
    const database=new Database(databasePath);resources.defer(()=>database.close());
    const core=new CoreRepository(database),auth=new AuthService(database),actor=auth.authenticateWebSession(owner.authorization.slice(7),now);
    const agent=new AgentService(core,auth).publishAgent(actor,{teamId,deviceId:binding.deviceId,name:"Local Codex",role:"Developer",integrationMode:"managed",now,
        capabilities:{supportsStart:true,supportsResume:true,supportsStreaming:true,supportsInterrupt:true,supportsHandoff:false}});
    await ok("PUT",`/api/rooms/${room.roomId}/participants`,{memberIds:[ownerMemberId],agentIds:[agent.agentId]});
    const task = await ok("POST",`/api/rooms/${room.roomId}/tasks`,{title:"Continue original work",goal:"Keep the original conversation",primaryAgentId:agent.agentId});
    const control = (input: unknown) => app.inject({method:"POST",url:"/api/local-node/control/handoff",headers:controlHeaders,payload:input as object});
    const socket=await app.injectWS("/ws/bridge",{headers:{host,authorization:`Bearer ${binding.token}`}});
    resources.defer(()=>socket.terminate());
    const messages: any[]=[];socket.on("message",data=>messages.push(JSON.parse(data.toString())));
    const send = (type: string,payload: unknown) => socket.send(JSON.stringify({protocolVersion:"1.0",messageId:`msg_${secret()}`,timestamp:now,type,payload}));
    send("bridge.hello",{bridgeVersion:"0.5.4-test.1",connectionEpoch:1,deviceId:binding.deviceId,supportedProtocolVersions:["1.0"]});
    send("agent.publish",{teamId,deviceId:binding.deviceId,ownerMemberId,agentId:agent.agentId,name:agent.name,role:agent.role,
        runtimeScopeId:"a".repeat(64),runtimePolicy:{filesystemAccess:"workspace-write"},capabilities:{invocationMode:"managed",...agent.capabilities}});
    await until(()=>core.getAgent(agent.agentId)?.runtimeScopeId==="a".repeat(64));
    return {resources,app,database,core,auth,actor,owner,now,host,localNode,controlHeaders,control,request,ok,task,room,teamId,agent,binding,ownerMemberId,messages,send,socket};
}
