import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import React, { StrictMode } from "react";
import { JSDOM } from "jsdom";
import { LocalNodeNetwork } from "../src/features/local-node/LocalNodeNetwork.js";
import type { RelayNetworkState } from "../src/features/local-node/RelayNetworkDialog.js";
import { advanceWebSessionGeneration } from "../src/api-client.js";

async function fixture(t: TestContext) {
  const dom = new JSDOM('<!doctype html><html><body><main class="product-shell"></main></body></html>', { url: "http://127.0.0.1:48123" });
  const previous = Object.getOwnPropertyDescriptors(globalThis), originalFetch = globalThis.fetch;
  for (const key of ["window", "document", "HTMLElement", "navigator"]) Object.defineProperty(globalThis, key, { configurable: true,
    value: key === "window" ? dom.window : dom.window[key as keyof typeof dom.window] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  advanceWebSessionGeneration();
  const library = await import("@testing-library/react");
  t.after(async () => {
    library.cleanup(); await new Promise(resolve => setTimeout(resolve, 20)); globalThis.fetch = originalFetch; dom.window.close();
    for (const key of ["window", "document", "HTMLElement", "navigator", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]); else Reflect.deleteProperty(globalThis, key);
    }
  });
  const origin = "https://n1234567890abcdef1234567890abcdef12345678.nodes.fixture.test";
  const provider = { id: "fixture", displayName: "测试接入服务", relayOrigin: "https://relay.fixture.test", nodeDomain: "nodes.fixture.test",
    acmeDirectoryUrl: "https://ca.fixture.test/directory", termsUrl: "https://relay.fixture.test/terms" };
  const state: RelayNetworkState = { revisionDigest: "relay-revision-one", provider, saved: { enabled: false, origin: null },
    running: { state: "disabled", origin: null, errorCode: null, certificateExpiresAt: null }, pending: null };
  const calls: { url: string; method: string; body: any }[] = [];
  let read = async (_signal?: AbortSignal) => Response.json(state);
  let review = async (input: any) => Response.json({ revisionDigest: input.revisionDigest, enabled: input.enabled, origin, provider: state.provider, reviewDigest: "review-one" });
  let save = async (input: any) => {
    state.pending = { enabled: input.enabled, origin, reviewDigest: input.reviewDigest }; state.revisionDigest = "relay-revision-two";
    return Response.json({ status: "pending", reviewDigest: input.reviewDigest });
  };
  globalThis.fetch = async (path, options) => {
    const url = String(path), method = options?.method ?? "GET", body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ url, method, body });
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer local-fixture");
    assert.equal(options?.credentials, "same-origin");
    assert.ok(url.startsWith("/api/local-node/"), "provider and CA requests belong to the native service, never the browser");
    if (url === "/api/local-node/network") return Response.json({ revisionDigest: "direct-one", saved: null, pending: null, running: null });
    if (url.endsWith("/review")) return review(body);
    if (url.endsWith("/save")) return save(body);
    if (url.endsWith("/discard")) { state.pending = null; state.revisionDigest = "relay-discarded"; return Response.json({ status: "discarded" }); }
    assert.equal(url, "/api/local-node/relay"); return read(options?.signal ?? undefined);
  };
  const props = { session: { userId: "user_relayfixture01", displayName: "Owner", token: "local-fixture" }, locale: "zh-CN" as const };
  const view = library.render(<StrictMode><LocalNodeNetwork {...props} /></StrictMode>), screen = library.within(dom.window.document.body);
  const consent = () => screen.getByRole("checkbox", { name: "我同意此服务及自动申请、续期 HTTPS 证书的条款" }) as HTMLInputElement;
  return { ...library, dom, view, screen, props, calls, state, provider, origin, consent,
    read: (value: typeof read) => { read = value; }, review: (value: typeof review) => { review = value; }, save: (value: typeof save) => { save = value; },
    async open() {
      library.fireEvent.click(screen.getByRole("button", { name: "网络设置" }));
      await screen.findByText("便捷接入已停用");
    },
    async prepare() {
      library.fireEvent.click(consent()); library.fireEvent.click(screen.getByRole("button", { name: "启用便捷接入…" }));
      await screen.findByRole("button", { name: "保存，重启后生效" });
    },
    async refresh() { await library.act(async () => { library.fireEvent.click(screen.getByRole("button", { name: "刷新当前状态" })); }); }
  };
}

