import assert from "node:assert/strict";
import { createHash, createPublicKey, randomBytes, verify, webcrypto } from "node:crypto";
import { Agent, createServer } from "node:https";
import { request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { TestContext } from "node:test";
import { BasicConstraintsExtension, ExtendedKeyUsage, ExtendedKeyUsageExtension, KeyUsageFlags, KeyUsagesExtension,
  Pkcs10CertificateRequest, SubjectAlternativeNameExtension, X509CertificateGenerator } from "@peculiar/x509";
import * as acme from "acme-client";
import type { RelayServiceProfile } from "@convene-wire/contracts/peer";
import { createTestResources } from "../../../../scripts/test/resources.mjs";

type FixtureAccount = { url: string; jwk: JsonWebKey; thumbprint: string };
type FixtureOrder = { id: number; hostname: string; account: FixtureAccount; status: "pending" | "ready" | "valid"; token: string; certificate?: string; expires: number };

/** Disposable RFC 8555 endpoint: verifies JWS/nonces and CSR, and requires an
 * actual HTTP-01 response before signing with the fixture CA. Never public DNS. */
export async function createRelayCAFixture(t: TestContext) {
  const resources = await createTestResources(t, "convenewire-relay-ca-");
  const keys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const algorithm = { name: "ECDSA", hash: "SHA-256" };
  const start = Date.now();
  const caCertificate = await X509CertificateGenerator.createSelfSigned({ name: "CN=ConveneWire Disposable CA", keys,
    signingAlgorithm: algorithm, notBefore: new Date(start - 86400_000), notAfter: new Date(start + 365 * 86400_000),
    extensions: [new BasicConstraintsExtension(true, 2, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true)] }, webcrypto);
  const ca = Buffer.from(caCertificate.toString("pem"));
  const accounts = new Map<string, FixtureAccount>();
  const orders: FixtureOrder[] = [];
  const nonces = new Set<string>();
  const sockets = new Set<Socket>();
  const fixture = {
    directory: resources.directory, ca, agent: undefined as unknown as Agent, origin: "", profile: undefined as unknown as RelayServiceProfile,
    now: start, clock: () => fixture.now,
    lookups: [] as string[],
    counters: { requests: 0, accounts: 0, orders: 0, challenges: 0, finalizations: 0, certificates: 0, accountUpdates: 0, reconciliations: 0 },
    probe: async (_hostname: string, _token: string): Promise<string> => { throw new Error("HTTP01 probe has not been configured"); },
    termsUrl: "", foreignDirectoryOrigin: false, foreignOrderOrigin: false, additionalIdentifier: false,
    additionalCertificateName: false, selfSignedCertificate: false, dropOrderResponse: false, dropFinalizeResponse: false,
    paginateOrders: false, foreignOrdersPage: false, cyclicOrdersPage: false,
    blockedPath: null as string | null, blockedRequests: 0,
    failPath: null as string | null, failStatus: 429, failType: "rateLimited", retryAfter: "120",
    tls: async (names: string[], options: { notBefore?: number; notAfter?: number } = {}) => {
      const key = await acme.crypto.createPrivateEcdsaKey();
      const [, csr] = await acme.crypto.createCsr({ commonName: names[0]!, altNames: names }, key);
      return { key, cert: Buffer.from(await signCSR(csr, names, options)) };
    }
  };
  async function signCSR(csr: Buffer, names: string[], options: { notBefore?: number; notAfter?: number } = {}): Promise<string> {
    const request = new Pkcs10CertificateRequest(csr);
    assert.ok(await request.verify(webcrypto), "fixture CSR signature must verify");
    const certificate = await X509CertificateGenerator.create({ subject: request.subjectName, issuer: caCertificate.subjectName,
      publicKey: request.publicKey, signingKey: keys.privateKey, signingAlgorithm: algorithm,
      serialNumber: randomBytes(12).toString("hex"), notBefore: new Date(options.notBefore ?? fixture.now - 60_000),
      notAfter: new Date(options.notAfter ?? fixture.now + 30 * 86400_000), extensions: [
        new BasicConstraintsExtension(false, undefined, true), new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
        new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]), new SubjectAlternativeNameExtension(names.map(value => ({ type: "dns", value })))
      ] }, webcrypto);
    return certificate.toString("pem") + "\n" + ca.toString();
  }
  const serverMaterial = await fixture.tls(["ca.fixture.test"], { notAfter: start + 364 * 86400_000 });
  const agent = new Agent({ ca, keepAlive: false, lookup: ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    fixture.lookups.push(hostname);
    if (!hostname.endsWith(".fixture.test")) { callback(new Error("Fixture DNS rejected external hostname")); return; }
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]); else callback(null, "127.0.0.1", 4);
  }) as never });
  fixture.agent = agent;
  resources.defer(() => agent.destroy());

  const server = createServer(serverMaterial, (request, response) => {
    void handle(request, response).catch(error => {
      if (!response.destroyed) { response.writeHead(500, { "content-type": "application/problem+json" }); response.end(JSON.stringify({ type: "fixture", detail: String(error) })); }
    });
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  resources.defer(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  fixture.origin = `https://ca.fixture.test:${address.port}`; fixture.termsUrl = `${fixture.origin}/terms`;
  fixture.profile = { schemaVersion: 1, id: "fixture-relay", displayName: "Disposable Relay", relayOrigin: "https://relay.fixture.test",
    nodeDomain: "nodes.fixture.test", acmeDirectoryUrl: `${fixture.origin}/directory`, termsUrl: fixture.termsUrl };

  const url = (path: string) => fixture.origin + path;
  function orderJSON(order: FixtureOrder) {
    return { status: order.status, identifiers: [{ type: "dns", value: order.hostname }, ...(fixture.additionalIdentifier ? [{ type: "dns", value: "foreign.fixture.test" }] : [])],
      authorizations: [url(`/authz/${order.id}`)], finalize: fixture.foreignOrderOrigin ? "https://foreign.fixture.test/finalize" : url(`/finalize/${order.id}`),
      expires: new Date(order.expires).toISOString(), ...(order.certificate ? { certificate: url(`/certificate/${order.id}`) } : {}) };
  }
  async function handle(request: IncomingMessage, response: ServerResponse) {
    fixture.counters.requests++;
    const path = request.url!;
    if (fixture.blockedPath === path) { fixture.blockedRequests++; return; }
    const nonce = randomBytes(24).toString("base64url"); nonces.add(nonce);
    response.setHeader("Replay-Nonce", nonce);
    response.setHeader("Link", `<${fixture.origin}/directory>;rel="index"`);
    const json = (status: number, value: unknown, headers: Record<string, string> = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers }); response.end(JSON.stringify(value));
    };
    if (fixture.failPath === path) { json(fixture.failStatus, { type: `urn:ietf:params:acme:error:${fixture.failType}` }, { "retry-after": fixture.retryAfter }); return; }
    if (path === "/directory" && request.method === "GET") {
      const root = fixture.foreignDirectoryOrigin ? "https://foreign.fixture.test" : fixture.origin;
      json(200, { newNonce: root + "/nonce", newAccount: root + "/account", newOrder: root + "/new-order", meta: { termsOfService: fixture.termsUrl } }); return;
    }
    if (path === "/nonce" && request.method === "HEAD") { response.writeHead(200); response.end(); return; }
    if (request.method !== "POST") { json(405, {}); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) { const data = Buffer.from(chunk); size += data.length; assert.ok(size <= 32 * 1024); chunks.push(data); }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const header = JSON.parse(Buffer.from(body.protected, "base64url").toString());
    assert.equal(header.url, fixture.origin + path); assert.equal(header.alg, "ES256");
    if (!nonces.delete(header.nonce)) { json(400, { type: "urn:ietf:params:acme:error:badNonce" }); return; }
    const account = header.kid ? [...accounts.values()].find(value => value.url === header.kid) : undefined;
    const jwk = account?.jwk ?? header.jwk;
    assert.ok(jwk && (path === "/account" || account));
    const key = createPublicKey({ key: jwk, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(body.protected + "." + body.payload), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(body.signature, "base64url")), "fixture verifies every ACME JWS");
    const payload = body.payload ? JSON.parse(Buffer.from(body.payload, "base64url").toString()) : null;
    if (path === "/account") {
      assert.equal(payload.termsOfServiceAgreed, true);
      const thumbprint = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(jwk).sort()))).digest("base64url");
      const existing = accounts.get(thumbprint);
      const current = existing ?? { url: url(`/account/${accounts.size + 1}`), jwk, thumbprint };
      if (!existing) { accounts.set(thumbprint, current); fixture.counters.accounts++; }
      json(existing ? 200 : 201, { status: "valid", orders: current.url + "/orders" }, { location: current.url }); return;
    }
    if (path === new URL(account!.url).pathname) { fixture.counters.accountUpdates++; json(200, { status: "valid", orders: account!.url + "/orders" }); return; }
    if (new URL(path, fixture.origin).pathname === new URL(account!.url).pathname + "/orders") {
      fixture.counters.reconciliations++; assert.equal(payload, null);
      if (fixture.paginateOrders && !path.includes("?cursor=2")) {
        const next = fixture.foreignOrdersPage ? "https://foreign.fixture.test/orders" : account!.url + "/orders" + (fixture.cyclicOrdersPage ? "" : "?cursor=2");
        json(200, { orders: [] }, { link: `<${fixture.origin}/directory>;rel="index", <${next}>;rel="next"` }); return;
      }
      json(200, { orders: orders.filter(order => order.account === account).map(order => url(`/order/${order.id}`)) }); return;
    }
    if (path === "/new-order") {
      assert.equal(payload.identifiers.length, 1); assert.equal(payload.identifiers[0].type, "dns");
      const hostname = payload.identifiers[0].value; assert.match(hostname, /^n[0-9a-f]{40}\.nodes\.fixture\.test$/u);
      const order: FixtureOrder = { id: orders.length + 1, hostname, account: account!, status: "pending", token: randomBytes(24).toString("base64url"), expires: fixture.now + 7 * 86400_000 };
      orders.push(order); fixture.counters.orders++;
      if (fixture.dropOrderResponse) { fixture.dropOrderResponse = false; request.socket.destroy(); return; }
      json(201, orderJSON(order), { location: url(`/order/${order.id}`) }); return;
    }
    const order = orders.find(order => path.endsWith(`/${order.id}`) && order.account === account);
    if (!order) { json(404, {}); return; }
    if (path.startsWith("/order/")) { assert.equal(payload, null); json(200, orderJSON(order)); return; }
    if (path.startsWith("/authz/")) {
      assert.equal(payload, null); json(200, { identifier: { type: "dns", value: order.hostname }, status: order.status === "pending" ? "pending" : "valid",
        challenges: [{ type: "http-01", url: url(`/challenge/${order.id}`), token: order.token, status: order.status === "pending" ? "pending" : "valid" }] }); return;
    }
    if (path.startsWith("/challenge/")) {
      fixture.counters.challenges++;
      const authorization = await fixture.probe(order.hostname, order.token);
      assert.equal(authorization, order.token + "." + account!.thumbprint, "real HTTP01 endpoint must prove possession of this account");
      order.status = "ready"; json(200, { type: "http-01", url: url(path), token: order.token, status: "valid" }); return;
    }
    if (path.startsWith("/finalize/")) {
      assert.equal(order.status, "ready"); fixture.counters.finalizations++;
      const csr = Buffer.from(payload.csr, "base64url"); const parsed = new Pkcs10CertificateRequest(csr);
      assert.ok(await parsed.verify(webcrypto));
      const names = acme.crypto.readCsrDomains(Buffer.from(parsed.toString("pem")));
      assert.equal(names.commonName, order.hostname); assert.deepEqual(names.altNames, [order.hostname]);
      const certificateNames = [order.hostname, ...(fixture.additionalCertificateName ? ["foreign.fixture.test"] : [])];
      order.certificate = await signCSR(csr, certificateNames);
      if (fixture.selfSignedCertificate) {
        const selfKeys = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
        order.certificate = (await X509CertificateGenerator.createSelfSigned({ name: `CN=${order.hostname}`, keys: selfKeys,
          extensions: [new SubjectAlternativeNameExtension([{ type: "dns", value: order.hostname }])] }, webcrypto)).toString("pem");
      }
      order.status = "valid";
      if (fixture.dropFinalizeResponse) { fixture.dropFinalizeResponse = false; request.socket.destroy(); return; }
      json(200, orderJSON(order)); return;
    }
    if (path.startsWith("/certificate/")) {
      assert.equal(payload, null); assert.ok(order.certificate); fixture.counters.certificates++;
      response.writeHead(200, { "content-type": "application/pem-certificate-chain" }); response.end(order.certificate); return;
    }
    json(404, {});
  }
  return fixture;
}

export function readRelayHTTP01(hostname: string, token: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method: "GET", path: `/.well-known/acme-challenge/${token}`,
      headers: { host: hostname }, agent: false }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; if (body.length > 4096) response.destroy(); });
      response.once("end", () => response.statusCode === 200 ? resolve(body) : reject(new Error("Fixture HTTP01 was denied")));
      response.once("error", reject);
    });
    request.setTimeout(5000, () => request.destroy(new Error("Fixture HTTP01 timed out")));
    request.once("error", reject); request.end();
  });
}
