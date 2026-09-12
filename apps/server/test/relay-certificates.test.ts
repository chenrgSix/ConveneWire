import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import * as acme from "acme-client";
import { RelayCertificates, RelayCertificateRetryError } from "../src/local-node/relay-certificates.js";
import { createRelayCAFixture, readRelayHTTP01 } from "./helpers/relay-ca-fixture.js";

const hostname = `n${"a".repeat(40)}.nodes.fixture.test`;
async function attach(t: TestContext, certificates: RelayCertificates) {
  const server = createServer(socket => certificates.acceptChallenge(socket));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  t.after(async () => { await certificates.close(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return address.port;
}
async function manager(t: TestContext, fixture: Awaited<ReturnType<typeof createRelayCAFixture>>, suffix = "node", name = hostname) {
  const root = path.join(fixture.directory, suffix); await mkdir(root, { mode: 0o700 });
  const certificates = new RelayCertificates(root, fixture.profile, name, { httpsAgent: fixture.agent, clock: fixture.clock });
  const port = await attach(t, certificates); fixture.probe = (host, token) => readRelayHTTP01(host, token, port);
  return { root, certificates, port };
}
function counts() {
  const size = (value: unknown) => (value as { handlers: unknown[] }).handlers.filter(Boolean).length;
  return [size(acme.axios.interceptors.request), size(acme.axios.interceptors.response)];
}
async function rawHTTP(port: number, headers: Record<string, string>, method = "GET", requestPath = "/.well-known/acme-challenge/" + "A".repeat(32)) {
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path: requestPath, method, headers, agent: false }, response => {
      response.resume(); response.once("end", () => resolve(response.statusCode!));
    });
    request.once("error", reject); request.end();
  });
}

test("Relay certificates use real ACME JWS/CSR and HTTP01, private atomic cache and offline restart", async t => {
  const f = await createRelayCAFixture(t), m = await manager(t, f), before = counts();
  await m.certificates.load(); assert.equal(f.counters.requests, 0); assert.equal(m.certificates.context(), null);
  await m.certificates.ensure(new AbortController().signal);
  assert.ok(m.certificates.context()); assert.ok(m.certificates.expiresAt());
  assert.deepEqual(f.counters, { requests: f.counters.requests, accounts: 1, orders: 1, challenges: 1, finalizations: 1, certificates: 1, accountUpdates: 0, reconciliations: 0 });
  assert.deepEqual(counts(), before);
  const cachePath = path.join(m.root, "certificates.json"), cache = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal((await stat(cachePath)).mode & 0o777, 0o600); assert.notEqual(cache.accountKey, cache.certificate.key);
  assert.equal(cache.order, null); assert.equal(cache.certificate.chain.includes("PRIVATE KEY"), false);
  const requests = f.counters.requests;
  await m.certificates.ensure(new AbortController().signal); assert.equal(f.counters.requests, requests);
  await m.certificates.close();
  const resumed = new RelayCertificates(m.root, f.profile, hostname, { httpsAgent: f.agent, clock: f.clock }); t.after(() => resumed.close());
  await resumed.load(); await resumed.ensure(new AbortController().signal); assert.ok(resumed.context()); assert.equal(f.counters.requests, requests);
  const metadata = new RelayCertificates(m.root, { ...f.profile, displayName: "Provider display refreshed" }, hostname, { httpsAgent: f.agent, clock: f.clock });
  t.after(() => metadata.close()); await metadata.load(); assert.ok(metadata.context());
  const untrusted = new RelayCertificates(m.root, f.profile, hostname, { clock: f.clock }); t.after(() => untrusted.close());
  await assert.rejects(untrusted.load());
  await chmod(cachePath, 0o644);
  const broad = new RelayCertificates(m.root, f.profile, hostname, { httpsAgent: f.agent, clock: f.clock }); t.after(() => broad.close());
  await assert.rejects(broad.load()); await chmod(cachePath, 0o600);
});

test("Relay HTTP01 handler exposes only live token, exact hostname and GET without browser credentials", async t => {
  const f = await createRelayCAFixture(t), m = await manager(t, f);
  f.probe = async (host, token) => {
    const route = `/.well-known/acme-challenge/${token}`;
    for (const [headers, method, endpoint] of [
      [{ host: "other.fixture.test" }, "GET", route], [{ host, cookie: "private=secret" }, "GET", route],
      [{ host, cookie: "" }, "GET", route], [{ host, authorization: "" }, "GET", route],
      [{ host, authorization: "Bearer private" }, "GET", route], [{ host }, "POST", route],
      [{ host }, "GET", route + "?token=bad"], [{ host }, "GET", "/api/local-node/control"],
      [{ host }, "GET", "/.well-known/acme-challenge/" + "A".repeat(32)]
    ] as Array<[Record<string, string>, string, string]>) assert.equal(await rawHTTP(m.port, headers, method, endpoint), 404);
    return readRelayHTTP01(host, token, m.port);
  };
  await m.certificates.ensure(new AbortController().signal);
  assert.equal(await rawHTTP(m.port, { host: hostname }), 404);
});

