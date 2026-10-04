import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { JSDOM } from "jsdom";
import React, { useState } from "react";

import type { TaskAssignmentInput } from "../src/features/task/TaskAssignmentFields.js";
import { TaskCreateDialog } from "../src/features/task/TaskControls.js";
import type { Agent } from "../src/models.js";

async function fixture(t: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: dom.window.document },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    navigator: { configurable: true, value: dom.window.navigator },
    window: { configurable: true, value: dom.window },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true }
  });
  const testing = await import("@testing-library/react");
  t.after(() => {
    testing.cleanup(); dom.window.close();
    for (const key of ["document", "HTMLElement", "navigator", "window", "IS_REACT_ACT_ENVIRONMENT"]) {
      const descriptor = descriptors[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return { ...testing, dom, page: testing.within(dom.window.document.body) };
}

const agents = [
  { agentId: "agent-builder", name: "Builder", enabled: true },
  { agentId: "agent-reviewer", name: "Reviewer", enabled: true }
] as Agent[];
const props = {
  busy: false, goal: "Deliver an inspected result", locale: "en" as const,
  onClose: () => undefined, onGoalChange: () => undefined,
  onSubmit: (event: React.FormEvent) => event.preventDefault(),
  onTitleChange: () => undefined, roomName: "Delivery", title: "Release plan",
  agents, onCriteriaChange: () => undefined
};

test("optional Agent roles start collapsed, report selected count, and retain roles when reopened", async (t) => {
  const f = await fixture(t);
  function Harness() {
    const [assignments, setAssignments] = useState<TaskAssignmentInput[]>([]);
    return <TaskCreateDialog {...props} assignments={assignments} onAssignmentsChange={setAssignments} />;
  }
  f.render(<Harness />);
  const summary = f.page.getByText("Agent roles (optional)").closest("summary")!;
  const details = summary.closest("details")!;
  assert.equal(details.open, false);
  assert.ok(f.page.getByText("Assign later"));
  assert.equal((f.page.getByRole("button", { name: "Create and switch" }) as HTMLButtonElement).disabled, false,
    "assigning an Agent is optional");
  f.fireEvent.click(summary);
  assert.equal(details.open, true);
  f.fireEvent.change(f.page.getByRole("combobox", { name: "Task role: Builder" }), { target: { value: "primary" } });
  assert.ok(f.page.getByText("1 assigned"));
  f.fireEvent.change(f.page.getByRole("combobox", { name: "Task role: Reviewer" }), { target: { value: "primary" } });
  assert.equal((f.page.getByRole("combobox", { name: "Task role: Builder" }) as HTMLSelectElement).value, "contributor",
    "selecting a new primary keeps the previous Agent as a contributor");
  assert.ok(f.page.getByText("2 assigned"));
  f.fireEvent.click(summary);
  assert.equal(details.open, false);
  assert.ok(f.page.getByText("2 assigned"));
  f.fireEvent.click(summary);
  assert.equal((f.page.getByRole("combobox", { name: "Task role: Reviewer" }) as HTMLSelectElement).value, "primary");
});

test("collapsed assignment options keep loading failures visible and retain creation guards", async (t) => {
  const f = await fixture(t);
  let submitted = 0;
  let retried = 0;
  const guardedProps = { ...props, onAssignmentsChange: () => undefined,
    onRetryAgents: () => { retried += 1; },
    onSubmit: (event: React.FormEvent) => { event.preventDefault(); submitted += 1; } };
  const view = f.render(<TaskCreateDialog {...guardedProps} agentsLoading />);
  const form = f.page.getByRole("textbox", { name: "Task title" }).closest("form")!;
  const create = () => f.page.getByRole("button", { name: "Create and switch" }) as HTMLButtonElement;
  assert.ok(f.page.getByRole("status"));
  assert.equal(create().disabled, true);
  f.fireEvent.submit(form);
  assert.equal(submitted, 0);
  view.rerender(<TaskCreateDialog {...guardedProps} agentsError />);
  assert.match(f.page.getByRole("alert").textContent ?? "", /Could not load Room Agents/u);
  assert.equal(create().disabled, true);
  f.fireEvent.click(f.page.getByRole("button", { name: "Retry" }));
  assert.equal(retried, 1);
  f.fireEvent.submit(form);
  assert.equal(submitted, 0);
  view.rerender(<TaskCreateDialog {...guardedProps} />);
  assert.equal(create().disabled, false);
  f.fireEvent.submit(form);
  assert.equal(submitted, 1);
  view.rerender(<TaskCreateDialog {...guardedProps} busy />);
  assert.equal((f.page.getByRole("button", { name: "Creating…" }) as HTMLButtonElement).disabled, true);
  f.fireEvent.submit(form);
  assert.equal(submitted, 1);
  const firstSummary = f.page.getByText("Agent roles (optional)").closest("summary")!;
  const lastSummary = f.page.getByText("Delivery requirements (optional)").closest("summary")!;
  firstSummary.focus();
  f.fireEvent.keyDown(firstSummary, { key: "Tab", shiftKey: true });
  assert.equal(f.dom.window.document.activeElement === lastSummary, true);
  f.fireEvent.keyDown(lastSummary, { key: "Tab" });
  assert.equal(f.dom.window.document.activeElement === firstSummary, true);
});
