import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {JSDOM} from "jsdom";
import {DesktopCodexHandoff} from "../src/features/local-node/DesktopCodexHandoff.js";

test("Task handoff opens native review explicitly and never asks the browser for a source conversation",async t=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:"http://127.0.0.1:48123"});
  const descriptors=Object.getOwnPropertyDescriptors(globalThis),fetch=globalThis.fetch;
  for(const key of ["window","document","HTMLElement","navigator"])Object.defineProperty(globalThis,key,{configurable:true,value:key==="window"?dom.window:dom.window[key as keyof typeof dom.window]});
  Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true,writable:true});
  const {render,within,fireEvent,waitFor,cleanup}=await import("@testing-library/react");
  t.after(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,20));globalThis.fetch=fetch;dom.window.close();for(const key of ["window","document","HTMLElement","navigator","IS_REACT_ACT_ENVIRONMENT"]){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else Reflect.deleteProperty(globalThis,key);}});
  const calls: {url:string;method:string}[]=[];
  globalThis.fetch=async(input,init)=>{calls.push({url:String(input),method:init?.method??"GET"});return Response.json(String(input).endsWith("/open")?{requested:true}:{taskId:"task_fixture_0001",state:"available"});};
  const view=render(<DesktopCodexHandoff taskId="task_fixture_0001" token="fixture" locale="zh-CN"/>),screen=within(view.container);
  await screen.findByText("连接已有 Codex 会话");assert.ok(calls.every(call=>call.method==="GET"));
  fireEvent.click(screen.getByRole("button",{name:"在本机确认"}));await waitFor(()=>assert.equal(calls.filter(call=>call.method==="POST").length,1));
  assert.equal(calls.at(-1)?.url,"/api/local-node/tasks/task_fixture_0001/codex/open");
  assert.equal(view.container.querySelectorAll("input").length,0);
  assert.ok(!calls.some(call=>call.url.includes("thread")||call.url.includes("token")));
});