test("Relay recovery resumes the same order after lost create or finalize responses", async t => {
  for (const failure of ["dropOrderResponse", "dropFinalizeResponse"] as const) {
    const f = await createRelayCAFixture(t), m = await manager(t, f); f[failure] = true;
    await assert.rejects(m.certificates.ensure(new AbortController().signal));
    const saved = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8")); assert.ok(saved.order);
    assert.equal(f.counters.orders, 1); await m.certificates.close(); f.now += 61_000;
    const resumed = new RelayCertificates(m.root, f.profile, hostname, { httpsAgent: f.agent, clock: f.clock });
    const port = await attach(t, resumed); f.probe = (host, token) => readRelayHTTP01(host, token, port);
    await resumed.load(); await resumed.ensure(new AbortController().signal);
    assert.ok(resumed.context()); assert.equal(f.counters.orders, 1); assert.equal(f.counters.finalizations, 1);
    assert.equal(f.counters.reconciliations, failure === "dropOrderResponse" ? 1 : 0);
    const restored = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8"));
    assert.equal(restored.accountKey, saved.accountKey); assert.equal(restored.certificate.key, saved.order.key);
  }
});

test("Relay renewal respects Retry-After, retains valid old TLS, then atomically replaces and expires", async t => {
  const f = await createRelayCAFixture(t), m = await manager(t, f); await m.certificates.ensure(new AbortController().signal);
  const first = m.certificates.expiresAt()!, previousContext = m.certificates.context();
  f.now += 24 * 86400_000; f.failPath = "/new-order"; f.retryAfter = "120";
  await assert.rejects(m.certificates.ensure(new AbortController().signal), RelayCertificateRetryError);
  assert.equal(m.certificates.context(), previousContext); assert.equal(m.certificates.expiresAt(), first);
  const requests = f.counters.requests; f.now += 119_000;
  await assert.rejects(m.certificates.ensure(new AbortController().signal), RelayCertificateRetryError); assert.equal(f.counters.requests, requests);
  f.now += 1000; f.failPath = null;
  await m.certificates.ensure(new AbortController().signal); assert.equal(f.counters.orders, 2);
  assert.ok(Date.parse(m.certificates.expiresAt()!) > Date.parse(first)); assert.notEqual(m.certificates.context(), previousContext);
  f.now = Date.parse(m.certificates.expiresAt()!); assert.equal(m.certificates.context(), null);
  const expired = new RelayCertificates(m.root, f.profile, hostname, { httpsAgent: f.agent, clock: f.clock });
  t.after(() => expired.close()); const requestsBeforeLoad = f.counters.requests;
  await expired.load(); assert.equal(expired.context(), null); assert.equal(f.counters.requests, requestsBeforeLoad);
});

test("Relay ACME cancellation closes requests and removes scoped interceptors without default mutation", async t => {
  const f = await createRelayCAFixture(t), m = await manager(t, f), before = counts();
  const defaults = { ...acme.axios.defaults, acmeSettings: { ...(acme.axios.defaults as unknown as { acmeSettings: object }).acmeSettings } }; f.blockedPath = "/directory";
  const controller = new AbortController(); const active = m.certificates.ensure(controller.signal);
  const rejection = assert.rejects(active, /取消/u);
  for (let attempt = 0; !f.blockedRequests && attempt < 100; attempt++) await delay(10);
  assert.equal(f.blockedRequests, 1); controller.abort(); await rejection;
  assert.deepEqual(counts(), before); assert.deepEqual({ ...acme.axios.defaults }, defaults); assert.equal(m.certificates.context(), null);
  f.blockedPath = null; await m.certificates.ensure(new AbortController().signal); assert.ok(m.certificates.context());
});

