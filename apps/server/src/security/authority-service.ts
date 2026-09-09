import { createHash, createHmac, createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";
import type Database from "better-sqlite3";
import type { AuthorityProof, AuthorityProofPayload } from "@convene-wire/contracts/authority";
import { authorityProofTranscript, authorityProofLifetimeSeconds } from "@convene-wire/contracts/authority-proof";
import schema from "@convene-wire/contracts/authority-schema" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";
import type { LocalNodeLaunch } from "@convene-wire/contracts/local-node";
import type { DevicePrincipal } from "./auth-service.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { PeerProof, PeerProofPayload } from "@convene-wire/contracts/peer";
import { peerProofTranscript, peerProofLifetimeSeconds } from "@convene-wire/contracts/peer-proof";

const validator = new Ajv2020({ strict: true }).addSchema(schema);
const validRequest = validator.getSchema(`${schema.$id}#/$defs/AuthorityProofRequest`)!;
const validPayload = validator.getSchema(`${schema.$id}#/$defs/AuthorityProofPayload`)!;
interface Identity { node_id: string; seed_hex: string | null; public_key: string | null; kind: "unbound" | "central" | "local" }

/** Stable Node signer. Callers must establish the authority represented by a proof. */
export class AuthorityService {
  public readonly nodeId: string;
  public readonly publicKey: string;
  private readonly key: KeyObject;

  public constructor(database: Database.Database, public readonly browserOrigin: string, local?: LocalNodeLaunch) {
    const identity = database.transaction(() => {
      let row = database.prepare("SELECT * FROM authority_identity WHERE singleton = 1").get() as Identity | undefined;
      if (!row) throw new Error("Authority identity is missing; restore the original identity");
      const localSeed = local && createHash("sha256").update("convenewire.authority.local-seed.v1\0").update(local.identity.secret).digest("hex");
      const seed = localSeed ?? row.seed_hex;
      if (!seed || !/^[0-9a-f]{64}$/u.test(seed)) throw new Error("Authority signing identity is unavailable");
      const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed, "hex")]), format: "der", type: "pkcs8" });
      const publicKey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
      const kind = local ? "local" : "central";
      if (row.kind === "unbound") {
        database.prepare("UPDATE authority_identity SET node_id = ?, seed_hex = ?, public_key = ?, kind = ? WHERE singleton = 1")
          .run(local?.identity.nodeId ?? row.node_id, local ? null : seed, publicKey, kind);
        row = database.prepare("SELECT * FROM authority_identity WHERE singleton = 1").get() as Identity;
      }
      if (row.kind !== kind || row.public_key !== publicKey || (local && row.node_id !== local.identity.nodeId) ||
          !/^node_[A-Za-z0-9_-]{8,128}$/u.test(row.node_id)) throw new Error("Authority identity does not match its installation");
      return { nodeId: row.node_id, publicKey, key };
    }).immediate();
    this.nodeId = identity.nodeId; this.publicKey = identity.publicKey; this.key = identity.key;
  }

  public describe() { return { authorityNodeId: this.nodeId, publicKey: this.publicKey, browserOrigin: this.browserOrigin }; }

  public signPeerProof(context: Pick<PeerProofPayload, "purpose" | "audienceNodeId" | "operationId" | "nonce" | "subjectDigest">, now: string): PeerProof {
    const payload: PeerProofPayload = {
      schemaVersion: 1, ...context, signerNodeId: this.nodeId, signerPublicKey: this.publicKey,
      issuedAt: now, expiresAt: new Date(Date.parse(now) + peerProofLifetimeSeconds * 1000).toISOString()
    };
    return { payload, signature: sign(null, peerProofTranscript(payload), this.key).toString("base64url") };
  }

  /** Reproduce a lost response without storing secrets or granting a new credential. */
  public peerSecret(domain: "invitation" | "runtime" | "human-binding" | "human-entry", intentDigest: string): string {
    if (!/^[a-f0-9]{64}$/u.test(intentDigest)) throw new Error("Invalid Peer intent digest");
    return createHmac("sha256", this.key.export({ format: "der", type: "pkcs8" }))
      .update(`convenewire.peer.secret.v1\0${domain}\0${this.nodeId}\0${intentDigest}`).digest("base64url");
  }

  public prove(actor: DevicePrincipal, input: unknown, now: string): AuthorityProof {
    if (!validRequest(input)) throw new Error("Invalid Authority proof request");
    const payload: AuthorityProofPayload = {
      ...this.describe(), teamId: actor.teamId, deviceId: actor.deviceId, ownerMemberId: actor.ownerMemberId,
      nonce: (input as { nonce: string }).nonce, issuedAt: now,
      expiresAt: new Date(Date.parse(now) + authorityProofLifetimeSeconds * 1000).toISOString(), signature: ""
    };
    payload.signature = sign(null, authorityProofTranscript(payload), this.key).toString("base64url");
    if (!validPayload(payload)) throw new Error("Authority proof context is invalid");
    return { protocolVersion: "1.0", messageId: createOpaqueId("msg"), timestamp: now, type: "authority.proof", payload };
  }
}
