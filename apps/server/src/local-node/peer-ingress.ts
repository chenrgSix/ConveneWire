import https from "node:https";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { PeerIngressMaterial } from "./peer-ingress-configuration.js";
import { parsePeerIngressConfiguration, validatePeerIngressCertificate } from "./peer-ingress-configuration.js";

export type PeerIngressRequestKind = "machine" | "browser-entry" | "browser" | "public";
const machinePaths = new Set([
  "/api/peer/identity", "/api/peer/invitations/preview", "/api/peer/invitations/challenge", "/api/peer/invitations/claim",
  "/api/peer/human-entry", "/api/peer/agents/offers", "/api/peer/agents/sync", "/api/peer/memberships/leave", "/api/peer/runs/admit",
  "/api/peer/runs/poll", "/api/peer/runs/events", "/api/peer/runs/settle"
]);
const browserFamilies = /^\/api\/(?:teams|rooms|messages|agents|runs|tasks|discussions|memory-candidates|workbench|execution-plans|results|artifacts)(?:\/|$)/u;
const publicFiles = /^(?:\/|\/index\.html|\/favicon\.(?:ico|svg)|\/assets\/[A-Za-z0-9_./-]+)$/u;

/** A second TLS listener feeding the same Host. No URL rewriting, proxy trust,
 * credential conversion or second database/service instance is involved. */
export class PeerIngress {
  public readonly configuration;
  private readonly requests = new WeakMap<IncomingMessage, PeerIngressRequestKind>();
  private readonly sockets = new Set<Duplex>();
  private listener?: https.Server;
  private attached = false;
  private readonly abort = new AbortController();
  private stopping: Promise<void> | undefined;

  public constructor(private readonly material: PeerIngressMaterial) {
    this.configuration = Object.freeze(parsePeerIngressConfiguration(material.configuration));
    if (this.configuration.enabled) {
      if (!material.tls) throw new Error("Peer HTTPS certificate is required");
      validatePeerIngressCertificate(this.configuration, material.tls.cert, material.tls.key);
    }
  }

  public kind(request: IncomingMessage): PeerIngressRequestKind | undefined { return this.requests.get(request); }

  private classify(request: IncomingMessage, upgrade: boolean): PeerIngressRequestKind | undefined {
    const h = request.headers, rawPath = request.url?.split("?", 1)[0];
    if (!rawPath || !rawPath.startsWith("/") || rawPath.startsWith("//") || /[%\\\x00-\x20]/u.test(rawPath) ||
        rawPath.split("/").some(part => part === "." || part === "..") ||
        h.host !== new URL(this.configuration.origin).host || (h.origin !== undefined && h.origin !== this.configuration.origin)) return undefined;
    if (Object.keys(h).some(key => key === "forwarded" || key.startsWith("x-forwarded-") || key === "proxy-authorization" ||
        /^x-(?:convenewire|convene-wire|agent-room)-/u.test(key))) return undefined;
    const unique = new Set<string>();
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      const key = request.rawHeaders[i]!.toLowerCase();
      if (!["host", "origin", "authorization", "cookie"].includes(key)) continue;
      if (unique.has(key)) return undefined;
      unique.add(key);
    }
    if (upgrade) return request.method === "GET" && rawPath === "/ws/peer/runtime" && !h.origin && !h.cookie ? "machine" : undefined;
    if (request.method === "POST" && machinePaths.has(rawPath)) return !h.origin && !h.cookie ? "machine" : undefined;
    if (h.authorization !== undefined) return undefined;
    if (["GET", "HEAD"].includes(request.method ?? "") && publicFiles.test(rawPath)) return "public";
    if (h["sec-fetch-site"] === "cross-site") return undefined;
    if (request.method === "GET" && rawPath === "/api/auth/status") return "public";
    if (request.method === "POST" && ["/api/peer/browser-entry/preview", "/api/peer/browser-entry/claim"].includes(rawPath)) {
      return h.origin === this.configuration.origin ? "browser-entry" : undefined;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "") && h.origin !== this.configuration.origin) return undefined;
    if ((rawPath === "/api/auth/session" && ["GET", "DELETE"].includes(request.method ?? "")) || browserFamilies.test(rawPath)) return "browser";
    return undefined;
  }

  public async listen(target: HttpServer): Promise<void> {
    if (!this.configuration.enabled) return;
    if (this.attached || !target.listening || this.stopping) throw new Error("Peer HTTPS requires one running local Hub");
    this.attached = true;
    const listener = https.createServer({ ...this.material.tls!, minVersion: "TLSv1.2", maxHeaderSize: 16 * 1024 }, (request, response) => {
      const kind = this.classify(request, false);
      if (!kind || this.stopping) {
        response.writeHead(403, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
        response.end('{"code":"SCOPE_DENIED"}'); return;
      }
      this.requests.set(request, kind);
      if (!target.emit("request", request, response)) { response.writeHead(503); response.end(); }
    });
    this.listener = listener;
    listener.headersTimeout = 10_000; listener.requestTimeout = 30_000; listener.keepAliveTimeout = 5_000;
    listener.maxHeadersCount = 64; listener.maxConnections = 256;
    listener.on("connection", socket => { this.sockets.add(socket); socket.once("close", () => this.sockets.delete(socket)); });
    listener.on("upgrade", (request, socket, head) => {
      const kind = this.classify(request, true);
      if (!kind || this.stopping) { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      this.requests.set(request, kind);
      if (!target.emit("upgrade", request, socket, head)) socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      const stopped = () => reject(new Error("Peer HTTPS startup stopped"));
      const failed = (error: Error) => { listener.removeListener("close", stopped); reject(error); };
      listener.once("error", failed); listener.once("close", stopped);
      listener.listen({ port: Number(new URL(this.configuration.origin).port || "443"), host: this.configuration.listenHost, signal: this.abort.signal }, () => {
        listener.removeListener("error", failed); listener.removeListener("close", stopped); resolve();
      });
    }).catch(async error => { await this.close(); throw error; });
  }

  public close(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = new Promise<void>(resolve => {
      this.abort.abort();
      for (const socket of this.sockets) socket.destroy();
      if (!this.listener) { resolve(); return; }
      this.listener.close(() => resolve());
    });
    return this.stopping;
  }
}
