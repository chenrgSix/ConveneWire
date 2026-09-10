import { timingSafeEqual } from "node:crypto";
import type Database from "better-sqlite3";
import type { PeerExecutionBinding, PeerProof, PeerProofPayload, PeerRunDelivery, PeerRunEvent,
  PeerRunEventReceipt, PeerRunEventRequest, PeerRunPollReceipt, PeerRunPollRequest, PeerRunSettlementReceipt,
  PeerRunSettlementRequest, PeerSettlementCapability } from "@convene-wire/contracts/peer";
import { canonicalPeerJson } from "@convene-wire/contracts/peer-json";
import { peerDigest, peerRunDeliveryReceiptDigest, peerSettlementMaximumSeconds } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { CoreRepository } from "../data/core-repository.js";
import { SqliteTransactionBoundary } from "../data/sqlite-transaction-boundary.js";
import { PeerStoreError, peerSecretHash } from "../data/peer-membership-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import { exceedsUnicodeCodePointLimit, truncateUnicodeCodePoints } from "../domain/unicode-length.js";
import type { RunRecord, RunRepository, RunState } from "../run/run-repository.js";
import type { RuntimeEvent } from "../runtime/runtime-adapter.js";
import type { AuthorityService } from "../security/authority-service.js";
import type { PeerAdmissionService, PeerPrincipal } from "../security/peer-admission-service.js";
import { verifyPeerProof } from "../security/peer-proof-verifier.js";
import { redactSensitiveText } from "../security/redaction.js";
import type { PeerRunAuthority } from "./run-authority.js";
import type { PeerRuntimeSessions } from "./runtime-sessions.js";

const terminal = new Set<RunState>(["completed", "failed", "canceled", "expired", "outcome_unknown"]);
const json = (value: unknown) => Buffer.from(canonicalPeerJson(value)).toString("utf8");
interface DeliveryRow {
  run_id: string; capability_id: string; capability_json: string; token_hash: string;
  receipt_digest: string; created_at: string; expires_at: string;
}

/** The Host remains the collaboration writer. Peer credentials, immutable
 * execution, content publication and content-free settlement are independent. */
export class PeerRunDeliveryService {
  private readonly core: CoreRepository;
  private readonly transactions: SqliteTransactionBoundary;
  public constructor(private readonly database: Database.Database, private readonly admission: PeerAdmissionService,
    private readonly authority: AuthorityService, private readonly requests: PeerRunAuthority,
    private readonly sessions: PeerRuntimeSessions, private readonly runs: RunRepository) {
    this.core = new CoreRepository(database);
    this.transactions = new SqliteTransactionBoundary(database);
  }

  public dispatch(runId: string, now: string): RunRecord {
    return this.transactions.immediate(() => {
      try { this.requests.requireCurrent(this.requests.freeze(runId, now).binding, now); }
      catch (error) {
        if (!(error instanceof PeerStoreError) || !["SCOPE_DENIED", "STALE_AUTHORIZATION", "UNSUPPORTED_CAPABILITY", "REVOKED", "EXPIRED"].includes(error.code)) throw error;
        return this.cancelKnown(runId, null, "authorization_lost", "Peer execution authority ended", now);
      }
      return this.runs.getRun(runId)!;
    });
  }

