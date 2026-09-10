import type Database from "better-sqlite3";
import type { PeerAdmission, PeerExecutionBinding, PeerRunPayload, PeerRunRequest } from "@convene-wire/contracts/peer";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { peerDigest, peerRunRequestDigest, verifyPeerRunRequest } from "@convene-wire/contracts/peer-proof";
import { canonicalPeerJson } from "@convene-wire/contracts/peer-json";
import { CoreRepository } from "../data/core-repository.js";
import { PeerAuthorizationRepository } from "../data/peer-authorization-repository.js";
import { PeerMembershipRepository, PeerStoreError } from "../data/peer-membership-repository.js";
import { RunRepository } from "../run/run-repository.js";
import type { AuthorityService } from "../security/authority-service.js";
import type { PeerAdmissionService } from "../security/peer-admission-service.js";
import { verifyPeerProof } from "../security/peer-proof-verifier.js";
import { AgentTaskRepository } from "../task/task-repository.js";
import { ContextPlanner } from "../task/context-planner.js";
import { discussionExcludedMessageIds } from "../discussion/discussion-run-context.js";

/** Host writer for already-authorized local Runs. No network caller supplies
 * execution content, and no background Web/Device principal is fabricated. */
export class PeerRunAuthority {
  private readonly core: CoreRepository;
  private readonly runs: RunRepository;
  private readonly tasks: AgentTaskRepository;
  private readonly grants: PeerAuthorizationRepository;
  private readonly planner: ContextPlanner;

  public constructor(private readonly database: Database.Database, private readonly admission: PeerAdmissionService,
    private readonly authority: AuthorityService) {
    this.core = new CoreRepository(database);
    this.runs = new RunRepository(database);
    this.tasks = new AgentTaskRepository(database);
    this.grants = new PeerAuthorizationRepository(database);
    this.planner = new ContextPlanner(database, this.core, this.tasks);
  }

