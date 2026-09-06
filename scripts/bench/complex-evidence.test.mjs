import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createTestResources } from "../test/resources.mjs";
import { documentsFor, prepareWorkspaces, sha256 } from "./workspace-evidence.mjs";
import { complexPacket, complexTaskInput, loadComplexExperiment, loadComplexRemaining } from "./complex-evidence.mjs";

test("complex packet freezes six paired attempts, criterion identity and bounded admission", () => {
  const { plan, samples } = loadComplexExperiment();
  assert.equal(samples.length, 6);
  assert.deepEqual(samples.map(({ id, repetition }) => `${id}:${repetition}`),
    ["review:1", "incident:1", "planning:1", "review:2", "incident:2", "planning:2"]);
  assert.equal(samples.length * 4, 24);
  for (let index = 0; index < 3; index += 1) {
    assert.notEqual(index % 2, (index + 3) % 2, "Repeat reverses arm order");
    assert.equal(complexTaskInput(samples[index], "unchanged checklist"),
      complexTaskInput(samples[index + 3], "unchanged checklist"));
  }
  for (const authorization of ["pending", "consumed", undefined]) {
    assert.throws(() => loadComplexExperiment({ ...plan, authorization }, { requireAuthorization: true }), /authorization/u);
  }
  assert.doesNotThrow(() => loadComplexExperiment({ ...plan, authorization: "owner-requested" }, { requireAuthorization: true }));
  for (const change of [{ packetSha256: "0".repeat(64) }, { maximumInvocations: 25 }, { packetPath: "unapproved.json" }]) {
    assert.throws(() => loadComplexExperiment({ ...plan, ...change }));
  }
});

test("complex workspaces expose equal total evidence with no rubric or reference fields", async (t) => {
  const resources = await createTestResources(t, "convenewire-complex-packet-");
  const spaces = prepareWorkspaces(resources.directory, complexPacket);
  for (const sample of complexPacket.cases) {
    assert.ok(sample.documents.reduce((sum, doc) => sum + doc.content.length, 0) > 6000);
    const baseline = documentsFor(sample, "Baseline");
    const solver = documentsFor(sample, "Solver");
    const reviewer = documentsFor(sample, "Reviewer");
    assert.equal(baseline.length, 8);
    assert.equal(solver.length, 4);
    assert.equal(reviewer.length, 4);
    assert.deepEqual([...solver, ...reviewer].map(({ id }) => id).sort(), baseline.map(({ id }) => id).sort());
    assert.equal(new Set([...solver, ...reviewer].map(({ id }) => id)).size, 8);
    assert.equal(sample.rubric.reduce((sum, criterion) => sum + criterion.maximumScore, 0), 20);
    for (const doc of baseline) assert.equal(sha256(doc.content), doc.sha256);
  }
  for (const [role, space] of Object.entries(spaces)) {
    const bundle = JSON.parse(await readFile(path.join(space, "evidence.json"), "utf8"));
    assert.deepEqual(Object.keys(bundle), ["version", "cases"]);
    for (const sample of bundle.cases) {
      assert.deepEqual(Object.keys(sample), ["id", "documents"]);
      assert.deepEqual(sample.documents, documentsFor(complexPacket.cases.find(({ id }) => id === sample.id), role));
      assert.ok(!JSON.stringify(sample).includes('"partialCredit"'));
    }
  }
});

test("planning reference is feasible under parsed job constraints and the complete window", () => {
  const sample = complexPacket.cases.find(({ id }) => id === "planning");
  const source = sample.documents.find(({ id }) => id === "plan-jobs").content;
  const jobs = [...source.matchAll(/^([A-F]) \| (\d+) \| (\d+) \| (none|[A-F] complete)$/gm)]
    .map(([, id, duration, memory, dependency]) => ({ id, duration: Number(duration), memory: Number(memory), predecessor: dependency === "none" ? null : dependency[0] }));
  assert.equal(jobs.length, 6);
  const starts = { A: 0, C: 0, E: 4, B: 6, D: 7, F: 11 };
  const ends = Object.fromEntries(jobs.map((job) => [job.id, starts[job.id] + job.duration]));
  for (const job of jobs) if (job.predecessor) assert.ok(starts[job.id] >= ends[job.predecessor]);
  for (let minute = 0; minute < 13; minute += 1) {
    const active = jobs.filter(({ id }) => starts[id] <= minute && ends[id] > minute);
    assert.ok(active.length <= 2);
    assert.ok(active.reduce((sum, job) => sum + job.memory, 0) <= 16);
  }
  assert.equal(Math.max(...Object.values(ends)), 13);
  assert.equal(2 + 13 + 1 + 5, 21);
  assert.ok(21 <= 22 && 60 <= 90);
  const peakBacklog = (220 - Math.min(2 * 120, 180)) * 120;
  assert.equal(peakBacklog, 4800);
  assert.ok(peakBacklog < 6000 && peakBacklog / 180 < 60);
  assert.equal(peakBacklog / (180 - 140), 120);
});

test("incident reference preserves clock, watermark and ambiguous-effect distinctions", () => {
  const sample = complexPacket.cases.find(({ id }) => id === "incident");
  const provider = sample.documents.find(({ id }) => id === "incident-provider").content;
  const rows = [...provider.matchAll(/providerTime (\d\d:\d\d:\d\d) \| receipt (P\d+) \| key (Alpha:\d+) \| item Widget \| delta \+(\d+) \| before (\d+) \| after (\d+)/g)];
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + Number(row[4]), 0), 14);
  assert.equal(Number(rows[1][6]), 114);
  const seconds = (value) => value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
  assert.equal(seconds(rows[0][1]) + 30, seconds("10:00:04"));
  assert.equal(seconds(rows[1][1]) + 30, seconds("10:00:18"));
  assert.equal(seconds("10:02:32") - 90, seconds("10:01:02"));
  assert.ok(seconds("10:00:50") < seconds("10:01:02"));
  assert.equal(seconds("10:01:20") - seconds("10:00:00"), 80);
  assert.equal(seconds("10:00:20") - seconds("10:00:15"), 5);
});

test("remaining complex plan retains failure and excludes every started arm within the original phase cap", () => {
  const { plan, samples } = loadComplexRemaining();
  const keys = samples.flatMap((sample) => sample.arms.map((arm) => `${sample.id}:${sample.repetition}:${arm}`));
  assert.equal(keys.length, 9);
  assert.equal(new Set(keys).size, 9);
  assert.equal(keys[0], "incident:1:single_agent");
  assert.ok(!keys.includes("incident:1:discussion"));
  assert.ok(!keys.some((key) => key.startsWith("review:1:")));
  assert.equal(plan.priorInvocations + plan.maximumNewInvocations, 23);
  assert.equal(plan.maximumModelWorkSeconds, 1667);
  for (const change of [{ priorInvocations: 0 }, { maximumNewInvocations: 18 },
    { maximumPhaseInvocations: 25 }, { maximumModelWorkSeconds: 1800 }, { retryFailedArms: true },
    { priorReport: { ...plan.priorReport, sha256: "0".repeat(64) } }]) {
    assert.throws(() => loadComplexRemaining({ ...plan, ...change }));
  }
  assert.throws(() => loadComplexRemaining({ ...plan, authorization: "consumed" }, { requireAuthorization: true }));
});
