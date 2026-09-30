import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import { RoomTimeline } from "../src/features/room/RoomTimeline.js";
import type { Message } from "../src/models.js";

type Props = Parameters<typeof RoomTimeline>[0];
const messages = (count: number, start = 1): Message[] => Array.from({ length: count }, (_, index) => ({
  messageId: `msg_scroll_${start + index}`, roomId: "room_scroll", taskId: "task_scroll",
  sequence: start + index, senderType: "member", senderId: "member_scroll",
  content: `Message ${start + index}`, parentMessageId: null, mentions: [], createdAt: "2026-09-30T00:00:00Z"
}));
const defaults: Props = {
  agentsById: new Map(), composerBusy: false, locale: "zh-CN", membersById: new Map(),
  messages: messages(10), pendingMessages: [], runActivities: {}, runDiagnostics: {}, runOutputs: {},
  runs: [], runsById: new Map(), session: null, onCancelRun: () => {}, onOpenWorkTask: () => {},
  onRetryPendingMessage: () => {}
};

async function environment(t: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://localhost/" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value, writable: true });
  let extraHeight = 0;
  let viewport = 240;
  const offsets = new WeakMap<HTMLElement, number>();
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientHeight: { configurable: true, get() { return this.classList.contains("timeline") ? viewport : 0; } },
    scrollHeight: { configurable: true, get() {
      return this.classList.contains("timeline") ? this.querySelectorAll("article.message").length * 120 + extraHeight : 0;
    } },
    scrollTop: { configurable: true, get() { return offsets.get(this) ?? 0; }, set(value: number) {
      offsets.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)));
    } }
  });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const timeline = this.closest<HTMLElement>(".timeline");
    const index = timeline ? [...timeline.querySelectorAll("[data-message-id]")].indexOf(this) : 0;
    const top = index * 120 - (timeline?.scrollTop ?? 0);
    return { top, bottom: top + 120, height: 120, left: 0, right: 600, width: 600, x: 0, y: top, toJSON() {} };
  };
  const observers: Array<{ connected: boolean; callback: () => void }> = [];
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: class {
    entry: { connected: boolean; callback: () => void };
    constructor(callback: () => void) {
      this.entry = { connected: true, callback };
      observers.push(this.entry);
    }
    observe() {}
    disconnect() { this.entry.connected = false; }
  } });
  const testing = await import("@testing-library/react");
  t.after(() => {
    testing.cleanup();
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    ...testing, observers,
    resize(contentHeight = extraHeight, height = viewport) {
      extraHeight = contentHeight;
      viewport = height;
      for (const observer of observers) if (observer.connected) observer.callback();
    },
    timeline(view: ReturnType<typeof testing.render>) { return view.container.querySelector<HTMLElement>(".timeline")!; }
  };
}

test("opening a long conversation starts at the latest message without scrolling the page", async (t) => {
  const env = await environment(t);
  const view = env.render(<RoomTimeline {...defaults} />);
  const timeline = env.timeline(view);
  assert.equal(timeline.scrollTop, timeline.scrollHeight - timeline.clientHeight);
  assert.equal(document.documentElement.scrollTop, 0);
  assert.equal(document.body.scrollTop, 0);
});

test("messages arriving after an empty initial read still open at the bottom", async (t) => {
  const env = await environment(t);
  const view = env.render(<RoomTimeline {...defaults} messages={[]} />);
  assert.equal(env.timeline(view).scrollTop, 0);
  view.rerender(<RoomTimeline {...defaults} />);
  assert.equal(env.timeline(view).scrollTop, 960);
});

test("switching conversation resets its reading position to the latest message", async (t) => {
  const env = await environment(t);
  const view = env.render(<RoomTimeline key="room_a:task_a" {...defaults} />);
  const previous = env.timeline(view);
  previous.scrollTop = 120;
  env.fireEvent.scroll(previous);
  view.rerender(<RoomTimeline key="room_a:task_b" {...defaults} messages={messages(6, 30)} />);
  assert.notEqual(env.timeline(view), previous);
  assert.equal(env.timeline(view).scrollTop, 480);
});

test("live messages follow at the bottom but leave a reader of earlier messages in place", async (t) => {
  const env = await environment(t);
  const view = env.render(<RoomTimeline {...defaults} />);
  const timeline = env.timeline(view);
  env.fireEvent.scroll(timeline);
  view.rerender(<RoomTimeline {...defaults} messages={messages(11)} />);
  assert.equal(timeline.scrollTop, 1080);
  timeline.scrollTop = 240;
  env.fireEvent.scroll(timeline);
  view.rerender(<RoomTimeline {...defaults} messages={messages(12)} />);
  env.resize();
  assert.equal(timeline.scrollTop, 240);
  timeline.scrollTop = timeline.scrollHeight;
  env.fireEvent.scroll(timeline);
  view.rerender(<RoomTimeline {...defaults} messages={messages(13)} />);
  assert.equal(timeline.scrollTop, 1320);
});

test("late content and viewport changes follow only while the reader stays at the bottom", async (t) => {
  const env = await environment(t);
  const view = env.render(<RoomTimeline {...defaults} />);
  const timeline = env.timeline(view);
  env.resize(180);
  assert.equal(timeline.scrollTop, 1140);
  env.resize(180, 360);
  assert.equal(timeline.scrollTop, 1020);
  timeline.scrollTop = 240;
  env.fireEvent.scroll(timeline);
  env.resize(360, 240);
  assert.equal(timeline.scrollTop, 240);
  view.unmount();
  assert.ok(env.observers.every((observer) => !observer.connected));
});

test("prepending older history preserves the message anchor, including scrolling during the request", async (t) => {
  const env = await environment(t);
  let resolve!: () => void;
  const pending = new Promise<void>((done) => { resolve = done; });
  let loads = 0;
  const props = { ...defaults, messages: messages(10, 10), hasOlderMessages: true,
    onLoadOlderMessages: () => { loads++; return pending; } };
  const view = env.render(<RoomTimeline {...props} />);
  const timeline = env.timeline(view);
  timeline.scrollTop = 240;
  env.fireEvent.scroll(timeline);
  env.fireEvent.click(view.getByRole("button", { name: "加载更早的消息" }));
  view.rerender(<RoomTimeline {...props} historyLoading />);
  timeline.scrollTop = 360;
  env.fireEvent.scroll(timeline);
  const first = view.container.querySelector<HTMLElement>('[data-message-id="msg_scroll_10"]')!;
  const before = first.getBoundingClientRect().top;
  view.rerender(<RoomTimeline {...props} messages={[...messages(2, 8), ...props.messages]} />);
  await env.act(async () => { resolve(); await pending; });
  assert.equal(loads, 1);
  assert.equal(first.getBoundingClientRect().top, before);
  assert.equal(timeline.scrollTop, 600);
  env.resize();
  assert.equal(timeline.scrollTop, 600);
});

test("a failed older-history read leaves the reader at the same position", async (t) => {
  const env = await environment(t);
  const props = { ...defaults, hasOlderMessages: true, onLoadOlderMessages: async () => {} };
  const view = env.render(<RoomTimeline {...props} />);
  const timeline = env.timeline(view);
  timeline.scrollTop = 120;
  env.fireEvent.scroll(timeline);
  await env.act(async () => { env.fireEvent.click(view.getByRole("button", { name: "加载更早的消息" })); });
  view.rerender(<RoomTimeline {...props} historyLoading />);
  view.rerender(<RoomTimeline {...props} historyError="History unavailable" />);
  env.resize(120);
  assert.equal(timeline.scrollTop, 120);
});
