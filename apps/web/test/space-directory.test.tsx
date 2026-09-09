import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { SpaceDirectory, remoteSpaceURL } from "../src/features/local-node/SpaceDirectory.js";
import { advanceWebSessionGeneration } from "../src/api-client.js";
import type { AuthoritySpace } from "@convene-wire/contracts/authority";
const local="http://127.0.0.1:48123";
const remote: AuthoritySpace={authorityNodeId:"node_remote_fixture001",teamId:"team_same_fixture001",label:"Remote Space",kind:"remote",browserOrigin:"https://remote.example"};
test("remote Space URL is origin-bound and contains only the selected Team",()=>{
  assert.equal(remoteSpaceURL(remote,local),"https://remote.example/?team=team_same_fixture001");
  for (const browserOrigin of [local,"javascript:alert(1)","http://remote.example","https://user:secret@remote.example","https://remote.example/path","https://remote.example?token=secret","https://remote.example/#fragment","https://remote.example:443","https://REMOTE.example"]) {
    assert.equal(remoteSpaceURL({...remote,browserOrigin},local),null,browserOrigin);
  }
  assert.equal(remoteSpaceURL({...remote,kind:"hosted"},local),null);
});
test("Space links isolate login/navigation and suppress responses from an earlier session",async t=>{
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:local});
  const previous=Object.getOwnPropertyDescriptors(globalThis),originalFetch=globalThis.fetch;
  for(const key of ["window","document","HTMLElement","navigator"])Object.defineProperty(globalThis,key,{configurable:true,value:key==="window"?dom.window:dom.window[key as keyof typeof dom.window]});
  Object.defineProperty(globalThis,"IS_REACT_ACT_ENVIRONMENT",{configurable:true,value:true,writable:true});
  const {render,within,waitFor,act,cleanup}=await import("@testing-library/react");
  t.after(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,20));globalThis.fetch=originalFetch;dom.window.close();for(const key of ["window","document","HTMLElement","navigator","IS_REACT_ACT_ENVIRONMENT"]){if(previous[key])Object.defineProperty(globalThis,key,previous[key]);else Reflect.deleteProperty(globalThis,key);}});
  const pending:((response:Response)=>void)[]=[];const calls:{url:string;init:RequestInit|undefined}[]=[];
  globalThis.fetch=(input,init)=>{calls.push({url:String(input),init});return new Promise(resolve=>pending.push(resolve));};
  const props={session:{userId:"user_fixture001",displayName:"Local Owner",token:"local-owner-secret"},locale:"zh-CN" as const};
  const view=render(<SpaceDirectory {...props}/>);const screen=within(view.container);
  await waitFor(()=>assert.equal(pending.length,1));
  await act(async()=>pending[0](Response.json({schemaVersion:1,spaces:[remote]})));
  const link=await screen.findByRole("link",{name:/Remote Space/u}) as HTMLAnchorElement;
  assert.equal(link.href,"https://remote.example/?team=team_same_fixture001");assert.equal(link.target,"_blank");assert.equal(link.rel,"noopener noreferrer");assert.equal(link.getAttribute("referrerpolicy"),"no-referrer");
  assert.ok(calls.every(call=>call.url==="/api/local-node/spaces"));assert.equal(calls[0].init?.credentials,"same-origin");
  assert.ok(!link.href.includes(props.session.token));assert.equal(dom.window.location.href,`${local}/`);
  advanceWebSessionGeneration();view.rerender(<SpaceDirectory {...props} session={{...props.session,token:"second-owner-secret"}}/>);
  assert.equal(screen.queryByRole("link"),null);
  await waitFor(()=>assert.equal(pending.length,2));
  advanceWebSessionGeneration();view.rerender(<SpaceDirectory {...props} session={{...props.session,token:"third-owner-secret"}}/>);
  await waitFor(()=>assert.equal(pending.length,3));
  await act(async()=>pending[2](Response.json({schemaVersion:1,spaces:[{...remote,label:"Current Space"}]})));
  await screen.findByRole("link",{name:/Current Space/u});
  await act(async()=>pending[1](Response.json({schemaVersion:1,spaces:[{...remote,label:"Stale Space"}]})));
  assert.equal(screen.queryByRole("link",{name:/Stale Space/u}),null);
  assert.ok(screen.getByRole("link",{name:/Current Space/u}));
});