test("convenient access needs explicit provider terms and review, then retries an ambiguous save exactly", async t => {
  const f = await fixture(t); assert.equal(f.calls.length, 0); await f.open();
  assert.equal(f.screen.queryByRole("textbox"), null); assert.equal(f.consent().checked, false);
  assert.equal((f.screen.getByRole("button", { name: "启用便捷接入…" }) as HTMLButtonElement).disabled, true);
  assert.equal(f.screen.getByRole("link", { name: "查看服务与证书申请条款" }).getAttribute("href"), f.provider.termsUrl);
  await f.prepare();
  assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
  assert.deepEqual(f.calls.find(call => call.url.endsWith("/review"))!.body, { revisionDigest: "relay-revision-one", enabled: true, termsAccepted: true });
  assert.ok(f.screen.getByText(f.provider.acmeDirectoryUrl)); assert.ok(f.screen.getByText(f.origin));
  let attempts = 0;
  f.save(async input => {
    f.state.pending = { enabled: input.enabled, origin: f.origin, reviewDigest: input.reviewDigest }; f.state.revisionDigest = "relay-revision-two";
    if (++attempts === 1) throw new Error("response lost after commit");
    return Response.json({ status: "pending", reviewDigest: input.reviewDigest });
  });
  f.fireEvent.click(f.screen.getByRole("button", { name: "保存，重启后生效" }));
  await f.screen.findByText(/保存结果尚未确认/); await f.screen.findByRole("heading", { name: "等待重启生效" });
  const retry = f.screen.getByRole("button", { name: "重试原保存操作" }); f.fireEvent.click(retry); f.fireEvent.click(retry);
  await f.screen.findByText(/已保存。退出并重新打开/);
  const saves = f.calls.filter(call => call.url.endsWith("/save")); assert.equal(saves.length, 2); assert.deepEqual(saves[0], saves[1]);
  assert.equal(f.dom.window.localStorage.length + f.dom.window.sessionStorage.length, 0);
  assert.equal(f.calls.some(call => /restart|claim|invitations/.test(call.url)), false);
});

test("missing service profile remains explicit and manual HTTPS is still reachable without creating a service", async t => {
  const f = await fixture(t); f.state.provider = null; await f.open();
  await f.screen.findByText(/此版本尚未配置接入服务/);
  assert.equal(f.screen.queryByRole("button", { name: "启用便捷接入…" }), null); assert.equal(f.screen.queryByRole("checkbox"), null);
  f.fireEvent.click(f.screen.getByRole("button", { name: "高级：手动 HTTPS 接入" }));
  await f.screen.findByRole("heading", { name: "手动 HTTPS 接入" });
  await f.waitFor(() => assert.equal((f.screen.getByRole("button", { name: "验证并审阅配置" }) as HTMLButtonElement).closest("fieldset")!.disabled, false));
  assert.equal(f.screen.getAllByRole("dialog").length, 1); assert.equal(f.calls.some(call => call.method !== "GET"), false);
  f.fireEvent.click(f.screen.getByRole("button", { name: "返回便捷接入" })); await f.screen.findByText(/此版本尚未配置接入服务/);
});

