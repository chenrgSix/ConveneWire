import { createPublicKey, verify } from "node:crypto";
import type { PeerNodeIdentity, PeerProof, PeerProofPayload } from "@convene-wire/contracts/peer";
import { peerProofTimeValid, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { PeerStoreError } from "../data/peer-membership-repository.js";

/** TLS origin verification and signer pinning are independent requirements. */
export function verifyPeerProof(proof: PeerProof, signer: PeerNodeIdentity,
  expected: Pick<PeerProofPayload, "purpose" | "audienceNodeId" | "operationId" | "nonce" | "subjectDigest">, now: string): void {
  if (!validatePeer("PeerProof", proof) || !peerProofTimeValid(proof.payload, Date.parse(now))) throw new PeerStoreError("STALE_AUTHORIZATION");
  const p = proof.payload;
  if (p.signerNodeId !== signer.nodeId || p.signerPublicKey !== signer.publicKey ||
      p.purpose !== expected.purpose || p.audienceNodeId !== expected.audienceNodeId ||
      p.operationId !== expected.operationId || p.nonce !== expected.nonce || p.subjectDigest !== expected.subjectDigest) throw new PeerStoreError("UNAUTHENTICATED");
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(signer.publicKey, "base64url")]), format: "der", type: "spki" });
  if (!verify(null, peerProofTranscript(p), key, Buffer.from(proof.signature, "base64url"))) throw new PeerStoreError("UNAUTHENTICATED");
}

export function assertPeerOrigin(origin: string): void {
  let value: URL;
  try { value = new URL(origin); } catch { throw new PeerStoreError("SCOPE_DENIED"); }
  if (value.origin !== origin || value.username || value.password ||
      (value.protocol !== "https:" && !(value.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname)))) throw new PeerStoreError("SCOPE_DENIED");
}
