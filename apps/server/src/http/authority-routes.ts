import { bearerToken, noStore } from "./http-helpers.js";
import type { ServerRouteContext } from "./route-context.js";

export function registerAuthorityRoutes({ app, auth, authority, principal, clock, requireBridgeServerToken }: ServerRouteContext): void {
  app.post("/api/bridge/authority-proof", { bodyLimit: 1024 }, async (request, reply) => {
    noStore(reply); requireBridgeServerToken(request);
    const actor = auth.authenticateDevice(bearerToken(request), clock());
    return authority.prove(actor, request.body, clock());
  });
  app.get("/api/authority", async (request, reply) => {
    noStore(reply); auth.requireFullWebSession(principal(request));
    return authority.describe();
  });
}
