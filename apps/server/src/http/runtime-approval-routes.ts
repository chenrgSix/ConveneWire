import { validateBridgeMessage } from "@convene-wire/contracts/bridge-validator";
import { bearerToken, noStore } from "./http-helpers.js";
import { createOpaqueId } from "../domain/identifiers.js";
import type { ServerRouteContext } from "./route-context.js";

export function registerRuntimeApprovalRoutes({ app, auth, principal, clock, runtimeApprovals }: ServerRouteContext): void {
  app.post("/api/bridge/runtime-approvals", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const actor = auth.authenticateDevice(bearerToken(request), clock());
    const body = request.body;
    if (!validateBridgeMessage(body) || body.type !== "runtime.approval.requested") return reply.code(400).send({ error: "Invalid approval request" });
    const payload = runtimeApprovals.request(actor, body.payload, clock());
    noStore(reply);
    return { protocolVersion: "1.0", messageId: createOpaqueId("msg"), timestamp: clock(), type: "runtime.approval.decision", payload };
  });
  app.get<{ Params: { teamId: string } }>("/api/teams/:teamId/runtime-approvals", async (request, reply) => {
    noStore(reply);
    return { items: runtimeApprovals.list(principal(request), request.params.teamId, clock()) };
  });
  app.post<{ Params: { requestId: string } }>("/api/runtime-approvals/:requestId/decision", async (request, reply) => {
    const actor = principal(request), body = request.body as Record<string, unknown> | undefined;
    if (!body || Object.keys(body).length !== 2 || typeof body.digest !== "string" || !/^[a-f0-9]{64}$/u.test(body.digest) ||
      !["allow", "deny"].includes(body.decision as string)) return reply.code(400).send({ error: "Invalid approval decision" });
    noStore(reply);
    return runtimeApprovals.decide(actor, request.params.requestId, body.digest, body.decision as "allow" | "deny", clock());
  });
}
