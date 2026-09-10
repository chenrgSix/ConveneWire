import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import type { PeerAdmission, PeerExecutionBinding } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { PeerRunAuthority } from "../../src/peer/run-authority.js";
import { RunRepository } from "../../src/run/run-repository.js";
import { RunService } from "../../src/run/run-service.js";
import { AgentTaskRepository } from "../../src/task/task-repository.js";
import { MessageService } from "../../src/team-room/message-service.js";
import { peerAgentFixture } from "./peer-agent-fixture.js";
import { now, ownerMember, roomId, secret } from "./peer-fixture.js";

export async function executionFixture(t: Parameters<typeof peerAgentFixture>[0]) {
  const f = await peerAgentFixture(t);
  f.service.offer(f.token, f.signed(), now);
  const accepted = f.service.accept(f.actor, f.acceptance(), now);
  const runs = new RunRepository(f.database), tasks = new AgentTaskRepository(f.database);
  const defaultTask = tasks.getDefaultForRoom(roomId)!;
  assert.ok(defaultTask);
  const task = tasks.create({ ...defaultTask, taskId: "task_peerrunfixture001", isDefault: false,
    taskDisplayNumber: tasks.nextDisplayNumber(defaultTask.teamId), assignments: [{ agentId: accepted.projection.projectionAgentId,
      role: "primary", assignedByMemberId: ownerMember, assignedAt: now }] });
  const messages = new MessageService(f.core, f.auth);
  const message = messages.createMemberMessage(f.actor, { roomId, taskId: task.taskId, content: "Peer execution fixture", now,
    mentions: [{ targetType: "agent", targetAgentId: accepted.projection.projectionAgentId, displayLabel: "Participant Writer" }] });
  const run = new RunService(f.core, runs, f.auth, tasks).createRunsForMessage(f.actor, message.messageId, now)[0]!;
  assert.ok(run);
  const authority = new PeerRunAuthority(f.database, f.admission, f.identity);
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, 19)]), format: "der", type: "pkcs8" });
  const request = (binding: PeerExecutionBinding, at = now): PeerAdmission => {
    const payload = { ...f.signed().proof.payload, purpose: "run.admission" as const,
      operationId: "op_runadmission001", nonce: secret(), subjectDigest: peerDigest(binding), issuedAt: at,
      expiresAt: new Date(Date.parse(at) + 30_000).toISOString() };
    return { schemaVersion: 1, binding: structuredClone(binding), proof: { payload,
      signature: sign(null, peerProofTranscript(payload), key).toString("base64url") } };
  };
  return { ...f, accepted, messages, run, runs, tasks, authority, request };
}
