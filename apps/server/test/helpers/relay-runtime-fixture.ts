import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createPublicKey, randomBytes, sign } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { promisify } from "node:util";
import type { PeerProofPayload, RelayServiceProfile } from "@convene-wire/contracts/peer";
import { peerProofTranscript } from "@convene-wire/contracts/peer-proof";
import { createTestResources } from "../../../../scripts/test/resources.mjs";
import { createServerApp } from "../../src/app.js";
import { localAuthorityPrivateKey } from "../../src/security/authority-service.js";
import { privateWrite } from "../../src/local-node/relay-private.js";
import { RelayRuntime } from "../../src/local-node/relay-runtime.js";
import { RelaySettings, relayOrigin, disabledRelay } from "../../src/local-node/relay-settings.js";
import { PeerIngressSettings } from "../../src/local-node/peer-ingress-settings.js";
import { freeIngressPort } from "./native-peer-ingress-fixture.js";
import { createRelayCAFixture, readRelayHTTP01 } from "./relay-ca-fixture.js";

export const relaySecret = () => randomBytes(32).toString("base64url");
export async function untilRelay(check: () => boolean | Promise<boolean>, label: string, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) { if (await check()) return; await delay(40); }
  throw new Error(label);
}

/** Actual standalone Go process; the only substituted external component is a
 * disposable RFC8555 CA/DNS agent. No installed Node or public CA is contacted. */
