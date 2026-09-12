import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { createServer, type Server } from "node:http";
import { Agent } from "node:https";
import type { Duplex } from "node:stream";
import { createSecureContext, rootCertificates, type SecureContext } from "node:tls";
import { setTimeout as delay } from "node:timers/promises";
import * as acme from "acme-client";
import type { RelayServiceProfile } from "@convene-wire/contracts/peer";
import { canonicalPeerJson, parsePeerJson } from "@convene-wire/contracts/peer-json";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { exactObject, privateRead, privateWrite, relayInvalid } from "./relay-private.js";

type PendingOrder = { url: string | null; key: string; csr: string; creationAttempted: boolean };
type CertificateBundle = { key: string; chain: string; orderUrl: string };
type CertificateState = {
  schemaVersion: 1; profileDigest: string; hostname: string; accountKey: string | null;
  accountUrl: string | null; ordersUrl: string | null; acceptedTermsUrl: string | null; order: PendingOrder | null;
  certificate: CertificateBundle | null; nextAttemptAt: number | null;
};
type RequestScope = { owner: RelayCertificates; signal: AbortSignal };
const requests = new AsyncLocalStorage<RequestScope>();
const maximumRetry = 24 * 3600_000;
const defaultRetry = 60_000;
const certificateFile = "certificates.json";
const failed = () => new Error("HTTPS 证书暂不可用，请稍后重试。");
const closed = () => new Error("HTTPS 证书操作已取消。");
const safeToken = /^[A-Za-z0-9_-]{22,128}$/u;

export class RelayCertificateRetryError extends Error {
  public constructor(public readonly retryAt: number) { super("证书服务要求稍后重试。"); this.name = "RelayCertificateRetryError"; }
}

/** Separate ACME/TLS keys and a durable single order. No network is used by load. */
export class RelayCertificates {
  private state: CertificateState;
  private loaded = false;
  private cached: { context: SecureContext; notBefore: number; notAfter: number; renewAt: number } | null = null;
  private readonly controller = new AbortController();
  private readonly streams = new Set<Duplex>();
  private readonly challenges = new Map<string, string>();
  private readonly http: Server;
  private pending: Promise<void> | null = null;
  private readonly profile: RelayServiceProfile;
  private readonly caOrigin: string;
  private readonly trustedRoots: X509Certificate[];
  private readonly agent: Agent;
  private readonly clock: () => number;
  private requestRetryAt: number | null = null;
  private newOrderUrl: string | null = null;

