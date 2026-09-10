import { randomBytes } from "node:crypto";
import type { PeerRuntimeBinding, PeerRuntimeChallenge, PeerRuntimeMessage } from "@convene-wire/contracts/peer";
import { decodePeer, validatePeer } from "@convene-wire/contracts/peer-validation";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { PeerStoreError } from "../data/peer-membership-repository.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { AuthorityService } from "../security/authority-service.js";
import type { PeerAdmissionService, PeerPrincipal } from "../security/peer-admission-service.js";
import { assertPeerOrigin, verifyPeerProof } from "../security/peer-proof-verifier.js";

type Frame = Extract<PeerRuntimeMessage, { protocolVersion: "peer.v1" }>;
interface Transport { send(frame: string): void; close(): void }

/** Separate machine-session registry. No Device registry, human session or Run
 * execution authority is created by a successful handshake. */
export class PeerRuntimeSessions {
  private readonly all = new Set<PeerRuntimeSession>();
  private readonly active = new Map<string, PeerRuntimeSession>();
  private readonly counts = new Map<string, number>();
  private stopped = false;

  public constructor(private readonly admission: PeerAdmissionService, private readonly authority: AuthorityService) {}

  public open(token: string, transport: Transport, now: string): PeerRuntimeSession {
    if (this.stopped || this.all.size >= 128) throw new PeerStoreError("SCOPE_DENIED");
    assertPeerOrigin(this.admission.hostOrigin);
    const principal = this.admission.authenticateMachine(token, now);
    if ((this.counts.get(principal.peerId) ?? 0) >= 2) throw new PeerStoreError("SCOPE_DENIED");
    const session = new PeerRuntimeSession(this.admission, this.authority, token, principal, transport, now,
      current => {
        const old = this.active.get(principal.peerId);
        this.active.set(principal.peerId, current);
        if (old && old !== current) old.close();
      }, current => {
        this.all.delete(current);
        const remaining = (this.counts.get(principal.peerId) ?? 1) - 1;
        if (remaining > 0) this.counts.set(principal.peerId, remaining);
        else this.counts.delete(principal.peerId);
        if (this.active.get(principal.peerId) === current) this.active.delete(principal.peerId);
      });
    this.all.add(session);
    this.counts.set(principal.peerId, (this.counts.get(principal.peerId) ?? 0) + 1);
    return session;
  }

  public get(peerId: string, now: string): PeerRuntimeSession | undefined {
    const session = this.active.get(peerId);
    if (session && session.check(now)) return session;
    return undefined;
  }

  public sweep(now: string): void { for (const session of this.all) session.check(now); }
  public close(): void {
    this.stopped = true;
    for (const session of this.all) session.close();
  }
}

export class PeerRuntimeSession {
  private readonly binding: PeerRuntimeBinding;
  private readonly bindingDigest: string;
  private readonly nonce = randomBytes(32).toString("base64url");
  private readonly deadline: number;
  private phase: "pending" | "active" | "closed" = "pending";
  private sequence = 0;
  private lastSeen: number;

  public constructor(private readonly admission: PeerAdmissionService, private readonly authority: AuthorityService,
    private readonly token: string, private readonly principal: PeerPrincipal, private readonly transport: Transport, now: string,
    private readonly activate: (session: PeerRuntimeSession) => void, private readonly remove: (session: PeerRuntimeSession) => void) {
    if (principal.hostNodeId !== authority.nodeId) throw new PeerStoreError("UNAUTHENTICATED");
    this.binding = { schemaVersion: 1, connectionId: createOpaqueId("peerconnection"), operationId: createOpaqueId("op"),
      host: { nodeId: authority.nodeId, publicKey: authority.publicKey },
      participant: { nodeId: principal.participantNodeId, publicKey: principal.participantPublicKey }, hostOrigin: admission.hostOrigin,
      peerId: principal.peerId, membershipId: principal.membershipId, credentialId: principal.credentialId,
      teamId: principal.scope.teamId, memberId: principal.memberId };
    if (!validatePeer("PeerRuntimeBinding", this.binding)) throw new PeerStoreError("INVALID_MESSAGE");
    this.bindingDigest = peerDigest(this.binding);
    this.lastSeen = Date.parse(now);
    this.deadline = this.lastSeen + 30_000;
  }