export async function relayRuntimeFixture(t: TestContext) {
  const ca = await createRelayCAFixture(t);
  const resources = await createTestResources(t, "convenewire-relay-runtime-");
  const tlsPort = await freeIngressPort(), httpPort = await freeIngressPort();
  const profile: RelayServiceProfile = {...ca.profile, relayOrigin: `https://relay.fixture.test:${tlsPort}`};
  const material = await ca.tls(["relay.fixture.test"]);
  const cert = path.join(resources.directory, "control.pem"), key = path.join(resources.directory, "control-key.pem");
  await writeFile(cert, material.cert, {mode: 0o600}); await writeFile(key, material.key, {mode: 0o600});
  const executable = path.join(resources.directory, process.platform === "win32" ? "relay.exe" : "relay");
  await promisify(execFile)("go", ["build", "-o", executable, "./cmd/convenewire-relay"], {
    cwd: fileURLToPath(new URL("../../../../ops/convenewire-relay", import.meta.url)), timeout: 120000,
    env: {...process.env, GOPATH: path.join(resources.directory, "go-path")}
  });
  let processHandle: ChildProcess | undefined, exited: Promise<void> | undefined;
  const stop = async () => {
    const child = processHandle; processHandle = undefined;
    if (!child) return;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    try { await exited; } finally { clearTimeout(timeout); }
  };
  resources.defer(stop);
  const start = async () => {
    assert.equal(processHandle, undefined);
    const child = spawn(executable, ["--relay-origin", profile.relayOrigin, "--node-domain", profile.nodeDomain,
      "--tls-listen", `127.0.0.1:${tlsPort}`, "--http-listen", `127.0.0.1:${httpPort}`, "--tls-cert", cert, "--tls-key", key], {stdio: ["ignore", "pipe", "pipe"]});
    processHandle = child;
    let output = "", errors = "";
    child.stdout!.on("data", data => { output += data; }); child.stderr!.on("data", data => { errors += data; });
    exited = new Promise<void>((resolve, reject) => {
      child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Relay exit ${code}: ${errors}`)));
    });
    void exited.catch(() => {});
    await untilRelay(() => { if (child.exitCode !== null) throw new Error(errors); return output.includes("Relay ready "); }, "Relay daemon startup timed out");
  };
  await start();
  ca.probe = (host, token) => readRelayHTTP01(host, token, httpPort);
  const request = (origin: string, endpoint: string, options: {method?: string; headers?: Record<string, string>; payload?: unknown} = {}) =>
    new Promise<{status: number; headers: IncomingHttpHeaders; body: string; json: () => any}>((resolve, reject) => {
      const body = options.payload === undefined ? undefined : JSON.stringify(options.payload);
      const req = httpsRequest(new URL(endpoint, origin), {method: options.method ?? "GET", agent: ca.agent,
        signal: AbortSignal.timeout(5000), headers: {...(body ? {"content-type": "application/json"} : {}), ...options.headers}}, response => {
        const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk)); response.once("error", reject);
        response.once("end", () => { const body = Buffer.concat(chunks).toString(); resolve({status: response.statusCode!, headers: response.headers, body, json: () => JSON.parse(body)}); });
      }); req.once("error", reject); req.end(body);
    });
  const node = async (name: string, options: {webRoot?: string; enabled?: boolean;
    configureApp?: (app: Awaited<ReturnType<typeof createServerApp>>) => void} = {}) => {
    const root = path.join(resources.directory, name); await mkdir(root, {mode: 0o700});
    const launch = {schemaVersion: 1 as const, controlToken: relaySecret(), identity: {schemaVersion: 1 as const,
      nodeId: `node_${relaySecret()}`, ownerUserId: `user_${relaySecret()}`, secret: relaySecret(), port: await freeIngressPort()}};
    const privateKey = localAuthorityPrivateKey(launch);
    const identity = {nodeId: launch.identity.nodeId, publicKey: createPublicKey(privateKey).export({format: "der", type: "spki"}).subarray(-32).toString("base64url")};
    const origin = relayOrigin(profile, identity.publicKey), localOrigin = `http://127.0.0.1:${launch.identity.port}`;
    const configuration = {schemaVersion: 1 as const, profile, enabled: options.enabled ?? true, termsAccepted: true as const, origin};
    await mkdir(path.join(root, "relay"), {mode: 0o700});
    await privateWrite(path.join(root, "relay"), "config.json", Buffer.from(JSON.stringify(configuration)));
    const databasePath = path.join(root, "hub.sqlite");
    let runtime!: RelayRuntime, relaySettings!: RelaySettings, app!: Awaited<ReturnType<typeof createServerApp>>;
    let owner: any, ownerHeaders!: Record<string, string>;
    const open = async () => {
      runtime = new RelayRuntime(root, configuration, identity.nodeId, privateKey, {agent: ca.agent, clock: ca.clock, retryMilliseconds: 40});
      await runtime.initialize();
      relaySettings = new RelaySettings(root, identity.publicKey, profile, () => configuration.enabled ? runtime.status() : disabledRelay());
      app = await createServerApp({databasePath, localNode: launch, peerIngress: runtime.ingress, relayLifecycle: runtime,
        ...(options.webRoot ? {webRoot: options.webRoot} : {}), relaySettings, peerIngressSettings: new PeerIngressSettings(root), clock: () => new Date(ca.now).toISOString()});
      options.configureApp?.(app);
      await app.listen({host: "127.0.0.1", port: launch.identity.port}); await runtime.ingress.listen(app.server);
      const host = new URL(localOrigin).host;
      const entry = await app.inject({method: "POST", url: "/api/local-node/control/entry", headers: {host, "x-convenewire-node-control": launch.controlToken}});
      const ticket = entry.json().url.split("/").at(-1);
      owner = (await app.inject({method: "POST", url: "/api/local-node/session", headers: {host, origin: localOrigin}, payload: {ticket}})).json();
      ownerHeaders = {host, origin: localOrigin, authorization: `Bearer ${owner.session.token}`};
    };
    resources.defer(async () => {await app?.close(); await runtime?.close(); await runtime?.ingress.close();});
    await open();
    const team = (await app.inject({method: "POST", url: "/api/teams", headers: ownerHeaders, payload: {name}})).json().team;
    const room = (await app.inject({method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: {name: "Shared room"}})).json();
    const otherRoom = (await app.inject({method: "POST", url: `/api/teams/${team.teamId}/rooms`, headers: ownerHeaders, payload: {name: "Private room"}})).json();
    const proof = (audienceNodeId: string, purpose: PeerProofPayload["purpose"], operationId: string, nonce: string, subjectDigest: string) => {
      const payload: PeerProofPayload = {schemaVersion: 1, purpose, operationId, nonce, subjectDigest, signerNodeId: identity.nodeId,
        signerPublicKey: identity.publicKey, audienceNodeId, issuedAt: new Date(ca.now).toISOString(), expiresAt: new Date(ca.now + 30000).toISOString()};
      return {payload, signature: sign(null, peerProofTranscript(payload), privateKey).toString("base64url")};
    };
    return {root, launch, identity, privateKey, origin, localOrigin, get app() {return app;}, get runtime() {return runtime;},
      get relaySettings() {return relaySettings;}, get owner() {return owner;}, get ownerHeaders() {return ownerHeaders;},
      team, room, otherRoom, databasePath, proof, restart: async () => {await app.close(); await open(); runtime.start();
        await untilRelay(() => runtime.status().state === "ready", "Restarted Node route was not ready");},
      request: (endpoint: string, options?: Parameters<typeof request>[2]) => request(origin, endpoint, options)};
  };
  return {ca, resources, profile, tlsPort, httpPort, start, stop, node, request};
}

export async function joinRelayNodes(host: Awaited<ReturnType<Awaited<ReturnType<typeof relayRuntimeFixture>>["node"]>>, participant: typeof host, now: number) {
  const {peerDigest} = await import("@convene-wire/contracts/peer-proof");
  const {peerClaimDigest} = await import("../../src/data/peer-membership-repository.js");
  const {peerHumanEntryIntent} = await import("../../src/security/peer-human-entry-service.js");
  const scope = {kind: "room" as const, teamId: host.team.teamId, roomId: host.room.roomId};
  const response = await host.app.inject({method: "POST", url: "/api/peer/invitations", headers: host.ownerHeaders, payload: {
    schemaVersion: 1, operationId: `op_${relaySecret()}`, scope, expiresAt: new Date(now + 3600000).toISOString(), membershipExpiresAt: new Date(now + 86400000).toISOString()}});
  assert.equal(response.statusCode, 200, response.body);
  const invitation = response.json();
  const intent = {schemaVersion: 1 as const, invitationId: invitation.invitation.invitationId, invitationDigest: peerDigest(invitation.invitation),
    secret: invitation.secret, participant: participant.identity, operationId: `op_${relaySecret()}`, localUserId: participant.launch.identity.ownerUserId, displayName: "Relay Guest"};
  const digest = peerClaimDigest(intent as never);
  const challenge = await host.request("/api/peer/invitations/challenge", {method: "POST", payload: {schemaVersion: 1,
    invitationId: intent.invitationId, secret: intent.secret, participant: intent.participant, operationId: intent.operationId, subjectDigest: digest}});
  assert.equal(challenge.status, 200, challenge.body);
  const claim = await host.request("/api/peer/invitations/claim", {method: "POST", payload: {...intent, challengeId: challenge.json().challengeId,
    proof: participant.proof(host.identity.nodeId, "invitation.claim", intent.operationId, challenge.json().nonce, digest)}});
  assert.equal(claim.status, 200, claim.body);
  const joined = claim.json(), binding = joined.human.humanCredential;
  const input = {schemaVersion: 1 as const, operationId: `op_${relaySecret()}`, bindingCredentialId: binding.credentialId,
    bindingToken: binding.token, scope, nonce: relaySecret()};
  const human = await host.request("/api/peer/human-entry", {method: "POST", payload: {...input,
    proof: participant.proof(host.identity.nodeId, "human.entry", input.operationId, input.nonce, peerHumanEntryIntent(input))}});
  assert.equal(human.status, 200, human.body);
  const credential = human.json().credential;
  return {joined, scope, invitation, browser: {schemaVersion: 1, credentialId: credential.credentialId, token: credential.token}};
}
