/** Disposable TLS facade over the real Server for Go/Node Peer interoperability tests. */
import https from "node:https";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createServerApp } from "../../src/app.js";
import { openDatabase } from "../../src/data/database.js";
import { CoreRepository } from "../../src/data/core-repository.js";
import { AuthService } from "../../src/security/auth-service.js";
import { AuthorityService } from "../../src/security/authority-service.js";
import { PeerAdmissionService } from "../../src/security/peer-admission-service.js";
import { PeerAgentService } from "../../src/registry/peer-agent-service.js";
import { peerDigest } from "@convene-wire/contracts/peer-proof";

const [directory, certFile, keyFile, initialNow] = process.argv.slice(2) as [string, string, string, string];
if (!directory || !certFile || !keyFile || !initialNow) throw new Error("fixture arguments required");
let now = initialNow, dropNextClaim = true, dropNextOffer = true, dropNextSync = true, dropNextLeave = true, previewRequests = 0, runtimeUpgrades = 0;
let app: Awaited<ReturnType<typeof createServerApp>> | undefined;
const listener = https.createServer({ cert: await readFile(certFile), key: await readFile(keyFile) }, async (request, response) => {
  try {
    if (!app) { response.writeHead(503).end(); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      const maximum = request.url === "/api/peer/agents/sync" ? 1024 * 1024 : 16 * 1024;
      if (size > maximum) { response.writeHead(413).end(); return; }
      chunks.push(bytes);
    }
    if (request.url === "/api/peer/invitations/preview") previewRequests++;
    const result = await app.inject({ method: request.method as "POST", url: request.url!, headers: request.headers, payload: Buffer.concat(chunks) });
    if (request.url === "/api/peer/invitations/claim" && result.statusCode === 200 && dropNextClaim) {
      dropNextClaim = false;
      request.socket.destroy(); // Commit succeeded; the Participant receives no receipt.
      return;
    }
    if (request.url === "/api/peer/agents/offers" && result.statusCode === 200 && dropNextOffer) {
      dropNextOffer = false;
      request.socket.destroy();
      return;
    }
    if (request.url === "/api/peer/agents/sync" && result.statusCode === 200 && dropNextSync) {
      dropNextSync = false;
      request.socket.destroy();
      return;
    }
    if (request.url === "/api/peer/memberships/leave" && result.statusCode === 200 && dropNextLeave) {
      dropNextLeave = false;
      request.socket.destroy();
      return;
    }
    response.writeHead(result.statusCode, result.headers as Record<string, string>);
    response.end(result.rawPayload);
  } catch { response.writeHead(500).end(); }
});
listener.on("upgrade", (request, socket, head) => {
  if (!app) { socket.destroy(); return; }
  runtimeUpgrades++;
  app.server.emit("upgrade", request, socket, head);
});
await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const address = listener.address();
if (!address || typeof address === "string") throw new Error("fixture listener address");
const origin = `https://127.0.0.1:${address.port}`;
const databasePath = path.join(directory, "host.sqlite");
app = await createServerApp({ databasePath, logger: false, clock: () => now,
  webAuth: { mode: "trusted-team", publicOrigin: origin, ownerRecoveryToken: "peer-local-fixture-owner-0123456789" } });
await app.ready();
const database = openDatabase(databasePath);
const core = new CoreRepository(database), auth = new AuthService(database, () => now);
const authority = new AuthorityService(database, origin), peers = new PeerAdmissionService(database, auth, authority);
const agents = new PeerAgentService(database, auth, authority, peers);
const ownerId = "user_tlsowner001", memberId = "member_tlsowner001", teamId = "team_tlsfixture001", roomId = "room_tlsinvited001";
core.createUser({ userId: ownerId, displayName: "Fixture Owner", createdAt: now });
core.createTeamWithOwner({ teamId, name: "TLS Host Team", createdAt: now }, { memberId, userId: ownerId, teamId, displayName: "Fixture Owner", role: "owner", createdAt: now });
core.createRoom({ roomId, teamId, name: "Invited Room", createdAt: now });
const expiry = new Date(Date.parse(now) + 24 * 3600_000).toISOString();
const session = auth.issueWebSession(ownerId, now, expiry), owner = auth.authenticateWebSession(session.secret, now);
const invitation = peers.createInvitation(owner, { schemaVersion: 1, operationId: "op_tlsfixtureinvite001", scope: { kind: "room", teamId, roomId },
  expiresAt: new Date(Date.parse(now) + 3600_000).toISOString(), membershipExpiresAt: expiry }, now);
process.stdout.write(JSON.stringify({ origin, host: invitation.invitation.host, invitation: invitation.invitation, secret: invitation.secret }) + "\n");
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const command = JSON.parse(line) as { action: string; membershipId?: string; now?: string };
    if (command.action === "stop") break;
    if (command.action === "clock") now = command.now!;
    else if (command.action === "revoke") peers.revokeMembership(owner, command.membershipId!, now);
    else if (command.action === "accept-agent") {
      const offered = agents.listOffers(owner, teamId)[0]!;
      const grant = offered.offer.grant;
      const sequence = (database.prepare("SELECT count(*) AS n FROM peer_agent_operations").get() as { n: number }).n + 1;
      agents.accept(owner, { schemaVersion: 1, operationId: `op_tlsacceptagent${sequence}`, peerId: grant.peerId,
        localAgentId: grant.localAgentId, exportId: grant.exportId, grantRevision: grant.revision, grantDigest: peerDigest(grant),
        offerDigest: offered.offerDigest, roomIds: grant.roomIds, capabilities: grant.capabilities, expiresAt: grant.expiresAt,
        expectedAcceptanceId: offered.acceptance?.acceptanceId ?? null, expectedAcceptanceRevision: offered.acceptance?.revision ?? null }, now);
    }
    else if (command.action === "revoke-agent") {
      const current = agents.listOffers(owner, teamId)[0]!.acceptance!;
      agents.revoke(owner, { schemaVersion: 1, operationId: "op_tlsrevokeagent001",
        acceptanceId: current.acceptanceId, expectedRevision: current.revision }, now);
    }
    const counts = database.prepare("SELECT count(*) AS memberships FROM peer_memberships").get();
    const offers = (database.prepare("SELECT count(*) AS n FROM peer_agent_offers").get() as { n: number }).n;
    const acceptances = (database.prepare("SELECT count(*) AS n FROM peer_acceptance_revisions").get() as { n: number }).n;
    const enabledPeers = (database.prepare("SELECT count(*) AS n FROM agents WHERE integration_mode = 'peer' AND enabled = 1").get() as { n: number }).n;
    const departures = (database.prepare("SELECT count(*) AS n FROM peer_departures").get() as { n: number }).n;
    process.stdout.write(JSON.stringify({ ...counts as object, previewRequests, runtimeUpgrades, offers, acceptances, enabledPeers, departures }) + "\n");
  }
} finally {
  await app.close();
  listener.closeIdleConnections();
  await new Promise<void>(resolve => listener.close(() => resolve()));
  database.close();
}