  public challenge(now: string): Frame {
    if (this.phase !== "pending" || !this.check(now)) throw new PeerStoreError("UNAUTHENTICATED");
    const payload: PeerRuntimeChallenge = { schemaVersion: 1, binding: structuredClone(this.binding), nonce: this.nonce, proof: this.proof("challenge", now) };
    return this.frame("peer.runtime.challenge", payload, now);
  }

  public receive(bytes: Uint8Array, now: string): void {
    try {
      if (bytes.byteLength > 32 * 1024 || !this.check(now)) throw new PeerStoreError("INVALID_MESSAGE");
      const message = decodePeer("PeerRuntimeMessage", bytes) as Frame;
      if (this.phase === "pending") {
        if (message.type !== "peer.runtime.authenticate" || message.payload.bindingDigest !== this.bindingDigest || !message.payload.proof) throw new PeerStoreError("UNAUTHENTICATED");
        verifyPeerProof(message.payload.proof, this.binding.participant, { purpose: "peer.connect", audienceNodeId: this.binding.host.nodeId,
          operationId: this.binding.operationId, nonce: this.nonce, subjectDigest: peerDigest({ phase: "authenticate", binding: this.binding }) }, now);
        if (!this.check(now)) throw new PeerStoreError("UNAUTHENTICATED");
        this.phase = "active";
        this.lastSeen = Date.parse(now);
        this.activate(this);
        this.transport.send(JSON.stringify(this.frame("peer.runtime.ready", {
          schemaVersion: 1, bindingDigest: this.bindingDigest, proof: this.proof("ready", now)
        }, now)));
        return;
      }
      if (message.type !== "peer.runtime.heartbeat" || message.payload.bindingDigest !== this.bindingDigest || message.payload.sequence !== this.sequence + 1) {
        throw new PeerStoreError("INVALID_MESSAGE");
      }
      this.sequence = message.payload.sequence;
      this.lastSeen = Date.parse(now);
      this.transport.send(JSON.stringify(this.frame("peer.runtime.acknowledged", message.payload, now)));
    } catch (error) {
      this.close();
      throw error;
    }
  }

  // Call before every subsequent operation. Socket liveness never substitutes
  // for the current credential/member ceiling or a fresh Run admission.
  public check(now: string): boolean {
    if (this.phase === "closed") return false;
    try {
      const time = Date.parse(now);
      if (!Number.isFinite(time) || (this.phase === "pending" ? time >= this.deadline : time - this.lastSeen >= 20_000)) throw new PeerStoreError("EXPIRED");
      const current = this.admission.authenticateMachine(this.token, now);
      if (peerDigest(current) !== peerDigest(this.principal)) throw new PeerStoreError("STALE_AUTHORIZATION");
      return true;
    } catch {
      this.close();
      return false;
    }
  }

  public matches(binding: PeerRuntimeBinding, now: string): boolean {
    return this.phase === "active" && this.check(now) && peerDigest(binding) === this.bindingDigest;
  }

  public close(): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.remove(this);
    this.transport.close();
  }

  private proof(phase: "challenge" | "ready", now: string) {
    return this.authority.signPeerProof({ purpose: "peer.connect", audienceNodeId: this.binding.participant.nodeId,
      operationId: this.binding.operationId, nonce: this.nonce, subjectDigest: peerDigest({ phase, binding: this.binding }) }, now);
  }

  private frame(type: Frame["type"], payload: unknown, now: string): Frame {
    const message = { protocolVersion: "peer.v1", messageId: createOpaqueId("msg"), timestamp: now, type, payload };
    if (!validatePeer("PeerRuntimeMessage", message)) throw new PeerStoreError("INVALID_MESSAGE");
    return message as Frame;
  }
}