  /** Internal dispatcher only. A replay returns historical evidence; it cannot
   * grant current delivery/admission. Read paths must separately requireCurrent. */
  public freeze(runId: string, now: string): PeerRunRequest {
    return this.database.transaction(() => {
      const prior = this.get(runId);
      if (prior) return prior;
      const { run, agent, effective, binding, discussion } = this.current(runId, now);
      if (run.state !== "queued") throw new PeerStoreError("STALE_AUTHORIZATION");
      const trigger = this.core.getMessage(run.triggerMessageId), manifest = this.runs.getContextManifest(runId);
      const fence = this.runs.getContextFence(runId);
      if (!trigger || !manifest || !fence || manifest.execution || manifest.target.deviceId || manifest.target.workspaceAlias ||
          manifest.permissions.deviceTrustRevision || manifest.permissions.centralApprovalRevision ||
          agent.capabilities.ownerPrivateOutput || agent.runtimePolicy?.deviceTrust || agent.runtimePolicy?.centralApproval) {
        throw new PeerStoreError("UNSUPPORTED_CAPABILITY");
      }
      const planned = this.planner.plan({ roomId: run.roomId, taskId: run.taskId, throughSequence: trigger.sequence,
        triggerMessageId: trigger.messageId, contextFence: fence,
        excludedMessageIds: discussionExcludedMessageIds(this.database, runId) }, now);
      const contextPlan = { ...planned.contextPlan,
        ...(planned.contextPlan.resultEvidence ? { resultEvidence: { ...planned.contextPlan.resultEvidence,
          artifactRefs: planned.contextPlan.resultEvidence.artifactRefs.map(({ content: _content, ...reference }) => reference) } } : {}) };
      const payload = {
        runId: run.runId, traceId: run.traceId, roomId: run.roomId, taskId: run.taskId,
        triggerMessageId: run.triggerMessageId, requesterMemberId: run.requesterMemberId,
        targetAgentId: run.targetAgentId, targetAgentName: agent.name,
        ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}), instruction: run.instruction, deadline: run.deadlineAt,
        session: { scope: "task", contextPolicy: "task_isolated_v1", contextCursor: trigger.sequence,
          resumePolicy: !discussion && effective.acceptance.value.capabilities.supportsResume ? "resume_or_start" : "start_new" },
        contextMessages: planned.contextMessages.map(message => ({ messageId: message.messageId, sequence: message.sequence,
          senderId: message.senderType === "system" && message.senderId === "execution-scheduler" ? "execution_scheduler" : message.senderId,
          content: message.content })), contextPlan,
        contextManifest: { ...manifest, target: { agentId: agent.agentId, runtimeKind: "not_recorded" },
          permissions: { filesystemAccess: "local-policy", networkAccess: "local-policy",
            interrupt: effective.acceptance.value.capabilities.supportsInterrupt ? "supported" : "unsupported",
            handoff: "unsupported", maxDurationSeconds: manifest.permissions.maxDurationSeconds } }
      } as PeerRunPayload;
      binding.requestDigest = peerRunRequestDigest(binding, payload);
      const request: PeerRunRequest = { schemaVersion: 1, binding, payload };
      verifyPeerRunRequest(request);
      this.database.prepare(`INSERT INTO peer_run_requests (run_id, peer_id, membership_id, request_digest, request_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(runId, binding.peerId, effective.membership.membershipId, binding.requestDigest,
        Buffer.from(canonicalPeerJson(request)).toString("utf8"), now);
      return this.get(runId)!;
    }).immediate();
  }

  public get(runId: string): PeerRunRequest | undefined {
    const row = this.database.prepare("SELECT request_digest, request_json FROM peer_run_requests WHERE run_id = ?")
      .get(runId) as { request_digest: string; request_json: string } | undefined;
    if (!row) return undefined;
    const request = JSON.parse(row.request_json) as PeerRunRequest;
    try { verifyPeerRunRequest(request); } catch { throw new PeerStoreError("PAYLOAD_CONFLICT"); }
    if (request.binding.runId !== runId || request.binding.requestDigest !== row.request_digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
    return request;
  }

  /** Selection observes current bilateral rights, never an online display hint.
   * Offline delivery still waits under the frozen Wave deadline. */
  public canParticipateInDiscussion(agentId: string, roomId: string, now: string): boolean {
    const agent = this.core.getAgent(agentId), room = this.core.getRoom(roomId);
    if (!agent || agent.integrationMode !== "peer" || agent.deviceId || !agent.enabled ||
        !room || room.archivedAt || agent.teamId !== room.teamId || !this.core.isRoomAgent(roomId, agentId) ||
        agent.capabilities.ownerPrivateOutput || agent.runtimePolicy?.deviceTrust || agent.runtimePolicy?.centralApproval) return false;
    const projection = this.database.prepare("SELECT peer_id, local_agent_id FROM peer_agent_projections WHERE projection_agent_id = ?")
      .get(agentId) as { peer_id: string; local_agent_id: string } | undefined;
    if (!projection) return false;
    try {
      const { membership, acceptance } = this.grants.requireEffective(projection.peer_id, projection.local_agent_id, roomId, now);
      return membership.hostNodeId === this.authority.nodeId && membership.memberId === agent.ownerMemberId &&
        acceptance.value.capabilities.supportsStart && acceptance.value.capabilities.supportsTaskContextIsolation;
    } catch (error) {
      if (error instanceof PeerStoreError) return false;
      throw error;
    }
  }

  private requireDiscussionContext(runId: string, receiptOnly: boolean): boolean {
    const row = this.database.prepare(`SELECT d.state, d.policy_json, w.state AS wave_state,
        t.state AS turn_state, t.speaker_agent_id, d.room_id, d.task_id,
        r.target_agent_id, r.room_id AS run_room_id, r.task_id AS run_task_id,
        EXISTS (SELECT 1 FROM discussion_participants p JOIN agents a ON a.agent_id = p.agent_id
          WHERE p.discussion_id = d.discussion_id AND json_extract(a.capabilities_json, '$.ownerPrivateOutput') = 1) AS private_participant,
        EXISTS (SELECT 1 FROM discussion_turns prior JOIN run_deliveries delivery ON delivery.run_id = prior.run_id
          WHERE prior.discussion_id = d.discussion_id AND json_extract(delivery.payload_json, '$.ownerPrivateOutput') = 1) AS private_history
      FROM discussion_turns t JOIN discussions d ON d.discussion_id = t.discussion_id
      LEFT JOIN discussion_waves w ON w.wave_id = t.wave_id AND w.discussion_id = d.discussion_id
      JOIN runs r ON r.run_id = t.run_id WHERE t.run_id = ?`).get(runId) as {
        state: string; policy_json: string; wave_state: string; turn_state: string;
        speaker_agent_id: string; target_agent_id: string; room_id: string; task_id: string;
        run_room_id: string; run_task_id: string; private_participant: number; private_history: number;
      } | undefined;
    if (!row) return false;
    if (row.private_participant || row.private_history || JSON.parse(row.policy_json).waveCompletionMode !== "all_settled") {
      throw new PeerStoreError("UNSUPPORTED_CAPABILITY");
    }
    if (row.speaker_agent_id !== row.target_agent_id || row.room_id !== row.run_room_id || row.task_id !== row.run_task_id ||
        !receiptOnly && (row.wave_state !== "open" || !["active", "stop_requested", "finalizing"].includes(row.state) ||
          !["queued", "working"].includes(row.turn_state))) throw new PeerStoreError("STALE_AUTHORIZATION");
    return true;
  }

  public requireCurrent(binding: PeerExecutionBinding, now: string, receiptOnly = false): PeerRunRequest {
    const retained = this.get(binding.runId);
    if (!retained || peerDigest(retained.binding) !== peerDigest(binding)) throw new PeerStoreError("PAYLOAD_CONFLICT");
    const current = this.current(binding.runId, now, receiptOnly).binding;
    current.requestDigest = binding.requestDigest;
    if (peerDigest(current) !== peerDigest(binding)) throw new PeerStoreError("STALE_AUTHORIZATION");
    return retained;
  }

  /** Refreshes a <=30 second attestation of the exact retained request. It
   * creates no Run, changes no payload and issues no settlement capability. */
  public authorize(token: string, input: PeerAdmission, now: string): PeerAdmission {
    if (!validatePeer("PeerAdmission", input)) throw new PeerStoreError("INVALID_MESSAGE");
    return this.database.transaction(() => {
      const principal = this.admission.authenticateMachine(token, now), b = input.binding;
      if (b.peerId !== principal.peerId || b.authorityNodeId !== principal.hostNodeId ||
          b.participantNodeId !== principal.participantNodeId || b.teamId !== principal.scope.teamId) throw new PeerStoreError("SCOPE_DENIED");
      const context = { purpose: "run.admission" as const, audienceNodeId: this.authority.nodeId,
        operationId: input.proof.payload.operationId, nonce: input.proof.payload.nonce, subjectDigest: peerDigest(b) };
      verifyPeerProof(input.proof, { nodeId: principal.participantNodeId, publicKey: principal.participantPublicKey }, context, now);
      this.requireCurrent(b, now);
      return { schemaVersion: 1, binding: structuredClone(b), proof: this.authority.signPeerProof({ ...context,
        audienceNodeId: principal.participantNodeId }, now) };
    }).immediate();
  }

  private current(runId: string, now: string, receiptOnly = false) {
    const discussion = this.requireDiscussionContext(runId, receiptOnly);
    const run = this.runs.getRun(runId);
    if (!run || !receiptOnly && (!["queued", "delivered", "working"].includes(run.state) || run.deadlineAt <= now ||
        this.runs.getCancellationIntent(runId)?.state === "pending" ||
        this.database.prepare("SELECT 1 FROM peer_run_cancellations WHERE run_id = ?").get(runId))) throw new PeerStoreError("STALE_AUTHORIZATION");
    const room = this.core.getRoom(run.roomId), agent = this.core.getAgent(run.targetAgentId), task = this.tasks.get(run.taskId);
    const requester = this.core.getMember(run.requesterMemberId);
    if (!room || room.archivedAt || !task || task.roomId !== room.roomId ||
        !receiptOnly && (!["ready", "active", "review"].includes(task.lifecycleState) || task.schedulingState !== "enabled") ||
        !agent || agent.integrationMode !== "peer" || agent.deviceId || !agent.enabled ||
        !task.isDefault && !task.assignments.some(assignment => assignment.agentId === agent.agentId) ||
        agent.teamId !== room.teamId || !this.core.isRoomAgent(room.roomId, agent.agentId) ||
        !requester?.userId || requester.teamId !== room.teamId || !this.core.isRoomMember(room.roomId, requester.memberId)) {
      throw new PeerStoreError("SCOPE_DENIED");
    }
    // This is the immutable Run's originating Member, not a synthetic browser
    // session. A Peer-originated Run retains its current membership ceiling.
    const origin = this.database.prepare("SELECT membership_id FROM peer_memberships WHERE user_id = ?")
      .get(requester.userId) as { membership_id: string } | undefined;
    if (origin) {
      const m = new PeerMembershipRepository(this.database).requireActiveMembership(origin.membership_id, now);
      if (m.memberId !== requester.memberId || m.scope.teamId !== room.teamId || m.scope.kind === "room" && m.scope.roomId !== room.roomId) {
        throw new PeerStoreError("SCOPE_DENIED");
      }
    }
    const projection = this.database.prepare("SELECT peer_id, local_agent_id FROM peer_agent_projections WHERE projection_agent_id = ?")
      .get(agent.agentId) as { peer_id: string; local_agent_id: string } | undefined;
    if (!projection) throw new PeerStoreError("SCOPE_DENIED");
    const effective = this.grants.requireEffective(projection.peer_id, projection.local_agent_id, room.roomId, now);
    const { grant: g, acceptance: a, membership: m } = effective;
    if (m.hostNodeId !== this.authority.nodeId || m.memberId !== agent.ownerMemberId ||
        !a.value.capabilities.supportsStart || !a.value.capabilities.supportsTaskContextIsolation) throw new PeerStoreError("UNSUPPORTED_CAPABILITY");
    const binding: PeerExecutionBinding = { schemaVersion: 1, authorityNodeId: m.hostNodeId, participantNodeId: m.participantNodeId,
      peerId: m.peerId, teamId: room.teamId, roomId: room.roomId, runId, projectionAgentId: agent.agentId, localAgentId: projection.local_agent_id,
      exportId: g.value.exportId, grantRevision: g.value.revision, grantDigest: g.digest, acceptanceId: a.value.acceptanceId,
      acceptanceRevision: a.value.revision, acceptanceDigest: a.digest, requestDigest: "0".repeat(64) };
    return { run, agent, effective, binding, discussion };
  }
}