  public constructor(private readonly root: string, profile: RelayServiceProfile, private readonly hostname: string,
    private readonly options: { httpsAgent?: Agent | undefined; clock?: (() => number) | undefined } = {}) {
    if (!validatePeer("RelayServiceProfile", profile) || !validatePeer("RelayRegistered", {
      schemaVersion: 1, type: "registered", hostname, sessionToken: "A".repeat(43)
    }) || !hostname.endsWith(`.${profile.nodeDomain}`) || hostname.slice(42) !== profile.nodeDomain) throw relayInvalid();
    this.profile = structuredClone(profile); this.caOrigin = new URL(profile.acmeDirectoryUrl).origin;
    this.clock = options.clock ?? Date.now;
    this.agent = options.httpsAgent ?? new Agent({ keepAlive: false });
    const configuredCA = options.httpsAgent?.options.ca as string | Buffer | Array<string | Buffer> | undefined;
    const trustedPEM = configuredCA === undefined ? rootCertificates : Array.isArray(configuredCA) ? configuredCA : [configuredCA];
    this.trustedRoots = trustedPEM.flatMap(pem => acme.crypto.splitPemChain(pem)).map(pem => new X509Certificate(pem));
    if (!this.trustedRoots.length) throw relayInvalid();
    const identity = { schemaVersion: profile.schemaVersion, id: profile.id, relayOrigin: profile.relayOrigin,
      nodeDomain: profile.nodeDomain, acmeDirectoryUrl: profile.acmeDirectoryUrl };
    this.state = { schemaVersion: 1, profileDigest: createHash("sha256").update(canonicalPeerJson(identity)).digest("hex"),
      hostname, accountKey: null, accountUrl: null, ordersUrl: null, acceptedTermsUrl: null, order: null, certificate: null, nextAttemptAt: null };
    this.http = createServer({ maxHeaderSize: 4096 }, (request, response) => {
      const seen = new Set<string>(); let duplicate = false;
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]!.toLowerCase();
        if (seen.has(name)) duplicate = true; seen.add(name);
      }
      const token = request.url?.slice("/.well-known/acme-challenge/".length);
      const valid = !this.controller.signal.aborted && !duplicate && request.method === "GET" &&
        request.headers.host === this.hostname && request.url === `/.well-known/acme-challenge/${token}` &&
        typeof token === "string" && safeToken.test(token) &&
        request.headers.authorization === undefined && request.headers.cookie === undefined && request.headers["proxy-authorization"] === undefined &&
        !request.headers["transfer-encoding"] && (!request.headers["content-length"] || request.headers["content-length"] === "0");
      const authorization = valid ? this.challenges.get(token!) : undefined;
      response.writeHead(authorization ? 200 : 404, { "content-type": "text/plain", "cache-control": "no-store", connection: "close" });
      response.end(authorization ?? "Not found");
    });
    this.http.headersTimeout = 5000; this.http.requestTimeout = 5000; this.http.keepAliveTimeout = 1;
    this.http.maxHeadersCount = 32;
    this.http.on("clientError", (_error, socket) => socket.destroy());
    this.http.on("upgrade", (_request, socket) => socket.destroy());
    this.http.on("connect", (_request, socket) => socket.destroy());
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    if (this.controller.signal.aborted) throw closed();
    const raw = await privateRead(this.root, certificateFile);
    if (raw) {
      const parsed = exactObject(parsePeerJson(raw), Object.keys(this.state));
      if (parsed.schemaVersion !== 1 || parsed.profileDigest !== this.state.profileDigest || parsed.hostname !== this.hostname ||
          !nullableString(parsed.accountKey) || !nullableString(parsed.accountUrl) || !nullableString(parsed.ordersUrl) || !nullableString(parsed.acceptedTermsUrl) ||
          !(parsed.nextAttemptAt === null || typeof parsed.nextAttemptAt === "number" && Number.isSafeInteger(parsed.nextAttemptAt) && parsed.nextAttemptAt >= 0)) throw relayInvalid();
      const state = parsed as unknown as CertificateState;
      if (state.accountKey) this.privateKey(state.accountKey);
      if (state.accountUrl) this.url(state.accountUrl);
      if (state.ordersUrl) this.url(state.ordersUrl);
      if (state.acceptedTermsUrl && !validatePeer("RelayHTTPSURL", state.acceptedTermsUrl)) throw relayInvalid();
      if ((state.accountUrl || state.order || state.certificate) && !state.accountKey) throw relayInvalid();
      if (state.order) {
        const order = exactObject(state.order, ["url", "key", "csr", "creationAttempted"]);
        if (!nullableString(order.url) || typeof order.key !== "string" || typeof order.csr !== "string" || typeof order.creationAttempted !== "boolean") throw relayInvalid();
        if (state.order.url) this.url(state.order.url);
        this.privateKey(state.order.key);
        const names = acme.crypto.readCsrDomains(state.order.csr);
        if (names.commonName !== this.hostname || names.altNames.length !== 1 || names.altNames[0] !== this.hostname) throw relayInvalid();
      }
      if (state.certificate) this.cached = this.bundle(state.certificate);
      this.state = structuredClone(state);
    }
    this.loaded = true;
  }

  public context(): SecureContext | null {
    const now = this.clock();
    return !this.controller.signal.aborted && this.cached && now >= this.cached.notBefore && now < this.cached.notAfter ? this.cached.context : null;
  }
  public expiresAt(): string | null { return this.cached ? new Date(this.cached.notAfter).toISOString() : null; }
  public nextAttemptAt(): number | null { return this.state.nextAttemptAt; }

  public ensure(signal: AbortSignal): Promise<void> {
    if (this.pending) return this.pending;
    const combined = AbortSignal.any([signal, this.controller.signal]);
    const run = this.provision(combined);
    this.pending = run;
    void run.finally(() => { if (this.pending === run) this.pending = null; }).catch(() => {});
    return run;
  }

  public acceptChallenge(stream: Duplex): void {
    if (this.controller.signal.aborted || this.streams.size >= 32) { stream.destroy(); return; }
    this.streams.add(stream);
    const timer = setTimeout(() => stream.destroy(), 10_000); timer.unref();
    stream.once("close", () => { clearTimeout(timer); this.streams.delete(stream); });
    stream.on("error", () => {});
    this.http.emit("connection", stream);
  }

  public async close(): Promise<void> {
    this.controller.abort(); this.challenges.clear();
    for (const stream of this.streams) stream.destroy();
    await this.pending?.catch(() => {});
    if (!this.options.httpsAgent) this.agent.destroy();
    this.cached = null;
  }

  private url(value: string): string {
    if (!validatePeer("RelayHTTPSURL", value) || new URL(value).origin !== this.caOrigin) throw failed();
    return value;
  }
  private privateKey(value: string): void {
    if (value.length > 16 * 1024) throw relayInvalid();
    const key = createPrivateKey(value);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw relayInvalid();
  }
  private async save(): Promise<void> { await privateWrite(this.root, certificateFile, Buffer.from(canonicalPeerJson(this.state))); }

  private bundle(value: CertificateBundle): NonNullable<RelayCertificates["cached"]> {
    exactObject(value, ["key", "chain", "orderUrl"]);
    if (typeof value.key !== "string" || typeof value.chain !== "string" || typeof value.orderUrl !== "string" || value.chain.length > 64 * 1024) throw relayInvalid();
    this.url(value.orderUrl); this.privateKey(value.key);
    const chain = acme.crypto.splitPemChain(value.chain).map(pem => new X509Certificate(pem));
    if (!chain.length || chain.length > 6 || chain[0]!.ca || chain[0]!.subjectAltName !== `DNS:${this.hostname}` ||
        !chain[0]!.checkPrivateKey(createPrivateKey(value.key)) || chain[0]!.checkHost(this.hostname, { subject: "never", wildcards: false }) !== this.hostname ||
        (chain[0]!.keyUsage?.length && !chain[0]!.keyUsage.includes("1.3.6.1.5.5.7.3.1"))) throw relayInvalid();
    let current = chain[0]!, anchor: X509Certificate | undefined; const seen = new Set<string>();
    for (let depth = 0; depth < 7; depth++) {
      if (seen.has(current.fingerprint256)) throw relayInvalid(); seen.add(current.fingerprint256);
      const root = this.trustedRoots.find(root => root.ca && current.checkIssued(root) && current.verify(root.publicKey));
      if (root) { anchor = root; break; }
      const issuer = chain.find(candidate => candidate.ca && candidate.fingerprint256 !== current.fingerprint256 && current.checkIssued(candidate) && current.verify(candidate.publicKey));
      if (!issuer || depth === 6) throw relayInvalid();
      current = issuer;
    }
    if (!anchor) throw relayInvalid();
    const notBefore = Math.max(...[...chain, anchor].map(item => Date.parse(item.validFrom)));
    const notAfter = Math.min(...[...chain, anchor].map(item => Date.parse(item.validTo)));
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || notAfter <= notBefore) throw relayInvalid();
    return { context: createSecureContext({ key: value.key, cert: value.chain, minVersion: "TLSv1.2" }), notBefore, notAfter,
      renewAt: notAfter - Math.min((notAfter - notBefore) / 3, 7 * 86400_000) };
  }

  private order(value: acme.Order): acme.Order {
    if (!value || !["pending", "ready", "processing", "valid", "invalid"].includes(value.status) ||
        !Array.isArray(value.identifiers) || value.identifiers.length !== 1 || value.identifiers[0]?.type !== "dns" || value.identifiers[0].value !== this.hostname ||
        !Array.isArray(value.authorizations) || value.authorizations.length !== 1 || typeof value.finalize !== "string" || typeof value.url !== "string") throw failed();
    this.url(value.url); this.url(value.finalize); value.authorizations.forEach(url => this.url(url));
    if (value.certificate !== undefined) this.url(value.certificate);
    if (value.expires !== undefined && !Number.isFinite(Date.parse(value.expires))) throw failed();
    return value;
  }

  private async provision(signal: AbortSignal): Promise<void> {
    await this.load(); signal.throwIfAborted();
    if (this.context() && this.cached && this.clock() < this.cached.renewAt) return;
    if (this.state.nextAttemptAt && this.clock() < this.state.nextAttemptAt) throw new RelayCertificateRetryError(this.state.nextAttemptAt);
    this.requestRetryAt = null;
    try {
      if (!this.state.accountKey) { this.state.accountKey = (await acme.crypto.createPrivateEcdsaKey()).toString(); signal.throwIfAborted(); await this.save(); }
      const client = new acme.Client({ directoryUrl: this.profile.acmeDirectoryUrl, accountKey: this.state.accountKey,
        ...(this.state.accountUrl ? { accountUrl: this.state.accountUrl } : {}) });
      await this.scoped(signal, async () => {
        const advertisedTerms = await client.getTermsOfServiceUrl();
        if (advertisedTerms && advertisedTerms !== this.profile.termsUrl) throw failed();
        if (!this.state.accountUrl) {
          const account = await client.createAccount({ termsOfServiceAgreed: true });
          if (account.status !== "valid") throw failed();
          this.state.accountUrl = this.url(client.getAccountUrl());
          this.state.ordersUrl = account.orders ? this.url(account.orders) : null;
          this.state.acceptedTermsUrl = this.profile.termsUrl;
          await this.save();
        } else if (this.state.acceptedTermsUrl !== this.profile.termsUrl) {
          await client.updateAccount({ termsOfServiceAgreed: true });
          this.state.acceptedTermsUrl = this.profile.termsUrl; await this.save();
        }
        if (!this.state.order) {
          const key = await acme.crypto.createPrivateEcdsaKey(); signal.throwIfAborted();
          const [, csr] = await acme.crypto.createCsr({ commonName: this.hostname, altNames: [this.hostname] }, key);
          this.state.order = { url: null, key: key.toString(), csr: csr.toString(), creationAttempted: false };
          await this.save();
        }
        let order: acme.Order;
        if (this.state.order.url) order = this.order(await client.getOrder({ url: this.state.order.url } as acme.Order));
        else if (this.state.order.creationAttempted) order = await this.reconcile(client);
        else {
          order = this.order(await client.createOrder({ identifiers: [{ type: "dns", value: this.hostname }] }));
          this.state.order.url = order.url; await this.save();
        }
        for (let attempt = 0; attempt < 20; attempt++) {
          signal.throwIfAborted(); this.order(order);
          if (order.status === "invalid" || order.expires && Date.parse(order.expires) <= this.clock()) {
            this.state.order = null; throw new RelayCertificateRetryError(this.clock() + 3600_000);
          }
          if (order.status === "valid") {
            const certificate: CertificateBundle = { key: this.state.order.key, chain: await client.getCertificate(order), orderUrl: order.url };
            const checked = this.bundle(certificate);
            if (this.clock() < checked.notBefore || this.clock() >= checked.notAfter || this.cached && checked.notAfter <= this.cached.notAfter) throw failed();
            signal.throwIfAborted();
            // Keep the known order in memory until the complete key/chain
            // bundle commits. An ambiguous fsync can retry this same order.
            const next = { ...this.state, certificate, order: null, nextAttemptAt: null };
            await privateWrite(this.root, certificateFile, Buffer.from(canonicalPeerJson(next)));
            this.state = next;
            this.cached = checked; return;
          }
          if (order.status === "ready") order = this.order(await client.finalizeOrder(order, this.state.order.csr));
          else {
            if (order.status === "pending") await this.authorize(client, order, signal);
            await delay(this.pollDelay(), undefined, { signal });
            order = this.order(await client.getOrder(order));
          }
        }
        throw new RelayCertificateRetryError(Math.max(this.clock() + defaultRetry, this.requestRetryAt ?? 0));
      });
    } catch (error) {
      if (signal.aborted) throw closed();
      const retryAt = error instanceof RelayCertificateRetryError ? error.retryAt : Math.max(this.clock() + defaultRetry, this.requestRetryAt ?? 0);
      this.state.nextAttemptAt = Math.min(this.clock() + maximumRetry, retryAt); await this.save();
      if (error instanceof RelayCertificateRetryError) throw new RelayCertificateRetryError(this.state.nextAttemptAt);
      throw failed();
    } finally { this.challenges.clear(); }
  }

  private async authorize(client: acme.Client, order: acme.Order, signal: AbortSignal): Promise<void> {
    const authorizations = await client.getAuthorizations(order);
    if (authorizations.length !== 1) throw failed();
    const authorization = authorizations[0]!;
    if (authorization.identifier?.type !== "dns" || authorization.identifier.value !== this.hostname || authorization.wildcard ||
        !["pending", "valid"].includes(authorization.status) || !Array.isArray(authorization.challenges) || authorization.challenges.length > 8) throw failed();
    if (authorization.status === "valid") return;
    const matches = authorization.challenges.filter(challenge => challenge.type === "http-01");
    if (matches.length !== 1) throw failed();
    const challenge = matches[0]!;
    this.url(challenge.url);
    if (!safeToken.test(challenge.token) || challenge.token.includes("\n") || !["pending", "processing", "valid"].includes(challenge.status)) throw failed();
    this.challenges.set(challenge.token, await client.getChallengeKeyAuthorization(challenge));
    signal.throwIfAborted();
    if (challenge.status === "pending") await client.completeChallenge(challenge);
  }

  private pollDelay(): number {
    const wait = Math.max(1000, (this.requestRetryAt ?? 0) - this.clock());
    if (wait > 30_000) throw new RelayCertificateRetryError(this.requestRetryAt!);
    this.requestRetryAt = null; return wait;
  }

  private async reconcile(client: acme.Client): Promise<acme.Order> {
    if (!this.state.ordersUrl) throw new RelayCertificateRetryError(this.clock() + 3600_000);
    // ACME POST-as-GET uses the same signed account client. This narrow SDK API
    // bridge is pinned to acme-client 5.4; every URL still crosses scoped checks.
    const api = (client as unknown as { api: { apiRequest(url: string, payload: null, statuses: number[]): Promise<{ data: unknown; headers: Record<string, unknown> }> } }).api;
    const pages = new Set<string>(), candidates = new Set<string>();
    let page: string | null = this.state.ordersUrl;
    while (page) {
      this.url(page);
      if (pages.has(page) || pages.size >= 4) throw failed(); pages.add(page);
      const response = await api.apiRequest(page, null, [200]);
      const data = response.data as { orders?: unknown };
      if (!Array.isArray(data?.orders) || data.orders.length > 128) throw failed();
      for (const candidate of data.orders) {
        if (typeof candidate !== "string") throw failed(); this.url(candidate); candidates.add(candidate);
        if (candidates.size > 128) throw failed();
      }
      page = nextOrderPage(response.headers.link);
    }
    const found: acme.Order[] = [];
    for (const candidate of candidates) {
      if (candidate === this.state.certificate?.orderUrl) continue;
      const order = this.order(await client.getOrder({ url: candidate } as acme.Order));
      if (["pending", "ready"].includes(order.status)) found.push(order);
    }
    if (found.length !== 1) throw new RelayCertificateRetryError(this.clock() + 3600_000);
    this.state.order!.url = found[0]!.url; await this.save(); return found[0]!;
  }

  private async scoped<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    const scope = { owner: this, signal };
    const requestId = acme.axios.interceptors.request.use(async config => {
      if (requests.getStore() !== scope) return config;
      signal.throwIfAborted(); this.url(config.url!);
      config.signal = signal; config.timeout = 15_000; config.proxy = false; config.maxRedirects = 0;
      config.maxContentLength = 128 * 1024; config.maxBodyLength = 32 * 1024;
      config.httpsAgent = this.agent;
      // The SDK's retry sleep is not cancelable. Skip only this request's retry
      // loop, without mutating the shared Axios instance/defaults.
      (config as typeof config & { retryAttempt: number }).retryAttempt = Number.MAX_SAFE_INTEGER;
      if (config.url === this.newOrderUrl && config.method?.toLowerCase() === "post" && this.state.order && !this.state.order.url) {
        this.state.order.creationAttempted = true; await this.save(); signal.throwIfAborted();
      }
      return config;
    });
    const responseId = acme.axios.interceptors.response.use(async response => {
      if (requests.getStore() !== scope) return response;
      const wait = retryAfter(response.headers["retry-after"], this.clock());
      if (wait !== null) this.requestRetryAt = Math.max(this.requestRetryAt ?? 0, wait);
      if (response.config.url === this.newOrderUrl && response.config.method?.toLowerCase() === "post" && this.state.order && !this.state.order.url &&
          (response.status === 429 || definitelyRejectedOrder(response.status, response.data))) {
        const next = { ...this.state, order: { ...this.state.order, creationAttempted: false } };
        await privateWrite(this.root, certificateFile, Buffer.from(canonicalPeerJson(next))); this.state = next;
      }
      if (response.status === 429 || response.status >= 500) throw new RelayCertificateRetryError(wait ?? this.clock() + defaultRetry);
      if (response.status >= 300 && response.status < 400) throw failed();
      if (response.config.url === this.profile.acmeDirectoryUrl) {
        const directory = response.data as Record<string, unknown>;
        for (const name of ["newNonce", "newAccount", "newOrder"]) if (typeof directory?.[name] !== "string") throw failed(); else this.url(directory[name]);
        this.newOrderUrl = directory.newOrder as string;
      }
      return response;
    });
    try { return await requests.run(scope, operation); }
    finally { acme.axios.interceptors.request.eject(requestId); acme.axios.interceptors.response.eject(responseId); }
  }
}

