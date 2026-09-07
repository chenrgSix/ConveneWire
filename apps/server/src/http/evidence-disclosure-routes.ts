import type { EvidenceDisclosureIntent, EvidenceDisclosurePublishCommand } from "@convene-wire/contracts/task-result";
import { assertDisclosure } from "@convene-wire/contracts/disclosure-validation";
import { bearerToken, noStore } from "./http-helpers.js";
import type { ServerRouteContext } from "./route-context.js";

export function registerEvidenceDisclosureRoutes({ app, auth, principal, clock, evidenceDisclosures, teamChanges, advanceDiscussion }: ServerRouteContext): void {
  app.post("/api/evidence-disclosures", async (request, reply) => {
    assertDisclosure("disclosureIntent", request.body);
    const grant = evidenceDisclosures.approve(principal(request), request.body as EvidenceDisclosureIntent, clock());
    noStore(reply); return grant;
  });
  app.post<{ Params: { grantId: string } }>("/api/evidence-disclosures/:grantId/revoke", async (request, reply) => {
    assertDisclosure("disclosureRevokeCommand", request.body);
    noStore(reply);
    return evidenceDisclosures.revoke(principal(request), request.params.grantId, (request.body as { expectedRevision: number }).expectedRevision, clock());
  });
  app.get<{ Params: { taskId: string } }>("/api/tasks/:taskId/evidence-disclosures", async (request, reply) => {
    noStore(reply); return evidenceDisclosures.list(principal(request), request.params.taskId);
  });
  app.get<{ Params: { grantId: string } }>("/api/bridge/evidence-disclosures/:grantId", async (request, reply) => {
    const device = auth.authenticateDevice(bearerToken(request), clock());
    noStore(reply); return evidenceDisclosures.forDevice(device, request.params.grantId, clock());
  });
  app.post("/api/bridge/evidence-disclosures/publish", async (request, reply) => {
    const device = auth.authenticateDevice(bearerToken(request), clock());
    assertDisclosure("disclosurePublishCommand", request.body);
    const receipt = evidenceDisclosures.publish(device, request.body as EvidenceDisclosurePublishCommand, clock());
    // Publication remains committed if scheduling fails; the ordinary sweep/recovery
    // reconciles from the Result rather than asking the owner to disclose again.
    try { await advanceDiscussion(receipt.grant.intent.runId); }
    catch { app.log.error({ event: "discussion.disclosure.reconcile_pending", runId: receipt.grant.intent.runId }, "Disclosure committed; Discussion reconciliation pending"); }
    teamChanges.notify(device.teamId, { kind: "room", roomId: receipt.result.roomId });
    noStore(reply); return receipt;
  });
  app.get<{ Params: { grantId: string } }>("/api/bridge/evidence-disclosures/:grantId/result", async (request, reply) => {
    const device = auth.authenticateDevice(bearerToken(request), clock());
    noStore(reply); return evidenceDisclosures.committed(device, request.params.grantId, clock());
  });
}
