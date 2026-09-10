import { createServer } from "node:net";
import https from "node:https";
import { readFile } from "node:fs/promises";
import { createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import path from "node:path";
import type { TestContext } from "node:test";
import type { IncomingHttpHeaders } from "node:http";
import type { PeerInvitationClaim, PeerJoined, PeerProofPayload, PeerScope } from "@convene-wire/contracts/peer";
import { peerDigest, peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { createTestResources } from "../../../../scripts/test/resources.mjs";
import { createServerApp } from "../../src/app.js";
import { PeerIngress } from "../../src/local-node/peer-ingress.js";
import { peerClaimDigest } from "../../src/data/peer-membership-repository.js";
import { peerHumanEntryIntent } from "../../src/security/peer-human-entry-service.js";

export const ingressSecret = () => randomBytes(32).toString("base64url");
export async function freeIngressPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture address missing");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export async function nativePeerIngressFixture(t: TestContext, options: { webRoot?: string } = {}) {
  const resources = await createTestResources(t, "convenewire-native-peer-ingress-");
  const localPort = await freeIngressPort();
  let peerPort = await freeIngressPort();
  while (peerPort === localPort) peerPort = await freeIngressPort();
  const origin = `https://127.0.0.1:${peerPort}`, localOrigin = `http://127.0.0.1:${localPort}`;
  const cert = await readFile(new URL("../fixtures/peer-ingress/server-cert.pem", import.meta.url));
  const key = await readFile(new URL("../fixtures/peer-ingress/server-key.pem", import.meta.url));
  const ingress = new PeerIngress({ configuration: { schemaVersion: 1, enabled: true, origin, listenHost: "127.0.0.1",
    certificateFile: "server-cert.pem", privateKeyFile: "server-key.pem" }, tls: { cert, key } });
  const launch = { schemaVersion: 1 as const, controlToken: ingressSecret(), identity: { schemaVersion: 1 as const,
    nodeId: `node_${ingressSecret()}`, ownerUserId: `user_${ingressSecret()}`, port: localPort, secret: ingressSecret() } };
  const now = new Date().toISOString();
  const databasePath = path.join(resources.directory, "hub.sqlite");
  const app = await createServerApp({ databasePath, localNode: launch,
    peerIngress: ingress, clock: () => now, ...options });
  resources.defer(() => app.close());
  await app.listen({ host: "127.0.0.1", port: localPort });
  await ingress.listen(app.server);
  const host = new URL(localOrigin).host;
  const entry = await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers: { host, "x-convenewire-node-control": launch.controlToken } });
  const ticket = (entry.json().url as string).split("/").at(-1)!;
  const owner = (await app.inject({ method: "POST", url: "/api/local-node/session", headers: { host, origin: localOrigin }, payload: { ticket } })).json();
  const ownerHeaders = { host, origin: localOrigin, authorization: `Bearer ${owner.session.token}` };
  const team = (await app.inject({ method: "POST", url: "/api/teams", headers: ownerHeaders, payload: { name: "Native Host" } })).json().team;
  const room = (await app.inject({ method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: { name: "Invited Room" } })).json();
  const otherRoom = (await app.inject({ method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: { name: "Uninvited Room" } })).json();
  const request = (url: string, options: { method?: string; headers?: Record<string, string>; payload?: unknown; trust?: boolean } = {}) =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; body: string; json: () => any }>((resolve, reject) => {
      const content = options.payload === undefined ? undefined : JSON.stringify(options.payload);
      const req = https.request(origin, { path: url, method: options.method ?? "GET", agent: false,
        ...(options.trust === false ? {} : { ca: cert }), headers: { ...(content ? { "content-type": "application/json" } : {}), ...options.headers } }, response => {
        const bytes: Buffer[] = [];
        response.on("data", chunk => bytes.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.once("end", () => { const body = Buffer.concat(bytes).toString(); resolve({ status: response.statusCode!, headers: response.headers, body, json: () => JSON.parse(body) }); });
      });
      req.once("error", reject); req.setTimeout(10_000, () => req.destroy(new Error("fixture request timed out"))); req.end(content);
    });
  const privateKey = generateKeyPairSync("ed25519").privateKey;
  const participant = { nodeId: "node_nativeguest001", publicKey: createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64url") };
  const proof = (purpose: PeerProofPayload["purpose"], operationId: string, nonce: string, subjectDigest: string) => {
    const payload: PeerProofPayload = { schemaVersion: 1, purpose, operationId, nonce, subjectDigest,
      signerNodeId: participant.nodeId, signerPublicKey: participant.publicKey, audienceNodeId: launch.identity.nodeId,
      issuedAt: now, expiresAt: new Date(Date.parse(now) + 30_000).toISOString() };
    return { payload, signature: sign(null, peerProofTranscript(payload), privateKey).toString("base64url") };
  };
  const join = async () => {
    const scope: PeerScope = { kind: "room", teamId: team.teamId, roomId: room.roomId };
    const invitation = (await app.inject({ method: "POST", url: "/api/peer/invitations", headers: ownerHeaders, payload: {
      schemaVersion: 1, operationId: "op_nativeinvite001", scope,
      expiresAt: new Date(Date.parse(now) + 3600_000).toISOString(), membershipExpiresAt: new Date(Date.parse(now) + 24*3600_000).toISOString() } })).json();
    const intent = { schemaVersion: 1 as const, invitationId: invitation.invitation.invitationId, invitationDigest: peerDigest(invitation.invitation),
      secret: invitation.secret, participant, operationId: "op_nativejoin001", localUserId: "user_nativeguest001", displayName: "Invited Guest" };
    const digest = peerClaimDigest(intent as PeerInvitationClaim);
    const challenge = (await request("/api/peer/invitations/challenge", { method: "POST", payload: { schemaVersion: 1,
      invitationId: intent.invitationId, secret: intent.secret, participant, operationId: intent.operationId, subjectDigest: digest } })).json();
    const response = await request("/api/peer/invitations/claim", { method: "POST", payload: { ...intent,
      challengeId: challenge.challengeId, proof: proof("invitation.claim", intent.operationId, challenge.nonce, digest) } });
    if (response.status !== 200) throw new Error(`fixture Peer join failed: ${response.body}`);
    const joined = response.json() as PeerJoined;
    const binding = joined.human.humanCredential;
    const input = { schemaVersion: 1 as const, operationId: "op_nativehuman001", bindingCredentialId: binding.credentialId,
      bindingToken: binding.token, scope, nonce: ingressSecret() };
    const human = await request("/api/peer/human-entry", { method: "POST", payload: { ...input,
      proof: proof("human.entry", input.operationId, input.nonce, peerHumanEntryIntent(input)) } });
    if (human.status !== 200) throw new Error(`fixture human entry failed: ${human.body}`);
    const credential = human.json().credential;
    const browser = { schemaVersion: 1, credentialId: credential.credentialId, token: credential.token };
    return { joined, browser, scope, invitation };
  };
  return { app, ingress, launch, databasePath, origin, localOrigin, localPort, peerPort, cert, key, request, owner, ownerHeaders, team, room, otherRoom, now, join, proof };
}
