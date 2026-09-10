import assert from "node:assert/strict";
import test, {type TestContext} from "node:test";
import React, {StrictMode} from "react";
import {JSDOM} from "jsdom";
import {LocalNodeNetwork} from "../src/features/local-node/LocalNodeNetwork.js";

async function fixture(t: TestContext) {
  const dom = new JSDOM('<!doctype html><html><body><main class="product-shell"></main></body></html>', {url: "http://127.0.0.1:48123"});
  const previous = Object.getOwnPropertyDescriptors(globalThis), originalFetch = globalThis.fetch;
  for (const key of ["window", "document", "HTMLElement", "navigator"]) Object.defineProperty(globalThis, key, {configurable: true, value: key === "window" ? dom.window : dom.window[key as keyof typeof dom.window]});
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {configurable: true, value: true, writable: true});
  const library = await import("@testing-library/react");
  t.after(async () => {
    library.cleanup(); await new Promise(resolve => setTimeout(resolve, 20)); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ["window", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const state = {revisionDigest: "revision-one", running: null as any, saved: null as any, pending: null as any};
  const calls: {url: string; body: any}[] = []; let save = async (input: any) => Response.json({status: "pending", reviewDigest: input.reviewDigest});
  const viewFor = (input: any) => ({revisionDigest: input.revisionDigest, reviewDigest: "review-one", enabled: input.selection.enabled, origin: input.selection.origin,
    listenHost: input.selection.listenHost, certificateFingerprint: input.selection.enabled ? "AA:BB:CC" : null, certificateExpiresAt: input.selection.enabled ? "2099-01-01T00:00:00Z" : null});
  let read = async () => Response.json(state);
  globalThis.fetch = async (path, options) => {
    const url = String(path), body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({url, body}); assert.equal(new Headers(options?.headers).get("authorization"), "Bearer local-fixture");
    if (url.endsWith("/review")) return Response.json(viewFor(body));
    if (url.endsWith("/save")) return save(body);
    if (url.endsWith("/discard")) { state.pending = null; state.revisionDigest = "revision-discarded"; return Response.json({status: "discarded"}); }
    assert.equal(url, "/api/local-node/network"); return read();
  };
  const props = {session: {userId: "user_network001", displayName: "Owner", token: "local-fixture"}, locale: "zh-CN" as const};
  const view = library.render(<StrictMode><LocalNodeNetwork {...props} /></StrictMode>);
  const screen = library.within(dom.window.document.body);
  return {...library, dom, view, screen, state, calls, props, viewFor, save: (value: typeof save) => {save = value;}, read: (value: typeof read) => {read = value;},
    async open() { library.fireEvent.click(screen.getByRole("button", {name: "网络设置"})); await library.waitFor(() => assert.equal((screen.getByRole("button", {name: "验证并审阅配置"}) as HTMLButtonElement).closest("fieldset")!.disabled, false)); },
    async prepare(enabled = true) {
      library.fireEvent.change(screen.getByLabelText("HTTPS 地址"), {target: {value: "https://localhost:9443"}});
      if (enabled) {
        library.fireEvent.click(screen.getByLabelText("启用外部 HTTPS 接入"));
        for (const [label, name, content] of [["PEM 证书链（最多 64 KB）", "chain.pem", "CERTIFICATE"], ["未加密 PEM 私钥（最多 16 KB）", "key.pem", "PRIVATE SECRET MATERIAL"]]) {
          const file = new dom.window.File([content!], name!); Object.defineProperty(file, "text", {value: async () => content});
          library.fireEvent.change(screen.getByLabelText(label!), {target: {files: [file]}});
        }
      }
      library.fireEvent.click(screen.getByRole("button", {name: "验证并审阅配置"}));
      await screen.findByRole("button", {name: "保存，重启后生效"});
    }};
}

test("network controls load only when opened, review inert scope and retain exact ambiguous saves", async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0); await f.open(); await f.prepare();
  assert.ok(f.calls.every(value => !value.url.endsWith("/save"))); assert.equal(f.dom.window.document.body.textContent!.includes("PRIVATE SECRET MATERIAL"), false);
  assert.ok(f.screen.getByText("AA:BB:CC"));
  let saves = 0;
  f.save(async input => {
    f.state.pending = f.viewFor(input); f.state.revisionDigest = "revision-two";
    if (++saves === 1) throw new Error("lost committed response");
    return Response.json({status: "pending", reviewDigest: input.reviewDigest});
  });
  f.fireEvent.click(f.screen.getByRole("button", {name: "保存，重启后生效"}));
  await f.screen.findByText(/保存结果尚未确认/); await f.screen.findByRole("heading", {name: "等待重启生效"});
  const retry = f.screen.getByRole("button", {name: "重试原保存操作"});
  f.fireEvent.click(retry); f.fireEvent.click(retry);
  await f.screen.findByText(/已保存为待生效配置/);
  const inputs = f.calls.filter(value => value.url.endsWith("/save")).map(value => value.body);
  assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(f.dom.window.localStorage.length + f.dom.window.sessionStorage.length, 0);
});