function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string" && value.length > 0; }
function nextOrderPage(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 8192) throw failed();
  const links = value.split(/,(?=\s*<)/u); if (links.length > 8) throw failed();
  const next: string[] = [];
  for (const link of links) {
    const match = /^\s*<([^<>]+)>\s*(.*)$/u.exec(link); if (!match) throw failed();
    const relations = [...match[2]!.matchAll(/(?:^|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/giu)];
    if (relations.length > 1) throw failed();
    const rel = relations[0]?.[1] ?? relations[0]?.[2] ?? "";
    if (rel.toLowerCase().split(/\s+/u).includes("next")) next.push(match[1]!);
  }
  if (next.length > 1) throw failed();
  return next[0] ?? null;
}
function definitelyRejectedOrder(status: number, value: unknown): boolean {
  if (![400, 401, 403, 404, 405, 410, 415, 422].includes(status) || !value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && ["badNonce", "malformed", "unauthorized", "rejectedIdentifier", "unsupportedIdentifier",
    "accountDoesNotExist", "externalAccountRequired", "invalidContact", "userActionRequired", "badPublicKey", "badSignatureAlgorithm"]
    .some(name => type === `urn:ietf:params:acme:error:${name}`);
}
function retryAfter(value: unknown, now: number): number | null {
  if (typeof value !== "string") return null;
  const duration = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(duration) ? now + Math.min(maximumRetry, Math.max(1000, duration)) : null;
}
