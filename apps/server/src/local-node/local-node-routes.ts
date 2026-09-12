import { parsePeerJson } from "@convene-wire/contracts/peer-json";
import { bodyObject, noStore, requiredString } from "../http/http-helpers.js";
import type { ServerRouteContext } from "../http/route-context.js";

export function registerLocalNodeRoutes({ app, localNode, peerIngressSettings, relaySettings, principal, clock, limitAnonymous }: ServerRouteContext): void {
  if (!localNode) return;
  if (relaySettings) void app.register(async relay => {
    relay.removeContentTypeParser("application/json");
    relay.addContentTypeParser("application/json", {parseAs: "buffer", bodyLimit: 4096}, (_request, bytes, done) => done(null, bytes));
    const body = (input: unknown) => {
      try { return parsePeerJson(input as Buffer); } catch { throw new Error("请提交完整且不含重复字段的便捷接入配置。"); }
    };
    relay.get("/api/local-node/relay", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      const result = await relaySettings.status(); localNode.requireOwner(principal(request)); return result;
    });
    relay.post("/api/local-node/relay/review", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      return relaySettings.review(body(request.body), () => localNode.requireOwner(principal(request)));
    });
    relay.post("/api/local-node/relay/save", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      return relaySettings.save(body(request.body), () => localNode.requireOwner(principal(request)));
    });
    relay.post("/api/local-node/relay/discard", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      return relaySettings.discard(body(request.body), () => localNode.requireOwner(principal(request)));
    });
  });
  if (peerIngressSettings) void app.register(async network => {
    network.removeContentTypeParser("application/json");
    network.addContentTypeParser("application/json", {parseAs: "buffer", bodyLimit: 128 * 1024}, (_request, bytes, done) => done(null, bytes));
    const body = (input: unknown) => {
      try { return parsePeerJson(input as Buffer); } catch { throw new Error("请提交完整且不含重复字段的网络配置。"); }
    };
    network.get("/api/local-node/network", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      const result = await peerIngressSettings.status();
      localNode.requireOwner(principal(request)); return result;
    });
    network.post("/api/local-node/network/review", {bodyLimit: 128 * 1024}, async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      const result = await peerIngressSettings.review(body(request.body), new Date(clock()));
      localNode.requireOwner(principal(request)); return result;
    });
    network.post("/api/local-node/network/save", {bodyLimit: 128 * 1024}, async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      return peerIngressSettings.save(body(request.body), new Date(clock()), () => localNode.requireOwner(principal(request)));
    });
    network.post("/api/local-node/network/discard", async (request, reply) => {
      noStore(reply); localNode.requireOwner(principal(request));
      return peerIngressSettings.discard(body(request.body), () => localNode.requireOwner(principal(request)));
    });
  });
  app.post("/api/local-node/control/entry", async (request, reply) => {
    noStore(reply); localNode.requireControl(request);
    return localNode.entry(clock());
  });
  app.get("/api/local-node/control/binding", async (request, reply) => {
    noStore(reply); localNode.requireControl(request);
    return { binding: localNode.binding(clock()) };
  });
  app.get("/api/local-node/control/state", async (request, reply) => {
    noStore(reply); localNode.requireControl(request);
    return localNode.controlState(clock());
  });
  app.post("/api/local-node/open-console", async (request, reply) => {
    noStore(reply);
    return localNode.requestConsole(principal(request));
  });
  app.post("/api/local-node/session", async (request, reply) => {
    noStore(reply); limitAnonymous(request, "local-node-entry");
    const body = bodyObject(request);
    if (Object.keys(body).length !== 1) throw new Error("Local Node entry accepts only a ticket");
    return localNode.claim(body.ticket, clock());
  });
  app.get("/api/local-node/spaces", async (request, reply) => {
    noStore(reply); localNode.requireOwner(principal(request));
    return localNode.spaces();
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
