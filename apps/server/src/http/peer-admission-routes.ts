import type { FastifyRequest } from "fastify";
import type { PeerAdmission, PeerRunPollRequest, PeerRunEventRequest, PeerRunSettlementRequest } from "@convene-wire/contracts/peer";
import type { PeerAgentOfferRequest, PeerAgentAcceptanceRequest, PeerAgentRevokeRequest, PeerAgentSyncRequest, PeerLeaveRequest } from "@convene-wire/contracts/peer";
import type { PeerBrowserEntryRequest, PeerHumanEntryRequest, PeerInvitationClaim, PeerInvitationCreateRequest, PeerInvitationPreviewRequest, PeerClaimChallengeRequest, PeerIdentityRequest } from "@convene-wire/contracts/peer";
import { decodePeer } from "@convene-wire/contracts/peer-validation";
import { PeerStoreError } from "../data/peer-membership-repository.js";
import { bearerToken, noStore, sessionCookie } from "./http-helpers.js";
import type { ServerRouteContext } from "./route-context.js";

function body<T>(request: FastifyRequest, kind: string): T {
  try { return decodePeer(kind, request.body as Buffer) as T; }
  catch { throw new PeerStoreError("INVALID_MESSAGE"); }
}

export function registerPeerAdmissionRoutes({ app, peerAdmission, peerRuns, peerDeliveries, peerHumanEntry, peerAgents, peerIngress, principal, clock, limitAnonymous, webAuth,
  routeAgentReplyMentions, advanceDiscussion, pauseDiscussionForInput }: ServerRouteContext): void {
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
    const runRequest = (request: FastifyRequest, operation: string) => {
      limitAnonymous(request, operation);
      if (request.url.includes("?") || request.headers.origin || request.headers.cookie ||
          Object.keys(request.headers).some(name => /^x-(?:agentroom|convenewire|convene-wire|agent-room)-/u.test(name))) {
        throw new PeerStoreError("SCOPE_DENIED");
      }
    };
    peer.post("/api/peer/runs/poll", { bodyLimit: 64 * 1024 }, async request => {
      runRequest(request, "peer-run-poll");
      return peerDeliveries.poll(bearerToken(request), body<PeerRunPollRequest>(request, "PeerRunPollRequest"), clock());
    });
    peer.post("/api/peer/runs/events", { bodyLimit: 1024 * 1024 }, async request => {
      runRequest(request, "peer-run-event");
      const input = body<PeerRunEventRequest>(request, "PeerRunEventRequest");
      const receipt = peerDeliveries.event(bearerToken(request), input, clock());
      if (input.event.type === "reply") await routeAgentReplyMentions(input.binding.runId);
      if (input.event.type === "status" && input.event.status === "input_required") await pauseDiscussionForInput(input.binding.runId);
      else if (input.event.type === "status" && ["completed", "failed", "canceled"].includes(input.event.status ?? "")) await advanceDiscussion(input.binding.runId);
      return receipt;
    });
    peer.post("/api/peer/runs/settle", async request => {
      runRequest(request, "peer-run-settlement");
      return peerDeliveries.settle(bearerToken(request), body<PeerRunSettlementRequest>(request, "PeerRunSettlementRequest"), clock());
    });
    peer.post("/api/peer/runs/admit", async request => {
      runRequest(request, "peer-run-admission");
      return peerRuns.authorize(bearerToken(request), body<PeerAdmission>(request, "PeerAdmission"), clock());
    });
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
    peer.post("/api/peer/memberships/leave", async request => {
      machineRequest(request);
      if (request.url.includes("?")) throw new PeerStoreError("SCOPE_DENIED");
      return peerAdmission.leave(body<PeerLeaveRequest>(request, "PeerLeaveRequest"), clock());
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
