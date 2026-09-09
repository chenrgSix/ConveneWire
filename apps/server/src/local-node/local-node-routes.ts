import { bodyObject, noStore, requiredString } from "../http/http-helpers.js";
import type { ServerRouteContext } from "../http/route-context.js";

export function registerLocalNodeRoutes({ app, localNode, principal, clock, limitAnonymous }: ServerRouteContext): void {
  if (!localNode) return;
  app.post("/api/local-node/control/entry", async (request, reply) => {
    noStore(reply); localNode.requireControl(request);
    return localNode.entry(clock());
  });
  app.get("/api/local-node/control/binding", async (request, reply) => {
    noStore(reply); localNode.requireControl(request);
    return { binding: localNode.binding(clock()) };
  });
  app.post("/api/local-node/session", async (request, reply) => {
    noStore(reply); limitAnonymous(request, "local-node-entry");
    const body = bodyObject(request);
    if (Object.keys(body).length !== 1) throw new Error("Local Node entry accepts only a ticket");
    return localNode.claim(body.ticket, clock());
  });
  app.get("/api/local-node", async (request, reply) => {
    noStore(reply); localNode.requireOwner(principal(request));
    return localNode.status();
  });
  app.post<{ Params: { teamId: string } }>("/api/local-node/teams/:teamId/bind", async (request, reply) => {
    noStore(reply);
    return localNode.bind(principal(request), requiredString(request.params.teamId, "teamId"), clock());
  });
}
