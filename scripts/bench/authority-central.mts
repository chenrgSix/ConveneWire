// Disposable actual Central/Result-service adapter. Input must already be authorized for the whole QA Room.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { createServerApp } from "../../apps/server/src/app.js";
import { CoreRepository } from "../../apps/server/src/data/core-repository.js";
import { AuthService } from "../../apps/server/src/security/auth-service.js";
import { RunRepository } from "../../apps/server/src/run/run-repository.js";
import { AgentTaskService } from "../../apps/server/src/task/agent-task-service.js";
import { AgentTaskRepository } from "../../apps/server/src/task/task-repository.js";
import { ResultRepository } from "../../apps/server/src/task/result-repository.js";
import { ResultService } from "../../apps/server/src/task/result-service.js";
import { packet, scopeFor, verifyRelease, hash } from "./authority-collaboration.mjs";

const [inputPath, outputPath] = process.argv.slice(2);
const request = JSON.parse(readFileSync(inputPath, "utf8"));
const now = new Date().toISOString();
const app = await createServerApp({ databasePath: request.databasePath, clock: () => now, logger: false });
let response: unknown;
try {
  if (request.mode === "init") {
    const bootstrap = await app.inject({ method: "POST", url: "/api/bootstrap",
      payload: { userId: "user_qa079_owner_0001", displayName: "Synthetic Authority Owner" } });
    assert.equal(bootstrap.statusCode, 200);
    const authorization = `Bearer ${bootstrap.json().session.token}`;
    const call = async (url: string, payload: unknown) => {
      const result = await app.inject({ method: "POST", url, headers: { authorization }, payload });
      assert.equal(result.statusCode, 200, result.body); return result.json();
    };
    const team = await call("/api/teams", { name: "QA-079 disposable authority experiment" });
    const teamId = team.team.teamId, ownerMemberId = team.owner.memberId;
    const room = await call(`/api/teams/${teamId}/rooms`, { name: "Explicitly approved publication audience" });
    const agents: Record<string, string> = {};
    for (const owner of [...packet().owners, "finalizer"]) {
      const agent = await call(`/api/teams/${teamId}/manual-agents`, { name: owner, role: "QA evidence participant" });
      agents[owner] = agent.agent.agentId;
    }
    const created = await call(`/api/rooms/${room.roomId}/tasks`, { title: "Review synthetic CA cutover",
      goal: packet().task.goal, lifecycleState: "ready", completionPolicy: "accepted_result_required",
      criteria: packet().task.criteria,
      assignments: Object.entries(agents).map(([role, agentId]) => ({ agentId, role: role === "finalizer" ? "primary" : "contributor" })) });
    const task = await call(`/api/tasks/${created.taskId}/control`, { operationId: "op_qa079_activate0001", expectedTaskRevision: 1, lifecycleState: "active" });
    const runs: Record<string, string> = {};
    for (const role of [...packet().owners, "finalizer"]) {
      const message = await call(`/api/rooms/${room.roomId}/messages`, { taskId: task.taskId,
        content: "Perform only the explicitly scoped QA evidence review. No original source or private reply belongs in this Room.", mentionAgentId: agents[role] });
      assert.equal(message.runs.length, 1); runs[role] = message.runs[0].runId;
    }
    response = { scenario: request.scenario, teamId, roomId: room.roomId, taskId: task.taskId, ownerMemberId, agents, runs };
  } else {
    const db = new Database(request.databasePath);
    try {
      const core = new CoreRepository(db), auth = new AuthService(db), tasks = new AgentTaskRepository(db), runs = new RunRepository(db);
      const repository = new ResultRepository(db);
      const service = new ResultService(db, repository, new AgentTaskService(tasks, core, auth), tasks, runs, core, auth);
      const meta = request.meta;
      if (request.mode === "start") {
        for (const role of request.roles) {
          assert.ok([...packet().owners, "finalizer"].includes(role));
          runs.applyEvent(meta.runs[role], { type: "status", sequence: 1, status: "working" }, now);
        }
        response = { started: request.roles.map((role: string) => meta.runs[role]) };
      } else if (request.mode === "withheld") {
        const role = request.role;
        assert.equal(request.revokedGrantState.status, "revoked");
        assert.equal(request.revokedGrantState.grant.runId, meta.runs[role]);
        assert.equal(request.revokedGrantState.grant.recipientRunId, meta.runs.finalizer);
        runs.applyReply(meta.runs[role], { type: "reply", sequence: 2,
          content: "Local processing completed. Observation disclosure is withheld by current owner authority." }, now);
        runs.applyEvent(meta.runs[role], { type: "status", sequence: 3, status: "completed" }, now);
        response = { runId: meta.runs[role], status: "completed", observationsPublished: 0 };
      } else if (request.mode === "publish" || request.mode === "final") {
        const role = request.role, runId = meta.runs[role], operationId = `op_qa079_${meta.scenario}_${role}`;
        const publish = (summary: string) => {
          const current = tasks.get(meta.taskId)!;
          const existing = repository.listForTask(meta.taskId).find(result => result.proposal.operationId === operationId);
          if (existing) assert.equal(existing.proposal.summary, summary, "Publication retry changed immutable bytes");
          else {
            // The repository deduplicates the already-persisted start sequence.
            runs.applyEvent(runId, { type: "status", sequence: 1, status: "working" }, now);
            runs.applyReply(runId, { type: "reply", sequence: 2, content: summary }, now);
            runs.applyEvent(runId, { type: "status", sequence: 3, status: "completed" }, now);
          }
          const proposal = existing?.proposal ?? {
            operationId, taskId: meta.taskId, definitionRevision: current.definitionRevision,
            criteriaRevision: current.criteriaRevision, proposedAtTaskRevision: current.taskRevision,
            supersedesResultId: null, outcome: "informational" as const, summary,
            risks: [], openQuestions: [], nextActions: [], criterionClaims: [],
            sources: [{ evidenceRefId: `evidence_qa079_${role}_published`, kind: "run_event" as const, runId, sequence: 2 }]
          };
          const result = service.proposeManualAgent({ credentialId: "credential_qa079_fixture0001",
            userId: "user_qa079_owner_0001", sessionId: "session_qa079_fixture0001", memberId: meta.ownerMemberId,
            teamId: meta.teamId, agentId: meta.agents[role] }, { runId, proposal }, now);
          assert.equal(result.review, null, "No human acceptance is manufactured");
          return { result, replayed: Boolean(existing), summarySha256: hash(summary), resultCount: repository.listForTask(meta.taskId).length };
        };
        if (request.mode === "publish") {
          // The owner-side delivery holds its authority lock; only approved data
          // and a public grant snapshot reach this process, never private paths.
          verifyRelease(request.release, request.grantState, { ...scopeFor(meta, role), owner: role }, now);
          response = publish(JSON.stringify(request.release));
        } else {
          assert.equal(role, "finalizer"); assert.equal(typeof request.finalAnswer, "string");
          assert.ok(request.finalAnswer.length > 0 && request.finalAnswer.length <= 20_000);
          response = publish(request.finalAnswer);
        }
      } else {
        assert.equal(request.mode, "inspect");
        const results = repository.listForTask(meta.taskId);
        response = { results, task: tasks.get(meta.taskId), runEvents: Object.fromEntries(Object.entries(meta.runs)
          .map(([role, runId]) => [role, db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence").all(runId)])) };
      }
    } finally { db.close(); }
  }
  if (request.crashAfterCommit) {
    // Physical process death after the committed Result, before any response acknowledgement.
    process.kill(process.pid, "SIGKILL");
    await new Promise(() => {});
  }
  writeFileSync(outputPath, JSON.stringify(response) + "\n", { flag: "wx", mode: 0o600 });
} finally { await app.close(); }
