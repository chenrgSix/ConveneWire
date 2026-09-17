import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createServerApp } from "../../src/app.js";
import { PeerIngress } from "../../src/local-node/peer-ingress.js";

/** Explicit opt-in, disposable native Host for a physical LAN Participant. */
export async function lanNativePeerFixture(directory: string, certFile: string, keyFile: string,
  listenHost: string, clock: () => string, configure: (app: Awaited<ReturnType<typeof createServerApp>>) => void) {
  if (net.isIPv4(listenHost) === false || !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)/u.test(listenHost)) {
    throw new Error("LAN fixture requires an explicit private IPv4 address");
  }
  const freePort = async (host: string) => {
    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => { probe.once("error", reject); probe.listen(0, host, resolve); });
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
    return port;
  };
  const localPort = await freePort("127.0.0.1"), peerPort = await freePort(listenHost);
  const origin = `https://${listenHost}:${peerPort}`, localOrigin = `http://127.0.0.1:${localPort}`;
  const secret = () => randomBytes(32).toString("base64url");
  const launch = { schemaVersion: 1 as const, controlToken: secret(), identity: { schemaVersion: 1 as const,
    nodeId: `node_${secret()}`, ownerUserId: `user_${secret()}`, port: localPort, secret: secret() } };
  const tls = { cert: await readFile(certFile), key: await readFile(keyFile) };
  const databasePath = path.join(directory, "host.sqlite");
  const openHost = async () => {
    const ingress = new PeerIngress({ configuration: { schemaVersion: 1, enabled: true, origin, listenHost,
      certificateFile: "cert.pem", privateKeyFile: "key.pem" }, tls });
    const app = await createServerApp({ databasePath, localNode: launch, peerIngress: ingress, clock,
      webRoot: path.resolve("apps/web/dist") });
    try {
      configure(app);
      await app.listen({ host: "127.0.0.1", port: localPort });
      await ingress.listen(app.server);
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
    const teamResponse = await app.inject({ method: "POST", url: "/api/teams", headers: ownerHeaders, payload: { name: "LAN acceptance Host" } });
    const team = teamResponse.json().team;
    const roomResponse = await app.inject({ method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: { name: "Invited LAN Room" } });
    if (roomResponse.statusCode !== 200) throw new Error(`LAN fixture room bootstrap failed: ${roomResponse.statusCode}`);
    return { get app() { return app; }, launch, origin, databasePath, team, room: roomResponse.json(), ownerHeaders,
      async restart() { await app.close(); app = await openHost(); }, async close() { await app.close(); } };
  } catch (error) { await app.close(); throw error; }
}
