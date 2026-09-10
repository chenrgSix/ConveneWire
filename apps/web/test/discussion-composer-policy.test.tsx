import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";
import React from "react";

import { DiscussionComposerPolicy } from
  "../src/features/room/DiscussionComposerPolicy.js";
import { defaultDiscussionComposerOptions } from
  "../src/features/room/composer-storage.js";
import type { Agent } from "../src/models.js";

function installDom(): JSDOM {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://team.example.com/"
  });
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    navigator: { configurable: true, value: dom.window.navigator },
    window: { configurable: true, value: dom.window },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true }
  });
  return dom;
}

const capable: Agent = {
  agentId: "agent_capable",
  deviceId: "device_capable",
  name: "Read-only verifier",
  role: "Reviewer",
  integrationMode: "managed",
  presence: "ready",
  runtimePolicy: { filesystemAccess: "read-only" },
  capabilities: { supportsDiscussionSupplementalEvidence: true }
};

test("advanced Discussion policy exposes eligibility and refuses unsafe quorum selection", async () => {
  const dom = installDom();
  const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
  let value = { ...defaultDiscussionComposerOptions };
  const view = render(<DiscussionComposerPolicy
    agents={[capable, { ...capable, agentId: "agent_unsafe", name: "Workspace writer",
      runtimePolicy: { filesystemAccess: "workspace-write" } }]}
    disabled={false}
    locale="en"
    onChange={(next) => { value = next; }}
    value={value}
  />);
  try {
    const policy = within(view.container);
    fireEvent.click(policy.getByText("Advanced Discussion policy"));
    policy.getByText(/Workspace writer/);
    policy.getByText("not eligible for read-only quorum");
    const completion = policy.getByLabelText("Wave completion") as HTMLSelectElement;
    const quorum = within(completion).getByRole("option", {
      name: "Read-only quorum + late evidence"
    }) as HTMLOptionElement;
    assert.equal(quorum.disabled, true);
    fireEvent.change(policy.getByLabelText("Participant selection"), {
      target: { value: "all_eligible" }
    });
    assert.equal(value.participantSelectionMode, "all_eligible");
  } finally {
    cleanup();
    dom.window.close();
  }
});

test("Peer policy explains its all-settled boundary and does not advertise a private-output combination as usable", async () => {
  const dom = installDom();
  const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
  const peer: Agent = { ...capable, agentId: "agent_peer", deviceId: null, integrationMode: "peer", name: "Peer reviewer",
    capabilities: { supportsStart: true, supportsTaskContextIsolation: true } };
  const props = { disabled: false, locale: "en" as const, onChange() {}, value: { ...defaultDiscussionComposerOptions } };
  const view = render(<DiscussionComposerPolicy {...props} agents={[capable, peer]} />);
  try {
    const policy = within(view.container);
    fireEvent.click(policy.getByText("Advanced Discussion policy"));
    assert.ok(policy.getByText(/Peer Discussion waits/u));
    assert.equal((policy.getByRole("option", { name: "Read-only quorum + late evidence" }) as HTMLOptionElement).disabled, true);
    assert.equal(policy.queryByRole("alert"), null);
    view.rerender(<DiscussionComposerPolicy {...props} agents={[{ ...capable, capabilities: { ...capable.capabilities, ownerPrivateOutput: true } }, peer]} />);
    assert.match(policy.getByRole("alert").textContent!, /cannot include private-output/u);
    assert.equal(policy.queryByText(/Ordinary all-settled Discussion remains available/u), null);
  } finally { cleanup(); dom.window.close(); }
});
