import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

import { useRoomComposer } from "../src/features/room/useRoomComposer.js";
import { defaultRoomCollaborationPolicy, type Agent } from "../src/models.js";

const builder: Agent = { agentId: "agent_builder", name: "Builder", role: "Builder", integrationMode: "managed", presence: "ready" };

test("composer keyboard uses the enabled Send action without consuming IME or newline input", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  const globals = {
    document: dom.window.document, window: dom.window, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage, IS_REACT_ACT_ENVIRONMENT: true
  };
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
  const page = within(dom.window.document.body);
  const originalFetch = globalThis.fetch;
  const sent: Array<{ content: string }> = [];
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message: { messageId: `msg_${sent.length}` }, runs: [] }), {
      headers: { "content-type": "application/json" }
    });
  };
  function Harness({ disabled = false }: { disabled?: boolean }) {
    const composer = useRoomComposer({
      activeDiscussion: null, agents: [builder], roomAgents: [builder], agentRoleLabel: ({ role }) => role,
      locale: "en", onDelivered: async () => {}, onError: () => {}, onRoomStateChanged: async () => {},
      roomPolicy: defaultRoomCollaborationPolicy, selectedRoomId: "room", selectedTaskId: "task",
      session: { userId: "user", displayName: "User" }
    });
    return <form onSubmit={composer.submit}>
      <textarea aria-label="Message" required value={composer.messageContent} onChange={composer.handleChange} onKeyDown={composer.handleKeyDown} />
      <button type="submit" disabled={disabled || composer.busy || !composer.hasMessageText}>Send</button>
      <output>{composer.selectedMentionAgents.map(({ agentId }) => agentId).join(",")}</output>
    </form>;
  }
  const type = (content: string) => {
    const input = page.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: content, selectionStart: content.length } });
    return input;
  };
  t.beforeEach(async () => { await act(async () => cleanup()); sent.length = 0; });
  try {
    await t.test("Enter sends once while Shift+Enter leaves native newline handling intact", async () => {
      render(<Harness />);
      const input = type("first line");
      assert.equal(fireEvent.keyDown(input, { key: "Enter", shiftKey: true }), true);
      assert.equal(sent.length, 0);
      type("first line\nsecond line");
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => assert.equal(sent.length, 1));
      assert.equal(sent[0]?.content, "first line\nsecond line");
      await waitFor(() => assert.equal(input.value, ""));
      type("new draft");
      assert.equal(fireEvent.keyDown(input, { key: "Enter", repeat: true }), false);
      assert.equal(input.value, "new draft");
      assert.equal(sent.length, 1);
    });
    await t.test("IME confirmation and modified Enter never send or select a Mention", () => {
      render(<Harness />);
      for (const content of ["中文草稿", "@B"]) {
        const input = type(content);
        for (const extra of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
          assert.equal(fireEvent.keyDown(input, { key: "Enter", ...extra }), true);
          assert.equal(input.value, content);
          assert.equal(page.getByRole("status").textContent, "");
        }
      }
      assert.equal(sent.length, 0);
    });
    await t.test("Enter selects the current Mention before sending and Escape only dismisses", () => {
      render(<Harness />);
      const input = type("@B");
      assert.equal(fireEvent.keyDown(input, { key: "Enter" }), false);
      assert.equal(input.value, "@Builder ");
      assert.equal(page.getByRole("status").textContent, builder.agentId);
      assert.equal(sent.length, 0);
      type("@unknown");
      assert.equal(fireEvent.keyDown(input, { key: "Escape" }), false);
      assert.equal(sent.length, 0);
    });
    await t.test("empty or disabled Send cannot be bypassed by Enter", () => {
      const view = render(<Harness />);
      const input = page.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.keyDown(input, { key: "Enter" });
      type("   ");
      fireEvent.keyDown(input, { key: "Enter" });
      view.rerender(<Harness disabled />);
      type("closed task draft");
      fireEvent.keyDown(input, { key: "Enter" });
      assert.equal(input.value, "closed task draft");
      assert.equal(sent.length, 0);
    });
  } finally {
    await act(async () => cleanup());
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const key of Object.keys(globals)) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
