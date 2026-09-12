import { createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { request, type Agent } from "node:https";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { PeerIdentityProof } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { decodePeer, validatePeer } from "@convene-wire/contracts/peer-validation";
import { verifyPeerProof } from "../security/peer-proof-verifier.js";
import { PeerIngress } from "./peer-ingress.js";
import { RelayConnector } from "./relay-connector.js";
import { RelayCertificates } from "./relay-certificates.js";
import type { RelayRunning, RelaySaved } from "./relay-settings.js";

export interface RelayRuntimeOptions { agent?: Agent; clock?: () => number; retryMilliseconds?: number }

/** The native Hub owns all tunnel/certificate activity under its existing lease. */
export class RelayRuntime {
  public readonly ingress: PeerIngress;
  private readonly certificates: RelayCertificates;
  private readonly connector: RelayConnector;
  private readonly abort = new AbortController();
  private wake = new AbortController();
  private readonly identity: {nodeId: string; publicKey: string};
  private readonly clock: () => number;
  private worker?: Promise<void>;
  private closing?: Promise<void>;
  private certificateBusy = false;
  private errorCode: string | null = null;
  private verifiedAt = 0;
  private invalidCertificateState = false;

  public constructor(root: string, private readonly configuration: RelaySaved, nodeId: string,
    privateKey: KeyObject, private readonly options: RelayRuntimeOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.identity = {nodeId, publicKey: createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32).toString("base64url")};
    this.certificates = new RelayCertificates(path.join(root, "relay"), configuration.profile, new URL(configuration.origin).hostname,
      {...(options.agent ? {httpsAgent: options.agent} : {}), clock: this.clock});
    this.ingress = new PeerIngress({configuration: {schemaVersion: 1, enabled: true, origin: configuration.origin,
      listenHost: "127.0.0.1", certificateFile: "relay-certificate.pem", privateKeyFile: "relay-private-key.pem"}},
      {context: () => this.certificates.context(), ready: () => this.status().state === "ready"});
    this.connector = new RelayConnector({profile: configuration.profile,
      signer: {...this.identity, sign: bytes => sign(null, bytes, privateKey).toString("base64url")},
      acceptTLS: stream => this.ingress.acceptTunnel(stream), acceptHTTP01: stream => this.certificates.acceptChallenge(stream),
      connectionChanged: () => { this.verifiedAt = 0; this.wake.abort(); this.wake = new AbortController(); }, ...(options.agent ? {agent: options.agent} : {}),
      ...(options.retryMilliseconds ? {retryMilliseconds: options.retryMilliseconds} : {})});
  }
  public async initialize(): Promise<void> {
    try { await this.certificates.load(); }
    catch { this.invalidCertificateState = true; this.errorCode = "CERTIFICATE_STATE_INVALID"; }
  }
  public start(): void {
    if (this.worker || this.abort.signal.aborted || this.invalidCertificateState) return;
    this.connector.start(); this.worker = this.run();
  }
  public status(): RelayRunning {
    const origin = this.configuration.origin, certificateExpiresAt = this.certificates.expiresAt();
    let state: RelayRunning["state"];
    if (this.abort.signal.aborted) state = "disabled";
    else if (this.invalidCertificateState) state = "unavailable";
    else if (!this.connector.isConnected()) state = this.errorCode ? "retrying" : "connecting";
    else if (this.certificates.context() && this.verifiedAt > this.clock() - 60_000) state = "ready";
    else if (this.certificateBusy) state = "issuing_certificate";
    else state = this.errorCode ? "unavailable" : "connecting";
    return {state, origin, errorCode: this.errorCode, certificateExpiresAt};
  }
  public close(): Promise<void> {
    return this.closing ??= (async () => {
      this.abort.abort(); this.verifiedAt = 0;
      await this.connector.close(); await this.worker; await this.certificates.close();
    })();
  }
  private async run(): Promise<void> {
    const signal = this.abort.signal;
    while (!signal.aborted) {
      let wait = 1000;
      try {
        if (this.connector.isConnected()) {
          this.certificateBusy = !this.certificates.context();
          try { await this.certificates.ensure(signal); this.errorCode = null; }
          catch { this.errorCode = "CERTIFICATE_RETRY"; }
          finally { this.certificateBusy = false; }
          signal.throwIfAborted();
          if (this.certificates.context()) {
            await this.probe(signal);
            if (this.connector.isConnected()) this.verifiedAt = this.clock();
            wait = 20_000;
          } else wait = 5000;
        }
      } catch {
        this.verifiedAt = 0;
        if (!signal.aborted) this.errorCode = "PUBLIC_ROUTE_UNAVAILABLE";
        wait = 5000;
      }
      try { await delay(wait === 20_000 ? wait : this.options.retryMilliseconds ?? wait, undefined, {signal: AbortSignal.any([signal, this.wake.signal])}); }
      catch { if (signal.aborted) break; }
    }
  }
  private async probe(signal: AbortSignal): Promise<void> {
    const operationId = `op_${randomBytes(16).toString("base64url")}`, nonce = randomBytes(32).toString("base64url");
    const body = Buffer.from(JSON.stringify({schemaVersion: 1, participant: this.identity, operationId, nonce}));
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = request(new URL("/api/peer/identity", this.configuration.origin), {method: "POST", agent: this.options.agent,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), rejectUnauthorized: true,
        headers: {"content-type": "application/json", "content-length": body.length}, maxHeaderSize: 16 * 1024}, response => {
        const chunks: Buffer[] = []; let length = 0;
        response.on("error", reject);
        response.on("data", (bytes: Buffer) => {
          length += bytes.length;
          if (length > 32 * 1024) response.destroy(new Error("Relay probe response exceeded its limit")); else chunks.push(bytes);
        });
        response.on("end", () => {
          try {
            if (response.statusCode !== 200) throw new Error("Relay route is unavailable");
            resolve(decodePeer("PeerIdentityProof", Buffer.concat(chunks)));
          } catch (error) { reject(error); }
        });
      });
      req.on("error", reject); req.end(body);
    });
    if (!validatePeer("PeerIdentityProof", value)) throw new Error("Invalid Relay route identity");
    const proof = value as PeerIdentityProof;
    if (proof.hostOrigin !== this.configuration.origin || peerDigest(proof.host) !== peerDigest(this.identity)) throw new Error("Relay route points to a different Node");
    verifyPeerProof(proof.proof, this.identity, {purpose: "node.identity", audienceNodeId: this.identity.nodeId, operationId, nonce,
      subjectDigest: peerDigest({host: this.identity, hostOrigin: this.configuration.origin})}, new Date(this.clock()).toISOString());
  }
}