test("connection and unexpired certificate are both required for the ready message; disable keeps the fixed address", async t => {
  const f = await fixture(t); await f.open(); f.state.saved = { enabled: true, origin: f.origin }; f.state.running.origin = f.origin;
  for (const [status, label] of [["connecting", "正在连接接入服务…"], ["issuing_certificate", "正在申请 HTTPS 证书…"],
    ["retrying", "连接中断，正在重试…"], ["unavailable", "便捷接入暂不可用"]] as const) {
    f.state.running.state = status; await f.refresh(); assert.ok(f.screen.getByText(label));
    assert.equal(f.screen.queryByText("已连接，可以邀请其他节点"), null);
  }
  f.state.running.state = "ready"; f.state.running.certificateExpiresAt = "2000-01-01T00:00:00Z"; await f.refresh();
  assert.ok(f.screen.getByText("证书暂不可用，等待恢复连接"));
  f.state.running.certificateExpiresAt = "2099-01-01T00:00:00Z"; await f.refresh(); assert.ok(f.screen.getByText("已连接，可以邀请其他节点"));
  f.fireEvent.click(f.screen.getByRole("button", { name: "停用便捷接入…" })); await f.screen.findByRole("heading", { name: "确认停用便捷接入" });
  assert.deepEqual(f.calls.find(call => call.url.endsWith("/review"))!.body, { revisionDigest: "relay-revision-one", enabled: false, termsAccepted: false });
  assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
  f.fireEvent.click(f.screen.getByRole("button", { name: "保存，重启后生效" })); await f.screen.findByText(/已保存。退出并重新打开/);
  assert.equal(f.state.pending?.origin, f.origin); assert.equal(f.state.pending?.enabled, false);
});

test("provider or revision changes invalidate an unsubmitted decision and terms cannot transfer to a new service", async t => {
  const f = await fixture(t); await f.open(); await f.prepare();
  f.state.provider = { ...f.provider, displayName: "更新后的服务", acmeDirectoryUrl: "https://newca.fixture.test/directory" };
  f.state.revisionDigest = "changed"; await f.refresh();
  assert.equal((f.screen.getByRole("button", { name: "保存，重启后生效" }) as HTMLButtonElement).disabled, true);
  f.fireEvent.click(f.screen.getByRole("button", { name: "返回", exact: true }));
  assert.equal(f.consent().checked, false);
  f.review(async input => Response.json({ revisionDigest: input.revisionDigest, enabled: true, origin: f.origin, provider: f.provider, reviewDigest: "different-provider" }));
  f.fireEvent.click(f.consent()); f.fireEvent.click(f.screen.getByRole("button", { name: "启用便捷接入…" }));
  await f.screen.findByText(/返回的服务或地址与本次选择不一致/);
  assert.equal(f.screen.queryByRole("button", { name: "保存，重启后生效" }), null);
  assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
});

test("existing address conflicts remain actionable and do not silently change the fixed address", async t => {
  const f = await fixture(t); await f.open();
  f.review(async () => Response.json({ error: { message: "已有 HTTPS 地址不能直接切换。请停机处理原有邀请和成员关系。" } }, { status: 409 }));
  f.fireEvent.click(f.consent()); f.fireEvent.click(f.screen.getByRole("button", { name: "启用便捷接入…" }));
  await f.screen.findByText(/已有 HTTPS 地址不能直接切换/); assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
  assert.ok(f.screen.getByRole("button", { name: "高级：手动 HTTPS 接入" }));
});

test("unavailable status cannot authorize a fresh save and unsafe service terms cannot become a link or consent", async t => {
  const f = await fixture(t); await f.open(); await f.prepare();
  f.read(async () => { throw new Error("status unavailable"); }); await f.refresh();
  assert.equal((f.screen.getByRole("button", { name: "保存，重启后生效" }) as HTMLButtonElement).disabled, true);
  f.fireEvent.click(f.screen.getByRole("button", { name: "返回", exact: true }));
  f.state.provider = { ...f.provider, termsUrl: "javascript:alert(1)" };
  f.read(async () => Response.json(f.state)); await f.refresh();
  assert.ok(f.screen.getByText("服务配置无效，请联系提供方更新。"));
  assert.equal(f.screen.queryByRole("link", { name: "查看服务与证书申请条款" }), null);
  assert.equal(f.consent().disabled, true); assert.equal(f.consent().checked, false);
  assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
});

