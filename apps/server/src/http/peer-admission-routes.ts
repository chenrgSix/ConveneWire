import type { FastifyRequest } from "fastify";
import type { PeerAgentOfferRequest, PeerAgentAcceptanceRequest, PeerAgentRevokeRequest, PeerAgentSyncRequest } from "@convene-wire/contracts/peer";
import type { PeerBrowserEntryRequest, PeerHumanEntryRequest, PeerInvitationClaim, PeerInvitationCreateRequest, PeerInvitationPreviewRequest, PeerClaimChallengeRequest, PeerIdentityRequest } from "@convene-wire/contracts/peer";
import { decodePeer } from "@convene-wire/contracts/peer-validation";
import { PeerStoreError } from "../data/peer-membership-repository.js";
import { bearerToken, noStore, sessionCookie } from "./http-helpers.js";
import type { ServerRouteContext } from "./route-context.js";

function body<T>(request: FastifyRequest, kind: string): T {
  try { return decodePeer(kind, request.body as Buffer) as T; }
  catch { throw new PeerStoreError("INVALID_MESSAGE"); }
}

export function registerPeerAdmissionRoutes({ app, peerAdmission, peerHumanEntry, peerAgents, peerIngress, principal, clock, limitAnonymous, webAuth }: ServerRouteContext): void {
  void app.register(async peer => {
    peer.removeContentTypeParser("application/json");
    peer.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 16 * 1024 }, (_request, bytes, done) => done(null, bytes));
    peer.addHook("onRequest", async (request, reply) => {
      noStore(reply);
      if (request.headers["x-forwarded-proto"] === "http") throw new PeerStoreError("SCOPE_DENIED");
    });
    peer.setErrorHandler((error, _request, reply) => {
      if ((error as { code?: string }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        void reply.code(413).send({ code: "INVALID_MESSAGE" });
        return;
      }
      if (!(error instanceof PeerStoreError)) throw error;
      const code = error.code;
      const status = code === "UNAUTHENTICATED" ? 401 : code === "SCOPE_DENIED" ? 403 :
        ["EXPIRED", "REVOKED"].includes(code) ? 410 : ["STALE_AUTHORIZATION", "PAYLOAD_CONFLICT"].includes(code) ? 409 : 400;
      void reply.code(status).send({ code });
    });
    peer.post("/api/peer/invitations", async request => peerAdmission.createInvitation(principal(request), body<PeerInvitationCreateRequest>(request, "PeerInvitationCreateRequest"), clock()));
    peer.post("/api/peer/agents/offers", async request => {
      limitAnonymous(request, "peer-agent-offer");
      if (request.headers.origin || request.headers.cookie) throw new PeerStoreError("SCOPE_DENIED");
      return peerAgents.offer(bearerToken(request), body<PeerAgentOfferRequest>(request, "PeerAgentOfferRequest"), clock());
    });
    peer.post("/api/peer/agents/sync", { bodyLimit: 1024 * 1024 }, async request => {
      limitAnonymous(request, "peer-agent-sync");
      if (request.headers.origin || request.headers.cookie) throw new PeerStoreError("SCOPE_DENIED");
      return peerAgents.synchronize(bearerToken(request), body<PeerAgentSyncRequest>(request, "PeerAgentSyncRequest"), clock());
    });
    peer.get<{ Params: { teamId: string } }>("/api/peer/teams/:teamId/agent-offers", async request =>
      ({ offers: peerAgents.listOffers(principal(request), request.params.teamId) }));
    peer.post("/api/peer/agents/accept", async request =>
      peerAgents.accept(principal(request), body<PeerAgentAcceptanceRequest>(request, "PeerAgentAcceptanceRequest"), clock()));
    peer.post("/api/peer/agents/revoke", async request =>
      peerAgents.revoke(principal(request), body<PeerAgentRevokeRequest>(request, "PeerAgentRevokeRequest"), clock()));
    peer.delete<{ Params: { invitationId: string } }>("/api/peer/invitations/:invitationId", async request => {
      peerAdmission.revokeInvitation(principal(request), request.params.invitationId, clock());
      return { status: "revoked" };
    });
    peer.delete<{ Params: { membershipId: string } }>("/api/peer/memberships/:membershipId", async request => {
      peerAdmission.revokeMembership(principal(request), request.params.membershipId, clock());
      return { status: "revoked" };
    });
    const machineRequest = (request: FastifyRequest) => {
      limitAnonymous(request, "peer-admission");
      if (request.headers.origin || request.headers.cookie || request.headers.authorization) throw new PeerStoreError("SCOPE_DENIED");
    };
    peer.post("/api/peer/identity", async request => {
      machineRequest(request);
      return peerAdmission.identity(body<PeerIdentityRequest>(request, "PeerIdentityRequest"), clock());
    });
    peer.post("/api/peer/human-entry", async request => {
      machineRequest(request);
      return peerHumanEntry.issue(body<PeerHumanEntryRequest>(request, "PeerHumanEntryRequest"), clock());
    });
    for (const action of ["preview", "claim"] as const) {
      peer.post(`/api/peer/browser-entry/${action}`, async (request, reply) => {
        limitAnonymous(request, "peer-human-browser-entry");
        if (!peerHumanEntry.browserOrigin || request.headers.origin !== peerHumanEntry.browserOrigin || request.headers.authorization) throw new PeerStoreError("SCOPE_DENIED");
        const input = body<PeerBrowserEntryRequest>(request, "PeerBrowserEntryRequest");
        if (action === "preview") return peerHumanEntry.preview(input, clock());
        const result = peerHumanEntry.consume(input, clock());
        const mode = peerIngress?.kind(request.raw) ? "trusted-team" : webAuth.mode;
        if (mode === "trusted-team") void reply.header("set-cookie", sessionCookie(result.session, true));
        return { identity: result.identity, user: { ...result.user, peerAccess: result.peerAccess, canManageOwnerRecovery: false },
          mode, session: { expiresAt: result.session.expiresAt,
            ...(mode === "local" ? { token: result.session.secret } : {}) } };
      });
    }
    peer.post("/api/peer/invitations/preview", async request => {
      machineRequest(request);
      return peerAdmission.preview(body<PeerInvitationPreviewRequest>(request, "PeerInvitationPreviewRequest"), clock());
    });
    peer.post("/api/peer/invitations/challenge", async request => {
      machineRequest(request);
      return peerAdmission.challenge(body<PeerClaimChallengeRequest>(request, "PeerClaimChallengeRequest"), clock());
    });
    peer.post("/api/peer/invitations/claim", async request => {
      machineRequest(request);
      return peerAdmission.claim(body<PeerInvitationClaim>(request, "PeerInvitationClaim"), clock());
    });
  });
}
