import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import type { PeerInvitation, PeerInvitationClaim, PeerScope } from "@convene-wire/contracts/peer";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { createTestResources } from "../../../../scripts/test/resources.mjs";
import { openDatabase } from "../../src/data/database.js";
import { migrateDatabase } from "../../src/data/migration-runner.js";
import { CoreRepository } from "../../src/data/core-repository.js";
import { PeerMembershipRepository, PeerStoreError, peerSecretHash } from "../../src/data/peer-membership-repository.js";
import { AuthorityService } from "../../src/security/authority-service.js";

export const now = "2026-09-10T02:00:00.000Z";
export const expiry = "2026-10-10T02:00:00.000Z";
export const ownerId = "user_hostowner0001", ownerMember = "member_hostowner001", teamId = "team_peerfixture001";
export const roomId = "room_invited000001", otherRoomId = "room_excluded0001";
const fixtureProof = JSON.parse(await readFile(new URL("../../../../packages/contracts/test/fixtures/peer-proof.json", import.meta.url), "utf8")).proof;
export const secret = () => randomBytes(32).toString("base64url");
export const denied = (code: string) => (error: unknown) => error instanceof PeerStoreError && error.code === code;

export async function fixture(t: TestContext) {
  const resources = await createTestResources(t, "convenewire-peer-membership-");
  const databasePath = path.join(resources.directory, "host.sqlite");
  await migrateDatabase(databasePath);
  let database = openDatabase(databasePath);
  resources.defer(() => { if (database.open) database.close(); });
  const identity = new AuthorityService(database, "https://host.example.test");
  const core = new CoreRepository(database);
  core.createUser({ userId: ownerId, displayName: "Shared name", createdAt: now });
  core.createTeamWithOwner({ teamId, name: "Host Team", createdAt: now }, { memberId: ownerMember, teamId, userId: ownerId, displayName: "Shared name", role: "owner", createdAt: now });
  core.createRoom({ roomId, teamId, name: "Invited", createdAt: now });
  core.createRoom({ roomId: otherRoomId, teamId, name: "Excluded", createdAt: now });
  const invite = (suffix = "00000001", scope: PeerScope = { kind: "room", teamId, roomId }) => {
    const invitation: PeerInvitation = { schemaVersion: 1, invitationId: `peerinvite_${suffix}`, host: { nodeId: identity.nodeId, publicKey: identity.publicKey },
      hostOrigin: identity.browserOrigin, scope, teamLabel: "Host Team", roomLabel: scope.kind === "room" ? "Invited" : null,
      expiresAt: "2026-09-10T03:00:00.000Z", membershipExpiresAt: expiry };
    const inviteSecret = secret();
    const claim: PeerInvitationClaim = { schemaVersion: 1, invitationId: invitation.invitationId, operationId: `op_${suffix}`, challengeId: `peerchallenge_${suffix}`,
      invitationDigest: peerDigest(invitation), secret: inviteSecret, participant: { nodeId: "node_participant001", publicKey: fixtureProof.payload.signerPublicKey },
      localUserId: ownerId, displayName: "Shared name", proof: structuredClone(fixtureProof) };
    const machineToken = secret();
    const machine = { credentialId: `peercredential_${suffix}`, tokenHash: peerSecretHash(machineToken), expiresAt: expiry };
    return { invitation, inviteSecret, claim, machine, machineToken };
  };
  return { resources, databasePath, database, identity, core, invite,
    store: new PeerMembershipRepository(database),
    reopen() {
      database.close(); database = openDatabase(databasePath);
      return { database, store: new PeerMembershipRepository(database) };
    }
  };
}

