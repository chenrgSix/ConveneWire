import type { PeerRuntimeSession } from "../peer/runtime-sessions.js";
import { bearerToken } from "./http-helpers.js";
import type { ServerRouteContext } from "./route-context.js";

export function registerPeerRuntimeRoutes({ app, peerAdmission, peerRuntime, peerPresence, clock, limitAnonymous }: ServerRouteContext): void {
  let sweep: ReturnType<typeof setInterval> | undefined;
  app.addHook("onReady", async () => {
    peerPresence.refresh(clock());
    sweep = setInterval(() => {
      const now = clock();
      peerRuntime.sweep(now);
      peerPresence.refresh(now);
    }, 1000);
    sweep.unref();
  });
  app.addHook("preClose", async () => { clearInterval(sweep); peerRuntime.close(); });
  app.get("/ws/peer/runtime", {
    websocket: true,
    preValidation: async (request, reply) => {
      limitAnonymous(request, "peer-runtime");
      if (request.url !== "/ws/peer/runtime" || request.headers.origin || request.headers.cookie ||
          Object.keys(request.headers).some(name => /^x-(?:agentroom|convenewire|convene-wire)-/u.test(name))) {
        return reply.code(403).send({ code: "SCOPE_DENIED" });
      }
      try { peerAdmission.authenticateMachine(bearerToken(request), clock()); }
      catch { return reply.code(401).send({ code: "UNAUTHENTICATED" }); }
    }
  }, (socket, request) => {
    let session: PeerRuntimeSession;
    try {
      session = peerRuntime.open(bearerToken(request), { send: frame => {
        if (socket.readyState !== socket.OPEN || socket.bufferedAmount > 64 * 1024) throw new Error("Peer transport unavailable");
        socket.send(frame);
      }, close: () => socket.terminate() }, clock());
    } catch { socket.terminate(); return; }
    socket.on("close", () => session.close());
    socket.on("error", () => session.close());
    socket.on("message", (source: unknown, binary: boolean) => {
      try {
        if (binary || !(source instanceof Uint8Array)) { session.close(); return; }
        session.receive(source, clock());
      } catch { session.close(); }
    });
    try { socket.send(JSON.stringify(session.challenge(clock()))); }
    catch { session.close(); }
  });
}
