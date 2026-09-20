import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopHubFixture, until } from "../../apps/server/test/helpers/desktop-handoff-fixture.js";
import { handoffFixture } from "./codex-handoff-fixture.mjs";
import { spawnTestProcess } from "../test/child-process.mjs";
const native=process.env.CONVENE_WIRE_CODEX_HANDOFF_TEST_BIN;

test("original desktop conversation completes a real Room Run, survives coordinator restart and returns control",{skip:!native,timeout:120000},async t=>{
  const reservation=net.createServer();await new Promise<void>(resolve=>reservation.listen(0,"127.0.0.1",resolve));
  const port=(reservation.address() as net.AddressInfo).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const hub=await desktopHubFixture(t,port);await hub.app.listen({host:"127.0.0.1",port});
  const binary=path.join(hub.resources.directory,"handoff-driver");
  const build=spawnTestProcess(hub.resources,"go",["build","-o",binary,"./internal/desktopcodex/testdata/mediator"],{cwd:fileURLToPath(new URL("../../bridge",import.meta.url)),stdio:["ignore","pipe","pipe"]});
  let output="";for(const stream of [build.process.stdout,build.process.stderr])stream.on("data",chunk=>output+=chunk);
  assert.equal((await build.terminal).code,0,output);
  const fixture=await handoffFixture(t,native!);const desktop=await fixture.client({mediatorExecutable:binary,toolResult:"ORIGINAL_CALLBACK_OK",handoffHub:{origin:`http://${hub.host}`,token:hub.localNode.controlToken,nodeId:hub.localNode.identity.nodeId,agentId:hub.agent.agentId}});
  const start=await desktop.rpc("thread/start",{cwd:fixture.workspace,sandbox:"read-only",approvalPolicy:"never",dynamicTools:[{name:"desktop_fixture_tool",description:"Original handler",inputSchema:{type:"object",properties:{},additionalProperties:false}}]});
  const threadId=start.thread.id,taskId=hub.task.taskId,anchor="PRIVATE_SYNTHETIC_ROOM_HANDOFF_ANCHOR";
  await desktop.turn(threadId,anchor);
  let review=await desktop.control("coordinator-review",{taskId,threadId});
  assert.equal(review.review.thread.threadId,threadId);
  await assert.rejects(desktop.control("coordinator-confirm",{taskId,reviewId:review.reviewId,disclose:false}));
  await desktop.control("coordinator-release",{taskId});
  assert.equal((await hub.ok("GET",`/api/local-node/tasks/${taskId}/codex`)).state,"available");
  review=await desktop.control("coordinator-review",{taskId,threadId});
  await desktop.control("coordinator-confirm",{taskId,reviewId:review.reviewId,disclose:true});
  await assert.rejects(desktop.rpc("turn/start",{threadId,input:[{type:"text",text:"Blocked source write"}]}),/return control/);
  fixture.setResponder((input,index)=>{
    assert.ok(JSON.stringify(input.input).includes(anchor));
    if(index===2)return {id:"tool_room",type:"function_call",name:"desktop_fixture_tool",arguments:"{}",call_id:"room_tool",status:"completed"};
    if(index===3){assert.equal(input.input.find(item=>item.type==="function_call_output" && item.call_id==="room_tool")?.output,"ORIGINAL_CALLBACK_OK");return "Room continuation used the original context and tool.";}
    assert.equal(index,4);return "Returned original conversation.";
  });
  const sent=await hub.ok("POST",`/api/rooms/${hub.room.roomId}/messages`,{taskId,content:"Continue our original work and use its tool",mentionAgentId:hub.agent.agentId});
  await until(()=>hub.messages.some(m=>m.type==="run.requested"));
  const request=hub.messages.find(m=>m.type==="run.requested").payload;
  const events=await desktop.control("runtime",{run:request});
  assert.ok(events.some(event=>event.type==="run.reply"),JSON.stringify(events));
  assert.equal(events.at(-1).payload.status,"completed",JSON.stringify(events));
  for(const event of events)hub.socket.send(JSON.stringify(event));
  try { await until(()=>hub.database.prepare("SELECT state FROM runs WHERE run_id = ?").get(sent.runs[0].runId)?.state==="completed"); }
  catch { assert.fail(JSON.stringify({state:hub.database.prepare("SELECT state,last_sequence FROM runs WHERE run_id = ?").get(sent.runs[0].runId),events,errors:hub.messages.filter(m=>m.type!=="run.requested")})); }
  assert.ok(!JSON.stringify(events).includes(threadId));assert.ok(!JSON.stringify(events).includes(anchor));
  assert.equal(hub.database.prepare("SELECT content FROM messages WHERE sender_type = 'agent' AND task_id = ?").get(taskId)?.content,"Room continuation used the original context and tool.");
  await desktop.control("runtime",{run:request});assert.equal(fixture.calls.length,3,"durable inbox replay does not execute twice");
  const restarted=await desktop.control("coordinator-restart",{taskId});assert.equal(restarted.adoption.state,"paused");
  const rereview=await desktop.control("coordinator-review",{taskId,threadId});
  await desktop.control("coordinator-confirm",{taskId,reviewId:rereview.reviewId,disclose:true});
  await desktop.control("coordinator-release",{taskId});
  await desktop.control("coordinator-release",{taskId});
  assert.equal((await hub.ok("GET",`/api/local-node/tasks/${taskId}/codex`)).state,"released");
  await desktop.turn(threadId,"Continue in Codex after Room return");
  const final=await desktop.rpc("thread/read",{threadId,includeTurns:true});assert.equal(final.thread.id,threadId);assert.equal(final.thread.turns.length,3);
  fixture.checkProvider();
});
