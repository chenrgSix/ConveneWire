import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";
import {createDesktopHandoffController} from "./static/desktop-handoff.mjs";
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
test("native picker keeps source metadata local, escapes it and requires explicit disclosure", async t => {
  const dom = new JSDOM('<main></main>'); t.after(()=>dom.window.close());
  const root = dom.window.document.querySelector("main");
  const thread = {threadId:"original-thread",title:'<img src=x onerror="alert(1)">',workspace:"/private/project",model:"model-one",provider:"provider",tools:["original_tool"]};
  const state = {taskId:"task_local_0001",scope:{taskTitle:"Continue",roomName:"Room",agentName:"Local Agent",audience:["Owner"]},connected:true,threads:[thread]};
  const calls = [];
  const controller = createDesktopHandoffController({root,request:async (url,options) => {
    assert.equal(url,"/api/desktop-codex");
    if(options){const body=JSON.parse(options.body);calls.push(body);
      if(body.action==="review")state.adoption={id:"adoption",reviewId:"review-one",review:{thread},sandbox:"read-only",state:"reviewed"};
      if(body.action==="confirm")state.adoption.state="attached";
      if(body.action==="release")state.adoption.state="released";
    }
    return structuredClone(state);
  }});t.after(()=>controller.dispose());controller.setActive(true);await settle();
  assert.equal(root.querySelector("img"),null);assert.ok(root.textContent.includes(thread.title));
  [...root.querySelectorAll("button")].find(b=>b.textContent==="查看并确认").click();await settle();
  let confirm=[...root.querySelectorAll("button")].find(b=>b.textContent==="确认并交给房间");assert.equal(confirm.disabled,true);
  const check=root.querySelector('input[type="checkbox"]');check.checked=true;check.dispatchEvent(new dom.window.Event("change"));assert.equal(confirm.disabled,false);confirm.click();await settle();
  assert.deepEqual(calls[1],{action:"confirm",taskId:state.taskId,reviewId:"review-one",disclose:true});
  assert.ok(root.textContent.includes("房间已接管"));assert.equal(JSON.stringify(calls[1]).includes("original-thread"),false);
  [...root.querySelectorAll("button")].find(b=>b.textContent==="交回 Codex").click();await settle();assert.ok(root.textContent.includes("已交回 Codex"));
});
test("retired native view ignores delayed private metadata", async t => {
  const dom=new JSDOM('<main></main>');t.after(()=>dom.window.close());let finish;
  const root=dom.window.document.querySelector("main");const controller=createDesktopHandoffController({root,request:()=>new Promise(resolve=>{finish=resolve;})});
  controller.setActive(true);controller.dispose();finish({connected:true,threads:[{title:"PRIVATE"}]});await settle();assert.ok(!root.textContent.includes("PRIVATE"));
});
