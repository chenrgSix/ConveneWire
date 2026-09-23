import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localAuthorityPrivateKey } from "../../src/security/authority-service.js";
import { createServerApp } from "../../src/app.js";
import { LANRuntime } from "../../src/local-node/lan-runtime.js";

/** Disposable managed LAN Host. Never touches an installed profile. */
export async function managedLANPeerFixture(directory: string, clock: () => string,
  configure: (app: Awaited<ReturnType<typeof createServerApp>>) => void = () => {}, addresses?: () => string[]) {
  const freePort = async (host: string) => {
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(0, host, resolve); });
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    return port;
  };
  const localPort = await freePort("127.0.0.1");
  const localOrigin = `http://127.0.0.1:${localPort}`;
  const secret = () => randomBytes(32).toString("base64url");
  const launch = { schemaVersion: 1 as const, controlToken: secret(), identity: { schemaVersion: 1 as const,
    nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: localPort, secret: secret() } };
  let runtime: LANRuntime;
  const databasePath = path.join(directory, "host.sqlite");
  const webRoot = fileURLToPath(new URL("../../../web/dist/", import.meta.url));
  const openHost = async () => {
    runtime = new LANRuntime(directory, launch.identity.nodeId, localAuthorityPrivateKey(launch), undefined, addresses);
    await runtime.initialize();
    const app = await createServerApp({ databasePath, localNode: launch, peerIngress: runtime, lanRuntime: runtime, clock,
      ...(existsSync(webRoot) ? {webRoot} : {}) });
    try {
      configure(app);
      await app.listen({ host: "127.0.0.1", port: localPort });
      await runtime.attach(app.server);
      return app;
    } catch (error) { await app.close(); throw error; }
  };
  let app = await openHost();
  try {
    const host = new URL(localOrigin).host;
    const entry = await app.inject({ method: "POST", url: "/api/local-node/control/entry", headers: { host, "x-convenewire-node-control": launch.controlToken } });
    const ticket = (entry.json().url as string).split("/").at(-1)!;
    const owner = await app.inject({ method: "POST", url: "/api/local-node/session", headers: { host, origin: localOrigin }, payload: { ticket } });
    if (owner.statusCode !== 200) throw new Error("LAN fixture owner bootstrap failed");
    const ownerHeaders = { host, origin: localOrigin, authorization: `Bearer ${owner.json().session.token}` };
    const enabled = await app.inject({method: "POST", url: "/api/local-node/lan", headers: ownerHeaders, payload: {enabled: true}});
    if (enabled.statusCode !== 200) throw new Error(`managed LAN enable failed: ${enabled.body}`);
    const teamResponse = await app.inject({ method: "POST", url: "/api/teams", headers: ownerHeaders, payload: { name: "LAN acceptance Host" } });
    const team = teamResponse.json().team;
    const roomResponse = await app.inject({ method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: { name: "Invited LAN Room" } });
    if (roomResponse.statusCode !== 200) throw new Error(`LAN fixture room bootstrap failed: ${roomResponse.statusCode}`);
    return { get app() { return app; }, launch, origin: runtime!.configuration.origin, databasePath, get runtime() {return runtime;}, team, room: roomResponse.json(), ownerHeaders,
      async restart() { await app.close(); app = await openHost(); }, async close() { await app.close(); } };
  } catch (error) { await app.close(); throw error; }
}