test("Relay ACME rejects foreign endpoints, changed identifiers, multi-name certificates and unreviewed CA terms", async t => {
  for (const failure of ["foreignDirectoryOrigin", "foreignOrderOrigin", "additionalIdentifier", "additionalCertificateName", "selfSignedCertificate"] as const) {
    const f = await createRelayCAFixture(t), m = await manager(t, f); f[failure] = true;
    await assert.rejects(m.certificates.ensure(new AbortController().signal)); assert.equal(m.certificates.context(), null);
    assert.equal(f.counters.certificates, ["additionalCertificateName", "selfSignedCertificate"].includes(failure) ? 1 : 0);
    assert.ok(f.lookups.every(name => name === "ca.fixture.test"), "no foreign endpoint may reach DNS or TLS");
  }
  const f = await createRelayCAFixture(t), m = await manager(t, f); await m.certificates.ensure(new AbortController().signal);
  const first = m.certificates.expiresAt(), state = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8"));
  f.now += 24 * 86400_000; f.termsUrl = f.origin + "/terms-v2";
  await assert.rejects(m.certificates.ensure(new AbortController().signal)); assert.equal(m.certificates.expiresAt(), first); assert.ok(m.certificates.context());
  const reviewed = new RelayCertificates(m.root, { ...f.profile, termsUrl: f.termsUrl }, hostname, { httpsAgent: f.agent, clock: f.clock });
  const port = await attach(t, reviewed); f.probe = (host, token) => readRelayHTTP01(host, token, port); f.now += 61_000;
  await reviewed.load(); await reviewed.ensure(new AbortController().signal);
  assert.equal(f.counters.accounts, 1); assert.equal(f.counters.accountUpdates, 1); assert.equal(f.counters.orders, 2);
  const after = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8")); assert.equal(after.accountKey, state.accountKey); assert.equal(after.acceptedTermsUrl, f.termsUrl);
});

test("parallel Relay Nodes isolate CA agents, requests, account keys and certificates", async t => {
  const f1 = await createRelayCAFixture(t), f2 = await createRelayCAFixture(t);
  const m1 = await manager(t, f1), m2 = await manager(t, f2, "second", `n${"b".repeat(40)}.nodes.fixture.test`), before = counts();
  await Promise.all([m1.certificates.ensure(new AbortController().signal), m2.certificates.ensure(new AbortController().signal)]);
  assert.ok(m1.certificates.context()); assert.ok(m2.certificates.context()); assert.deepEqual(counts(), before);
  assert.equal(f1.counters.orders, 1); assert.equal(f2.counters.orders, 1);
  const a = JSON.parse(await readFile(path.join(m1.root, "certificates.json"), "utf8")), b = JSON.parse(await readFile(path.join(m2.root, "certificates.json"), "utf8"));
  assert.notEqual(a.accountKey, b.accountKey); assert.notEqual(a.certificate.key, b.certificate.key);
});

test("known rejected newOrder remains retryable while uncertain transport never creates a replacement blindly", async t => {
  for (const failType of ["malformed", "badNonce"]) {
    const f = await createRelayCAFixture(t), m = await manager(t, f);
    f.failPath = "/new-order"; f.failStatus = 400; f.failType = failType; f.retryAfter = "1";
    await assert.rejects(m.certificates.ensure(new AbortController().signal));
    const saved = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8"));
    assert.equal(saved.order.creationAttempted, false); assert.equal(f.counters.orders, 0);
    f.now += 61_000; f.failPath = null;
    await m.certificates.ensure(new AbortController().signal); assert.ok(m.certificates.context());
    const final = JSON.parse(await readFile(path.join(m.root, "certificates.json"), "utf8"));
    assert.equal(final.certificate.key, saved.order.key); assert.equal(f.counters.orders, 1); assert.equal(f.counters.reconciliations, 0);
  }
});

test("uncertain newOrder recovery accepts index links and bounded same-origin pagination, rejecting loops or foreign pages", async t => {
  for (const mode of ["valid", "foreign", "cycle"]) {
    const f = await createRelayCAFixture(t), m = await manager(t, f);
    f.dropOrderResponse = true; f.paginateOrders = true; f.foreignOrdersPage = mode === "foreign"; f.cyclicOrdersPage = mode === "cycle";
    await assert.rejects(m.certificates.ensure(new AbortController().signal)); assert.equal(f.counters.orders, 1);
    f.now += 61_000;
    if (mode === "valid") {
      await m.certificates.ensure(new AbortController().signal); assert.ok(m.certificates.context()); assert.equal(f.counters.reconciliations, 2);
    } else {
      await assert.rejects(m.certificates.ensure(new AbortController().signal)); assert.equal(m.certificates.context(), null);
      assert.equal(f.counters.reconciliations, 1); assert.ok(f.lookups.every(name => name === "ca.fixture.test"));
    }
    assert.equal(f.counters.orders, 1, "pagination errors cannot blindly create another order");
  }
});