  public poll(token: string, input: PeerRunPollRequest, now: string): PeerRunPollReceipt {
    if (!validatePeer("PeerRunPollRequest", input)) throw new PeerStoreError("INVALID_MESSAGE");
    return this.transactions.immediate(() => {
      const principal = this.admission.authenticateMachine(token, now), b = input.intent.binding;
      if (b.peerId !== principal.peerId || b.membershipId !== principal.membershipId || b.credentialId !== principal.credentialId ||
          !this.sessions.get(principal.peerId, now)?.matches(b, now)) throw new PeerStoreError("SCOPE_DENIED");
      this.verify(principal, input.proof, "run.poll", input.intent, now);
      const known = new Set<string>();
      for (const item of input.intent.knownRuns) {
        const request = this.requests.get(item.runId);
        if (!request || request.binding.peerId !== principal.peerId || known.has(item.runId) ||
            request.binding.requestDigest !== item.requestDigest) throw new PeerStoreError("PAYLOAD_CONFLICT");
        known.add(item.runId);
      }
      const candidates = this.database.prepare(`SELECT r.run_id FROM runs r
        JOIN peer_agent_projections p ON p.projection_agent_id = r.target_agent_id
        WHERE p.peer_id = ? AND r.state IN ('queued','delivered','working')
          ${known.size ? `AND r.run_id NOT IN (${Array.from(known, () => "?").join(",")})` : ""}
        ORDER BY r.created_at, r.run_id LIMIT 32`).all(principal.peerId, ...known) as Array<{ run_id: string }>;
      let delivery: PeerRunDelivery | null = null;
      for (const row of candidates) {
        try {
          const request = this.requests.freeze(row.run_id, now);
          this.requests.requireCurrent(request.binding, now);
          delivery = this.getOrCreate(row.run_id, now).delivery;
          break;
        } catch (error) {
          if (!(error instanceof PeerStoreError) || !["SCOPE_DENIED", "STALE_AUTHORIZATION", "UNSUPPORTED_CAPABILITY", "REVOKED", "EXPIRED"].includes(error.code)) throw error;
          this.cancelKnown(row.run_id, null, "authorization_lost", "Peer execution authority ended", now);
        }
      }
      const value = { schemaVersion: 1, intentDigest: peerDigest(input.intent), delivery };
      return { ...value, proof: this.receipt(input.proof, "run.poll", principal.participantNodeId, value, now) };
    });
  }