test("changed network state disables an unsubmitted review and discard requires a separate current decision", async t => {
  const f = await fixture(t); await f.open(); await f.prepare(false);
  f.state.revisionDigest = "changed"; f.state.pending = f.viewFor({revisionDigest: "changed", selection: {enabled: false, origin: "https://localhost:9443", listenHost: "127.0.0.1"}});
  f.fireEvent.click(f.screen.getByRole("button", {name: "刷新当前状态"}));
  await f.waitFor(() => assert.equal((f.screen.getByRole("button", {name: "保存，重启后生效"}) as HTMLButtonElement).disabled, true));
  f.fireEvent.click(f.screen.getByRole("button", {name: "返回重新选择"}));
  f.fireEvent.click(f.screen.getByRole("button", {name: "取消待生效配置…"}));
  assert.equal(f.calls.some(value => value.url.endsWith("/discard")), false);
  f.fireEvent.click(f.screen.getByRole("button", {name: "确认取消待生效配置"})); await f.screen.findByText("已取消待生效配置。");
  assert.deepEqual(f.calls.find(value => value.url.endsWith("/discard"))!.body, {revisionDigest: "changed"});
});

test("closing during a file read clears the form and never sends private material after retirement", async t => {
  const f = await fixture(t); await f.open();
  f.fireEvent.change(f.screen.getByLabelText("HTTPS 地址"), {target: {value: "https://localhost:9443"}});
  f.fireEvent.click(f.screen.getByLabelText("启用外部 HTTPS 接入"));
  let resolve!: (value: string) => void;
  for (const label of ["PEM 证书链（最多 64 KB）", "未加密 PEM 私钥（最多 16 KB）"]) {
    const file = new f.dom.window.File(["pending"], "input.pem"); Object.defineProperty(file, "text", {value: label.startsWith("PEM") ? () => new Promise<string>(done => {resolve = done;}) : async () => "private input"});
    f.fireEvent.change(f.screen.getByLabelText(label), {target: {files: [file]}});
  }
  f.fireEvent.click(f.screen.getByRole("button", {name: "验证并审阅配置"})); f.fireEvent.click(f.screen.getByRole("button", {name: "关闭"}));
  await f.act(async () => resolve("certificate input"));
  assert.equal(f.calls.some(value => value.url.endsWith("/review")), false); assert.equal(f.screen.queryByRole("dialog"), null);
  await f.open(); assert.equal((f.screen.getByLabelText("HTTPS 地址") as HTMLInputElement).value, "");
});

test("Owner expiry and replaced sessions retire network secrets and late responses", async t => {
  const f = await fixture(t); await f.open(); await f.prepare();
  f.read(async () => Response.json({error: {message: "expired"}}, {status: 401}));
  f.fireEvent.click(f.screen.getByRole("button", {name: "刷新当前状态"})); await f.waitFor(() => assert.equal(Boolean(f.screen.queryByRole("dialog")), false));
  assert.equal(f.dom.window.document.body.textContent!.includes("AA:BB:CC"), false);
  f.read(async () => Response.json(f.state)); await f.open(); await f.prepare();
  let resolve!: (response: Response) => void; f.save(async () => new Promise<Response>(done => {resolve = done;}));
  f.fireEvent.click(f.screen.getByRole("button", {name: "保存，重启后生效"}));
  f.view.rerender(<LocalNodeNetwork {...f.props} session={{...f.props.session, token: "other-session"}} />);
  await f.act(async () => resolve(Response.json({status: "pending", reviewDigest: "review-one"})));
  assert.equal(f.screen.queryByRole("dialog"), null); assert.equal(f.screen.queryByText(/已保存为待生效配置/), null);
});

test("network review inherits keyboard containment and Escape restores its trigger without a save", async t => {
  const f = await fixture(t); const trigger = f.screen.getByRole("button", {name: "网络设置"}); trigger.focus(); await f.open();
  f.screen.getByRole("button", {name: "关闭"}).focus(); f.fireEvent.keyDown(f.dom.window.document, {key: "Tab", shiftKey: true});
  assert.equal(f.dom.window.document.activeElement, f.screen.getByRole("button", {name: "刷新当前状态"}));
  f.fireEvent.keyDown(f.dom.window.document, {key: "Tab"}); assert.equal(f.dom.window.document.activeElement, f.screen.getByRole("button", {name: "关闭"}));
  f.fireEvent.keyDown(f.dom.window.document, {key: "Escape"}); assert.equal(f.screen.queryByRole("dialog"), null);
  assert.equal(f.dom.window.document.activeElement, trigger); assert.equal(f.calls.some(value => value.body), false);
});
