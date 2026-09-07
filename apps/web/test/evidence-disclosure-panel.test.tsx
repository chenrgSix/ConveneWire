import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { EvidenceDisclosurePanel } from "../src/features/work/EvidenceDisclosurePanel.js";

const props = {taskId:"task_disclosure0001",roomId:"room_disclosure0001",token:"owner-session",locale:"en" as const};
const intent={version:1,operationId:"op_disclosure0001",deviceId:"device_disclosure0001",agentId:"agent_disclosure0001",runId:"run_disclosure0001",taskId:props.taskId,roomId:props.roomId,definitionRevision:1,criteriaRevision:1,source:{evidenceRef:"evidence_disclosure0001",revision:"a".repeat(40),contentSha256:"b".repeat(64),start:0,end:100},contentSha256:"c".repeat(64),contentBytes:30,audience:"room_members",expiresAt:"2026-09-07T10:00:00Z"};
test("owner inspects metadata and explicitly confirms; raw bundle and changed Task cannot be submitted",async()=>{
 const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://localhost/"});
 for(const key of ["document","HTMLElement","window","navigator"] as const)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
 Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true,writable:true});
 const prior=globalThis.fetch;const posts:Array<{url:string;body:unknown}>=[];
 globalThis.fetch=async(input,init)=>{
   if(init?.method==="POST")posts.push({url:String(input),body:JSON.parse(init.body as string)});
   return new Response(JSON.stringify(init?.method==="POST"?{grantId:"disclosure_test0001"}:[]),{status:200});
 };
 const {cleanup,render,fireEvent,waitFor}=await import("@testing-library/react");
 try{
  const view=render(<EvidenceDisclosurePanel {...props}/>);
  fireEvent.click(view.getByRole("button",{name:"Private evidence disclosure"}));
  const draft=view.getByLabelText("Disclosure request");
  for(const invalid of [{intent,content:"PRIVATE RAW SOURCE"},{...intent,taskId:"task_other0001"},{...intent,source:{...intent.source,body:"PRIVATE RAW SOURCE"}}]){
   fireEvent.change(draft,{target:{value:JSON.stringify(invalid)}});fireEvent.click(view.getByRole("button",{name:"Inspect request"}));
   assert.ok(view.getByRole("alert"));assert.equal(view.queryByRole("button",{name:"Approve disclosure"}),null);
  }
  fireEvent.change(draft,{target:{value:JSON.stringify(intent)}});fireEvent.click(view.getByRole("button",{name:"Inspect request"}));
  assert.ok((view.getByRole("button",{name:"Approve disclosure"}) as HTMLButtonElement).disabled);
  assert.ok(view.getByText(intent.contentSha256));
  fireEvent.click(view.getByRole("checkbox"));fireEvent.click(view.getByRole("button",{name:"Approve disclosure"}));
  await waitFor(()=>assert.equal(posts.length,1));assert.deepEqual(posts[0],{url:"/api/evidence-disclosures",body:intent});
  await waitFor(()=>assert.equal((draft as HTMLTextAreaElement).value,""));
 }finally{cleanup();globalThis.fetch=prior;dom.window.close();}
});
