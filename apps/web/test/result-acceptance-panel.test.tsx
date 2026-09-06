import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "react";
import type { ResultAcceptanceEvidence } from "@convene-wire/contracts/task-result";
import { advanceWebSessionGeneration } from "../src/api-client.js";
import { ResultAcceptancePanel } from "../src/features/work/ResultAcceptancePanel.js";

function evidenceFixture(): ResultAcceptanceEvidence {
  const contribution = {
    resultId: "result_earlier001", resultVersion: 1, state: "proposed" as const,
    proposedBy: { kind: "managed_agent" as const, agentId: "agent_evidence001", runId: "run_evidence001" },
    claim: { criterionKey: "criterion_first", coverage: "satisfied" as const, explanation: "<script>unsafe()</script> Earlier calculation retained.", evidenceRefIds: ["evidence_source"] },
    sources: [{ evidenceRefId: "evidence_source", kind: "artifact" as const, artifactId: "artifact_evidence001" }]
  };
  const profile = { profileId: "verifier_unit001", revision: 2, digest: "a".repeat(64) };
  return {
    version: 1, taskId: "task_evidence001", resultId: "result_current001", resultVersion: 3,
    definitionRevision: 1, criteriaRevision: 1, currentDefinitionRevision: 2, currentCriteriaRevision: 2,
    stale: true, historyLimit: 10, omittedResults: 2,
    criteria: [
      { criterion: { criterionKey: "criterion_first", description: "Original requirement", required: true, ordinal: 1 },
        candidate: null, contributions: [contribution, { ...contribution, resultId: "result_rejected001", state: "rejected" }], diagnostics: ["missing_claim", "earlier_evidence_not_referenced"] },
      { criterion: { criterionKey: "criterion_second", description: "Inspect changed coverage", required: false, ordinal: 2 },
        candidate: { ...contribution, resultId: "result_current001", resultVersion: 3, claim: { ...contribution.claim, criterionKey: "criterion_second", coverage: "unresolved", evidenceRefIds: [] }, sources: [] },
        contributions: [], diagnostics: ["differing_coverage", "claim_without_evidence"] }
    ],
    artifacts: [{ artifactId: "artifact_evidence001", artifactRevision: 4, type: "patch", contentSha256: "b".repeat(64), contentSizeBytes: 128, omittedCandidates: 1,
      candidates: ["passed", "failed", "incomplete", "not_configured", "unavailable"].map((status, index) => ({
        status: status as ResultAcceptanceEvidence["artifacts"][number]["candidates"][number]["status"],
        checkpointId: `checkpoint_evidence00${index}`, runId: "run_evidence001", planId: "plan_evidence001", planRevision: 1,
        nodeKey: "implement", candidateCommit: "c".repeat(40), candidateTree: "d".repeat(40), inputDigest: "e".repeat(64),
        omittedReceipts: index === 4 ? 1 : 0, requiredProfiles: [profile],
        receipts: [{ verificationId: `verification_evidence00${index}`, operationId: `operation_evidence00${index}`, receiptDigest: "f".repeat(64), profile,
          outcome: index === 0 ? "passed" : index === 1 ? "failed" : index === 2 ? "timed_out" : index === 3 ? "canceled" : "outcome_unknown" }]
      })) }
    ]
  };
}
const props = { taskId: "task_evidence001", resultId: "result_current001", taskRevision: 3, refreshKey: "first", locale: "en" as const, token: "fixture" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  for (const key of ["document", "HTMLElement", "window", "navigator"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  return dom;
}

test("lazy criterion view distinguishes missing claims, attributed history and exact verifier scope in both locales", async () => {
  const dom = installDom();
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push(String(input));
    assert.equal(init?.method, undefined);
    assert.equal(init?.cache, "no-store");
    return response(evidenceFixture());
  };
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  try {
    const view = render(<ResultAcceptancePanel {...props} />);
    assert.equal(requests.length, 0);
    fireEvent.click(view.getByRole("button", { name: "Review evidence by criterion" }));
    await waitFor(() => assert.ok(view.getByText("Original requirement")));
    assert.deepEqual(requests, ["/api/results/result_current001/acceptance-evidence"]);
    for (const text of ["Earlier evidence is not referenced by this Result", "Coverage claims differ", "Claim has no evidence reference",
      "Configured required checks passed", "Required check failed", "Required checks not confirmed", "No required checks configured",
      "Candidate verification cannot be fully matched"]) assert.ok(view.getByText(text));
    assert.match(view.container.textContent!, /Rejected history/u);
    assert.match(view.container.textContent!, /Stale evidence.*2 \/ 2/u);
    assert.match(view.container.textContent!, /2 omitted/u);
    assert.match(view.container.textContent!, /configured checks only/u);
    assert.match(view.container.textContent!, /artifact_evidence001 · r4/u);
    assert.match(view.container.textContent!, /agent_evidence001/u);
    assert.match(view.container.textContent!, /Outcome unknown/u);
    assert.equal(dom.window.document.querySelector("script"), null);
    view.rerender(<ResultAcceptancePanel {...props} locale="zh-CN" />);
    assert.ok(view.getByText("此前贡献有本结果未引用的证据"));
    assert.ok(view.getByText("已配置的必需检查通过"));
    assert.match(view.container.textContent!, /提议者的声明/u);
    assert.equal(requests.length, 1);
  } finally { cleanup(); globalThis.fetch = original; dom.window.close(); }
});

test("denied and mismatched responses show no evidence; refresh retries and empty criteria are explicit", async () => {
  const dom = installDom();
  const original = globalThis.fetch;
  globalThis.fetch = async () => response({ error: { message: "private server detail" } }, 403);
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  try {
    const view = render(<ResultAcceptancePanel {...props} />);
    fireEvent.click(view.getByRole("button", { name: "Review evidence by criterion" }));
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.doesNotMatch(view.container.textContent!, /private server detail/u);
    globalThis.fetch = async () => response({ ...evidenceFixture(), taskId: "task_wrong001" });
    fireEvent.click(view.getByRole("button", { name: "Refresh evidence" }));
    await waitFor(() => assert.ok(view.getByRole("alert")));
    assert.equal(view.queryByText("Original requirement"), null);
    globalThis.fetch = async () => response({ ...evidenceFixture(), stale: false, criteria: [], artifacts: [], omittedResults: 0 });
    fireEvent.click(view.getByRole("button", { name: "Refresh evidence" }));
    await waitFor(() => assert.ok(view.getByText("No canonical criteria were defined for this revision.")));
    assert.equal(view.queryByRole("alert"), null);
  } finally { cleanup(); globalThis.fetch = original; dom.window.close(); }
});

test("Task revision, Result and session changes fence pending or previously visible evidence", async () => {
  const dom = installDom();
  const original = globalThis.fetch;
  let finish!: (value: Response) => void;
  globalThis.fetch = async () => response(evidenceFixture());
  const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  try {
    const view = render(<ResultAcceptancePanel {...props} />);
    fireEvent.click(view.getByRole("button", { name: "Review evidence by criterion" }));
    await waitFor(() => assert.ok(view.getByText("Original requirement")));
    globalThis.fetch = async () => new Promise((resolve) => { finish = resolve; });
    view.rerender(<ResultAcceptancePanel {...props} taskRevision={4} />);
    assert.equal(view.queryByText("Original requirement"), null);
    assert.ok(view.getByRole("status"));
    const oldFinish = finish;
    view.rerender(<ResultAcceptancePanel {...props} resultId="result_other001" />);
    await act(async () => { oldFinish(response(evidenceFixture())); });
    assert.equal(view.queryByText("Original requirement"), null);
    advanceWebSessionGeneration();
    await act(async () => { finish(response({ ...evidenceFixture(), resultId: "result_other001" })); });
    assert.equal(view.queryByText("Original requirement"), null);
    assert.equal(view.queryByRole("alert"), null);
  } finally { cleanup(); globalThis.fetch = original; dom.window.close(); }
});