test("pending cancellation is a separate current decision and only discards the displayed revision", async t => {
  const f = await fixture(t); f.state.pending = { enabled: true, origin: f.origin, reviewDigest: "prior-review" }; await f.open();
  f.fireEvent.click(f.screen.getByRole("button", { name: "取消待生效配置…" }));
  assert.equal(f.calls.some(call => call.url.endsWith("/discard")), false);
  f.state.revisionDigest = "changed"; await f.refresh();
  assert.equal((f.screen.getByRole("button", { name: "确认取消待生效配置" }) as HTMLButtonElement).disabled, true);
  f.fireEvent.click(f.screen.getByRole("button", { name: "返回", exact: true })); f.fireEvent.click(f.screen.getByRole("button", { name: "取消待生效配置…" }));
  f.fireEvent.click(f.screen.getByRole("button", { name: "确认取消待生效配置" })); await f.screen.findByText("已取消便捷接入的待生效配置。");
  assert.deepEqual(f.calls.find(call => call.url.endsWith("/discard"))!.body, { revisionDigest: "changed" });
});

test("retired views ignore late review and save responses, and expired Owner sessions close the dialog", async t => {
  const f = await fixture(t); await f.open();
  let finishReview!: (response: Response) => void;
  f.review(async () => new Promise<Response>(resolve => { finishReview = resolve; }));
  f.fireEvent.click(f.consent()); f.fireEvent.click(f.screen.getByRole("button", { name: "启用便捷接入…" }));
  f.fireEvent.keyDown(f.dom.window.document, { key: "Escape" });
  await f.act(async () => finishReview(Response.json({ revisionDigest: "relay-revision-one", enabled: true, origin: f.origin, provider: f.provider, reviewDigest: "late" })));
  assert.equal(f.screen.queryByRole("dialog"), null); assert.equal(f.calls.some(call => call.url.endsWith("/save")), false);
  f.review(async input => Response.json({ revisionDigest: input.revisionDigest, enabled: true, origin: f.origin, provider: f.provider, reviewDigest: "review-one" }));
  await f.open(); await f.prepare();
  let finishSave!: (response: Response) => void; f.save(async () => new Promise<Response>(resolve => { finishSave = resolve; }));
  f.fireEvent.click(f.screen.getByRole("button", { name: "保存，重启后生效" }));
  f.view.rerender(<LocalNodeNetwork {...f.props} session={{ ...f.props.session, token: "new-session" }} />);
  await f.act(async () => finishSave(Response.json({ status: "pending", reviewDigest: "review-one" })));
  assert.equal(f.screen.queryByRole("dialog"), null); assert.equal(f.screen.queryByText(/已保存。退出并重新打开/), null);
  f.view.rerender(<LocalNodeNetwork {...f.props} />); await f.open();
  f.read(async () => Response.json({ error: { message: "expired" } }, { status: 401 })); await f.refresh();
  await f.waitFor(() => assert.equal(Boolean(f.screen.queryByRole("dialog")), false));
});

test("keyboard focus stays in the settings dialog and Escape restores its trigger without consent or writes", async t => {
  const f = await fixture(t), trigger = f.screen.getByRole("button", { name: "网络设置" }); trigger.focus(); await f.open();
  f.screen.getByRole("button", { name: "关闭" }).focus(); f.fireEvent.keyDown(f.dom.window.document, { key: "Tab", shiftKey: true });
  assert.equal(f.dom.window.document.activeElement, f.screen.getByRole("button", { name: "高级：手动 HTTPS 接入" }));
  f.fireEvent.keyDown(f.dom.window.document, { key: "Tab" }); assert.equal(f.dom.window.document.activeElement, f.screen.getByRole("button", { name: "关闭" }));
  f.fireEvent.keyDown(f.dom.window.document, { key: "Escape" }); assert.equal(f.screen.queryByRole("dialog"), null);
  assert.equal(f.dom.window.document.activeElement, trigger); assert.equal(f.calls.some(call => call.method !== "GET"), false);
});

