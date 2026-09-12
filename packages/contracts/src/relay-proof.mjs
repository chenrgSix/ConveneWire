import { createHash } from "node:crypto";
import { validatePeer } from "./peer-validation.mjs";

/** A Relay address is independent of Peer business grants and reconnect epochs. */
export function relayHostname(publicKey, nodeDomain) {
  if (typeof publicKey !== "string" || publicKey.length !== 43 ||
      !validatePeer("PeerNodeIdentity", { nodeId: "node_relaykey", publicKey }) ||
      !validatePeer("RelayNodeDomain", nodeDomain)) throw new Error("Invalid Relay identity or domain");
  const raw = Buffer.from(publicKey, "base64url");
  return `n${createHash("sha256").update(raw).digest("hex").slice(0, 40)}.${nodeDomain}`;
}

/** Exact UTF-8 bytes; never normalize an origin or key while signing. */
export function relayRegistrationTranscript(relayOrigin, nodeDomain, nonce, nodeId, publicKey) {
  if (!validatePeer("RelayHTTPSOrigin", relayOrigin) || !validatePeer("RelayNodeDomain", nodeDomain) ||
      typeof nodeId !== "string" || /[\u0000-\u001f\u007f]/u.test(nodeId) ||
      typeof publicKey !== "string" || publicKey.length !== 43 || typeof nonce !== "string" || nonce.length !== 43 ||
      !validatePeer("PeerNodeIdentity", { nodeId, publicKey }) ||
      !validatePeer("PeerNodeIdentity", { nodeId, publicKey: nonce })) {
    throw new Error("Invalid Relay registration transcript");
  }
  return Buffer.from(`convenewire.relay.register.v1\n${relayOrigin}\n${nodeDomain}\n${nonce}\n${nodeId}\n${publicKey}\n`, "utf8");
}