  private getOrCreate(runId: string, now: string) {
    const existing = this.database.prepare("SELECT * FROM peer_run_deliveries WHERE run_id = ?").get(runId) as DeliveryRow | undefined;
    if (existing) return this.decode(existing);
    const request = this.requests.get(runId);
    if (!request) throw new PeerStoreError("PAYLOAD_CONFLICT");
    this.requests.requireCurrent(request.binding, now);
    const metadata = { schemaVersion: 1, audience: "peer.settlement" as const, capabilityId: createOpaqueId("peersettle"),
      binding: request.binding, issuedAt: now, expiresAt: new Date(Date.parse(now) + peerSettlementMaximumSeconds * 1000).toISOString() };
    const token = this.authority.peerSecret("run-settlement", peerDigest({ capabilityId: metadata.capabilityId, binding: metadata.binding }));
    const delivery: PeerRunDelivery = { schemaVersion: 1, request, settlement: { ...metadata, token } };
    const receiptDigest = peerRunDeliveryReceiptDigest(delivery);
    // Bound before any response bytes. A crash after this commit is possibly
    // delivered regardless of whether the Participant received the response.
    this.database.prepare(`INSERT INTO peer_run_deliveries
      (run_id, capability_id, capability_json, token_hash, receipt_digest, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, metadata.capabilityId, json(metadata), peerSecretHash(token), receiptDigest, now, metadata.expiresAt);
    return { delivery, receiptDigest };
  }

  private decode(row: DeliveryRow) {
    const metadata = JSON.parse(row.capability_json) as Omit<PeerSettlementCapability, "token">;
    const request = this.requests.get(row.run_id);
    if (!request || metadata.capabilityId !== row.capability_id || metadata.issuedAt !== row.created_at || metadata.expiresAt !== row.expires_at) throw new PeerStoreError("PAYLOAD_CONFLICT");
    const token = this.authority.peerSecret("run-settlement", peerDigest({ capabilityId: metadata.capabilityId, binding: metadata.binding }));
    const delivery: PeerRunDelivery = { schemaVersion: 1, request, settlement: { ...metadata, token } };
    if (peerSecretHash(token) !== row.token_hash || peerRunDeliveryReceiptDigest(delivery) !== row.receipt_digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
    return { delivery, receiptDigest: row.receipt_digest };
  }

  public event(token: string, input: PeerRunEventRequest, now: string): PeerRunEventReceipt {
    if (!validatePeer("PeerRunEventRequest", input)) throw new PeerStoreError("INVALID_MESSAGE");
    return this.transactions.immediate(() => {
      const principal = this.admission.authenticateMachine(token, now), { proof, ...subject } = input;
      this.owns(principal, input.binding);
      this.verify(principal, proof, "run.event", subject, now);
      const row = this.database.prepare("SELECT * FROM peer_run_deliveries WHERE run_id = ? AND capability_id = ?")
        .get(input.binding.runId, input.capabilityId) as DeliveryRow | undefined;
      if (!row || row.expires_at <= now) throw new PeerStoreError("SCOPE_DENIED");
      const { delivery } = this.decode(row);
      if (peerDigest(delivery.request.binding) !== peerDigest(input.binding)) throw new PeerStoreError("PAYLOAD_CONFLICT");
      const digest = peerDigest(input.event);
      const prior = this.database.prepare("SELECT event_digest FROM peer_run_events WHERE run_id = ? AND sequence = ?")
        .get(row.run_id, input.event.sequence) as { event_digest: string } | undefined;
      if (prior) {
        if (prior.event_digest !== digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
        // A lost terminal acknowledgment may be reproduced without content or
        // renewing a capability. Current membership/Room/bilateral pins remain.
        this.requests.requireCurrent(input.binding, now, true);
      } else {
        this.requests.requireCurrent(input.binding, now);
        const run = this.runs.getRun(row.run_id)!;
        this.validateEvent(run, input.event, delivery);
        const event = this.sanitize(input.event);
        const applied = event.type === "reply" ? this.runs.applyReply(row.run_id, event, now) : this.runs.applyEvent(row.run_id, event, now);
        if (!applied.applied) throw new PeerStoreError("PAYLOAD_CONFLICT");
        this.database.prepare("INSERT INTO peer_run_events (run_id, sequence, event_digest, created_at) VALUES (?, ?, ?, ?)")
          .run(row.run_id, input.event.sequence, digest, now);
      }
      const value = { schemaVersion: 1, bindingDigest: peerDigest(input.binding), capabilityId: input.capabilityId,
        sequence: input.event.sequence, eventDigest: digest };
      return { ...value, proof: this.receipt(proof, "run.event", principal.participantNodeId, value, now) };
    });
  }

  private validateEvent(run: RunRecord, event: PeerRunEvent, delivery: PeerRunDelivery): void {
    if (event.sequence !== run.lastSequence + 1) throw new PeerStoreError("PAYLOAD_CONFLICT");
    if (event.type !== "status") {
      if (run.state !== "working" || event.type === "reply" && !event.content?.trim()) throw new PeerStoreError("STALE_AUTHORIZATION");
      if (event.type === "output") {
        const current = this.runs.listEvents(run.runId).reduce((text, row) => row.event.type === "reply" ? "" :
          row.event.type === "output" ? row.event.reset ? row.event.content : text + row.event.content : text, "");
        const next = (event.reset ? "" : current) + redactSensitiveText(event.content ?? "");
        if (exceedsUnicodeCodePointLimit(next, 20_000)) throw new PeerStoreError("INVALID_MESSAGE");
      }
      return;
    }
    if (event.status === "delivered" ? run.state !== "queued" : event.status === "working" ? !["delivered", "working"].includes(run.state) :
        !["delivered", "working"].includes(run.state) || event.status === "completed" && run.state !== "working") throw new PeerStoreError("STALE_AUTHORIZATION");
    if (event.session && (event.session.contextCursor !== delivery.request.payload.session.contextCursor ||
        event.session.resultEvidenceRevision !== undefined && event.session.resultEvidenceRevision !== delivery.request.payload.contextPlan?.resultEvidence?.revision)) {
      throw new PeerStoreError("PAYLOAD_CONFLICT");
    }
  }

  private sanitize(event: PeerRunEvent): RuntimeEvent {
    // The closed carrier excludes credentials, paths, provider session IDs,
    // arbitrary error details and private/governed envelopes. Redact public
    // text before either the Run event or its Room message is persisted.
    const clean = (value: unknown): unknown => typeof value === "string" ? redactSensitiveText(value) :
      Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ?
        Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clean(child)])) : value;
    return clean(event) as RuntimeEvent;
  }

  public settle(token: string, input: PeerRunSettlementRequest, now: string): PeerRunSettlementReceipt {
    if (!validatePeer("PeerRunSettlementRequest", input) || input.settlement.sequence !== 1) throw new PeerStoreError("INVALID_MESSAGE");
    return this.transactions.immediate(() => {
      const { proof, ...subject } = input, s = input.settlement;
      const row = this.database.prepare("SELECT * FROM peer_run_deliveries WHERE capability_id = ?").get(s.capabilityId) as DeliveryRow | undefined;
      if (!row || !timingSafeEqual(Buffer.from(peerSecretHash(token), "hex"), Buffer.from(row.token_hash, "hex"))) throw new PeerStoreError("UNAUTHENTICATED");
      if (row.expires_at <= now) throw new PeerStoreError("EXPIRED");
      const { delivery, receiptDigest } = this.decode(row), b = delivery.request.binding;
      if (s.bindingDigest !== peerDigest(b) || s.receiptDigest !== receiptDigest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      const peer = this.database.prepare("SELECT participant_node_id, participant_public_key FROM peer_bindings WHERE peer_id = ?")
        .get(b.peerId) as { participant_node_id: string; participant_public_key: string } | undefined;
      if (!peer || b.authorityNodeId !== this.authority.nodeId || peer.participant_node_id !== b.participantNodeId) throw new PeerStoreError("SCOPE_DENIED");
      verifyPeerProof(proof, { nodeId: peer.participant_node_id, publicKey: peer.participant_public_key }, {
        purpose: "run.settlement", audienceNodeId: this.authority.nodeId, operationId: proof.payload.operationId,
        nonce: proof.payload.nonce, subjectDigest: peerDigest(subject) }, now);
      const digest = peerDigest(s);
      const prior = this.database.prepare("SELECT settlement_digest FROM peer_run_settlements WHERE run_id = ?").get(row.run_id) as { settlement_digest: string } | undefined;
      if (prior) {
        if (prior.settlement_digest !== digest) throw new PeerStoreError("PAYLOAD_CONFLICT");
      } else {
        this.database.prepare("INSERT INTO peer_run_settlements (run_id, settlement_json, settlement_digest, created_at) VALUES (?, ?, ?, ?)")
          .run(row.run_id, json(s), digest, now);
        const run = this.runs.getRun(row.run_id)!;
        const cancellation = s.state === "delivery_denied" ? this.database.prepare(
          "SELECT cause FROM peer_run_cancellations WHERE run_id = ?"
        ).get(row.run_id) as { cause: string } | undefined : undefined;
        const status = s.state !== "delivery_denied" ? s.state :
          cancellation?.cause === "requester" ? "canceled" : cancellation?.cause === "deadline" ? "expired" : "failed";
        if (!terminal.has(run.state)) this.runs.applyEvent(row.run_id, { type: "status", sequence: run.lastSequence + 1,
          status }, now);
      }
      return { ...subject, proof: this.receipt(proof, "run.settlement", b.participantNodeId, subject, now) };
    });
  }

  public cancel(runId: string, memberId: string, reason: string, now: string): RunRecord {
    return this.transactions.immediate(() => this.cancelKnown(runId, memberId, "requester", reason, now));
  }

  private cancelKnown(runId: string, memberId: string | null, cause: "requester" | "authorization_lost" | "deadline", reason: string, now: string): RunRecord {
    const run = this.runs.getRun(runId), agent = run && this.core.getAgent(run.targetAgentId);
    if (!run || agent?.integrationMode !== "peer") throw new PeerStoreError("SCOPE_DENIED");
    if (terminal.has(run.state)) return run;
    const delivered = this.database.prepare("SELECT 1 FROM peer_run_deliveries WHERE run_id = ?").get(runId);
    if (!delivered || run.state === "input_required") {
      return this.runs.applyEvent(runId, { type: "status", sequence: run.lastSequence + 1,
        status: cause === "requester" ? "canceled" : cause === "deadline" ? "expired" : "failed" }, now).run;
    }
    this.database.prepare(`INSERT INTO peer_run_cancellations
      (run_id, requested_by_member_id, cause, reason, created_at, ack_deadline_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO NOTHING`).run(runId, memberId, cause, truncateUnicodeCodePoints(reason.trim(), 512) || "Peer execution canceled", now,
      new Date(Date.parse(now) + 30_000).toISOString());
    return run;
  }

  public sweep(now: string): string[] {
    return this.transactions.immediate(() => {
      const changed: string[] = [];
      const candidates = this.database.prepare(`SELECT r.run_id FROM runs r JOIN peer_run_requests p ON p.run_id = r.run_id
        WHERE r.state IN ('queued','delivered','working') ORDER BY r.created_at, r.run_id LIMIT 128`).all() as Array<{ run_id: string }>;
      for (const { run_id: runId } of candidates) {
        const run = this.runs.getRun(runId)!;
        const canceled = this.database.prepare("SELECT ack_deadline_at FROM peer_run_cancellations WHERE run_id = ?")
          .get(runId) as { ack_deadline_at: string } | undefined;
        if (canceled) {
          if (canceled.ack_deadline_at <= now) {
            this.runs.applyEvent(runId, { type: "status", sequence: run.lastSequence + 1, status: "outcome_unknown" }, now);
            changed.push(runId);
          }
          continue;
        }
        try { this.requests.requireCurrent(this.requests.get(runId)!.binding, now); }
        catch (error) {
          if (!(error instanceof PeerStoreError) || !["SCOPE_DENIED", "STALE_AUTHORIZATION", "UNSUPPORTED_CAPABILITY", "REVOKED", "EXPIRED"].includes(error.code)) throw error;
          this.cancelKnown(runId, null, run.deadlineAt <= now ? "deadline" : "authorization_lost", "Peer execution authority ended", now);
          changed.push(runId);
        }
      }
      return changed;
    });
  }

  private owns(principal: PeerPrincipal, b: PeerExecutionBinding) {
    if (b.peerId !== principal.peerId || b.authorityNodeId !== principal.hostNodeId || b.participantNodeId !== principal.participantNodeId ||
        b.teamId !== principal.scope.teamId) throw new PeerStoreError("SCOPE_DENIED");
  }
  private verify(principal: PeerPrincipal, proof: PeerProof, purpose: PeerProofPayload["purpose"], subject: unknown, now: string) {
    verifyPeerProof(proof, { nodeId: principal.participantNodeId, publicKey: principal.participantPublicKey }, {
      purpose, audienceNodeId: this.authority.nodeId, operationId: proof.payload.operationId, nonce: proof.payload.nonce, subjectDigest: peerDigest(subject) }, now);
  }
  private receipt(proof: PeerProof, purpose: PeerProofPayload["purpose"], audienceNodeId: string, subject: unknown, now: string) {
    return this.authority.signPeerProof({ purpose, audienceNodeId, operationId: proof.payload.operationId,
      nonce: proof.payload.nonce, subjectDigest: peerDigest(subject) }, now);
  }
}