test("connection and certificate progress refresh automatically without overlapping reads and stop on close or session replacement", async t => {
  const f = await fixture(t), originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let counter = 0; const polls = new Map<number, () => void>();
  globalThis.setTimeout = ((callback: () => void, delay: number, ...args: unknown[]) => {
    if (delay === 2500) { const id = ++counter; polls.set(id, callback); return id; }
    return originalSet(callback, delay, ...args);
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => {
    if (typeof id === "number" && polls.delete(id)) return;
    originalClear(id);
  }) as typeof clearTimeout;
  t.after(() => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; });
  const tick = () => {
    assert.equal(polls.size, 1, "one scheduled refresh per mounted dialog");
    const [id, callback] = [...polls.entries()][0]!; polls.delete(id); callback();
  };
  await f.open();
  for (const [status, label] of [["connecting", "正在连接接入服务…"], ["issuing_certificate", "正在申请 HTTPS 证书…"],
    ["retrying", "连接中断，正在重试…"], ["ready", "已连接，可以邀请其他节点"]] as const) {
    f.state.running = { state: status, origin: f.origin, errorCode: null, certificateExpiresAt: "2099-01-01T00:00:00Z" };
    await f.act(async () => tick()); assert.ok(f.screen.getByText(label));
  }
  f.fireEvent.click(f.screen.getByRole("button", { name: "关闭" })); assert.equal(polls.size, 0);
  f.state.running.state = "disabled"; await f.open();
  let pendingSignal!: AbortSignal;
  f.read(async signal => new Promise<Response>((_resolve, reject) => {
    pendingSignal = signal!;
    signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await f.act(async () => tick());
  assert.equal(pendingSignal.aborted, false); assert.equal(polls.size, 0, "the next refresh waits until this request completes");
  const count = f.calls.length; f.fireEvent.click(f.screen.getByRole("button", { name: "刷新当前状态" }));
  assert.equal(f.calls.length, count, "manual refresh cannot overlap an in-flight poll");
  await f.act(async () => f.view.rerender(<LocalNodeNetwork {...f.props} session={{ ...f.props.session, token: "other-owner-session" }} />));
  assert.equal(pendingSignal.aborted, true); assert.equal(polls.size, 0); assert.equal(f.screen.queryByRole("dialog"), null);
  assert.equal(f.calls.length, count);
});

test("an enabled service can explicitly accept updated CA terms without disabling its fixed address", async t => {
  const f = await fixture(t); await f.open();
  f.state.saved = {enabled: true, origin: f.origin}; f.state.termsAcceptanceRequired = true;
  f.state.provider = {...f.provider, termsUrl: "https://ca.fixture.test/new-terms"};
  await f.refresh();
  const action = f.screen.getByRole("button", {name: "审阅更新后的证书条款…"}) as HTMLButtonElement;
  assert.equal(action.disabled, true); assert.equal(f.consent().checked, false);
  f.fireEvent.click(f.consent()); f.fireEvent.click(action);
  await f.screen.findByRole("button", {name: "保存，重启后生效"});
  const request = f.calls.find(call => call.url.endsWith("/review"))!;
  assert.equal(request.body.enabled, true); assert.equal(request.body.termsAccepted, true);
  assert.ok(f.screen.getAllByText(f.origin).length > 0);
  f.fireEvent.click(f.screen.getByRole("button", {name: "保存，重启后生效"}));
  await f.screen.findByText(/已保存。退出并重新打开/);
  assert.equal(f.state.pending?.enabled, true);
});
