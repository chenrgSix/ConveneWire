import { Agent } from "node:https";
import { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import type { RelayChallenge, RelayOpen, RelayRegistered, RelayServiceProfile } from "@convene-wire/contracts/peer";
import { decodePeer, validatePeer } from "@convene-wire/contracts/peer-validation";
import { relayHostname, relayRegistrationTranscript } from "@convene-wire/contracts/relay-proof";

export interface RelaySigner { nodeId: string; publicKey: string; sign(transcript: Uint8Array): string }
export interface RelayConnectorOptions {
  profile: RelayServiceProfile; signer: RelaySigner;
  acceptTLS(stream: Duplex): void; acceptHTTP01(stream: Duplex): void;
  connectionChanged(connected: boolean): void;
  /** A scoped test CA/lookup agent; never populated from a profile or invitation. */
  agent?: Agent;
  retryMilliseconds?: number;
}

/** Each stream is a fresh byte pipe. Disconnect destroys it; no byte is queued
 * for a replacement connection and no business credential enters control frames. */
export class RelayConnector {
  private readonly abort = new AbortController();
  private readonly sockets = new Set<WebSocket>();
  private readonly streams = new Set<Duplex>();
  private readonly agent: Agent;
  private worker?: Promise<void>;
  private epoch = 0;
  private connected = false;
  public constructor(private readonly options: RelayConnectorOptions) {
    if (!validatePeer("RelayServiceProfile", options.profile)) throw new Error("Invalid Relay service profile");
    this.agent = options.agent ?? new Agent({keepAlive: false});
  }
  public start(): void { this.worker ??= this.run(); }
  public isConnected(): boolean { return this.connected && !this.abort.signal.aborted; }
  private mark(connected: boolean): void {
    this.connected = connected; this.options.connectionChanged(connected);
  }
  public async close(): Promise<void> {
    this.abort.abort(); this.epoch++;
    for (const stream of this.streams) stream.destroy();
    for (const socket of this.sockets) socket.terminate();
    await this.worker;
    if (!this.options.agent) this.agent.destroy();
  }
  private socket(route: string, headers?: Record<string, string>): WebSocket {
    const url = new URL(route, this.options.profile.relayOrigin); url.protocol = "wss:";
    const socket = new WebSocket(url, {agent: this.agent, rejectUnauthorized: true,
      followRedirects: false, perMessageDeflate: false, handshakeTimeout: 10_000, maxPayload: 64 * 1024,
      ...(headers ? {headers} : {})});
    this.sockets.add(socket); socket.on("error", () => {});
    socket.once("close", () => this.sockets.delete(socket));
    if (this.abort.signal.aborted) socket.terminate();
    return socket;
  }
  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.abort.signal.aborted) {
      try { await this.connect(); } catch { /* Only a fixed transport state reaches the UI. */ }
      this.mark(false);
      if (this.abort.signal.aborted) break;
      const wait = Math.min(30_000, (this.options.retryMilliseconds ?? 1000) * 2 ** Math.min(attempt++, 5));
      try { await delay(wait + (this.options.retryMilliseconds ? 0 : Math.floor(Math.random() * 500)), undefined, {signal: this.abort.signal}); }
      catch { break; }
    }
  }
  private connect(): Promise<void> {
    const epoch = ++this.epoch, control = this.socket("/v1/relay/control");
    let challenged = false, token: string | null = null, lastPong = Date.now();
    const seen = new Set<string>(), owned = new Set<WebSocket>(), ownedStreams = new Set<Duplex>();
    const deadline = setTimeout(() => { if (!token) control.terminate(); }, 15_000);
    const heartbeat = setInterval(() => {
      if (Date.now() - lastPong > 35_000) control.terminate();
      else if (control.readyState === WebSocket.OPEN) control.ping();
    }, 15_000);
    control.on("pong", () => { lastPong = Date.now(); });
    return new Promise<void>(resolve => {
      control.once("close", () => {
        clearTimeout(deadline); clearInterval(heartbeat);
        for (const stream of ownedStreams) stream.destroy();
        for (const socket of owned) socket.terminate();
        if (this.epoch === epoch) this.mark(false);
        resolve();
      });
      control.on("message", (bytes, binary) => {
        try {
          if (binary || !Buffer.isBuffer(bytes) || bytes.length > 4096 || this.abort.signal.aborted || epoch !== this.epoch) throw new Error("Invalid Relay frame");
          const message = decodePeer(!challenged ? "RelayChallenge" : !token ? "RelayRegistered" : "RelayOpen", bytes) as {type?: string};
          if (!challenged) {
            if (!validatePeer("RelayChallenge", message)) throw new Error("Invalid Relay challenge");
            const challenge = message as RelayChallenge, expires = Date.parse(challenge.expiresAt);
            if (challenge.relayOrigin !== this.options.profile.relayOrigin || challenge.nodeDomain !== this.options.profile.nodeDomain ||
                expires <= Date.now() || expires > Date.now() + 30_000) throw new Error("Invalid Relay recipient");
            challenged = true;
            const signer = this.options.signer;
            control.send(JSON.stringify({schemaVersion: 1, type: "register", nodeId: signer.nodeId, publicKey: signer.publicKey,
              signature: signer.sign(relayRegistrationTranscript(challenge.relayOrigin, challenge.nodeDomain, challenge.nonce, signer.nodeId, signer.publicKey))}));
          } else if (!token) {
            if (!validatePeer("RelayRegistered", message)) throw new Error("Invalid Relay registration");
            const registered = message as RelayRegistered;
            if (registered.hostname !== relayHostname(this.options.signer.publicKey, this.options.profile.nodeDomain)) throw new Error("Relay route changed");
            token = registered.sessionToken; clearTimeout(deadline); this.mark(true);
          } else {
            if (!validatePeer("RelayOpen", message)) throw new Error("Invalid Relay stream");
            const open = message as RelayOpen;
            if (seen.has(open.streamId) || seen.size >= 4096 || owned.size >= 64) throw new Error("Relay stream capacity exceeded");
            seen.add(open.streamId);
            void this.openStream(open, token, epoch, owned, ownedStreams).catch(() => {});
          }
        } catch { control.terminate(); }
      });
    });
  }
  private async openStream(open: RelayOpen, token: string, epoch: number, owned: Set<WebSocket>, ownedStreams: Set<Duplex>): Promise<void> {
    const socket = this.socket("/v1/relay/stream", {authorization: `Bearer ${token}`, "x-convenewire-relay-stream": open.streamId});
    owned.add(socket); socket.once("close", () => owned.delete(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = () => { cleanup(); reject(new Error("Relay stream closed")); };
        const opened = () => { cleanup(); resolve(); };
        const cleanup = () => { socket.off("error", failed); socket.off("close", failed); socket.off("open", opened); };
        socket.once("open", opened); socket.once("error", failed); socket.once("close", failed);
      });
      if (!this.isConnected() || epoch !== this.epoch) throw new Error("Relay epoch ended");
      // Validate each complete frame before any bytes reach the TLS/HTTP parser.
      // ws enforces maxPayload before its message event, including fragmented frames.
      const stream = new Duplex({highWaterMark: 64 * 1024,
        read() { socket.resume(); },
        write(chunk: Buffer, _encoding, done) {
          let offset = 0;
          const send = (error?: Error) => {
            if (error) { done(error); return; }
            if (offset >= chunk.length) { done(); return; }
            const bytes = chunk.subarray(offset, offset + 32 * 1024); offset += bytes.length;
            socket.send(bytes, {binary: true}, send);
          };
          send();
        },
        final(done) { socket.close(); done(); },
        destroy(error, done) { socket.terminate(); done(error); }
      });
      this.streams.add(stream); ownedStreams.add(stream);
      stream.on("error", () => {});
      stream.once("close", () => { this.streams.delete(stream); ownedStreams.delete(stream); });
      stream.once("end", () => stream.destroy());
      socket.on("message", (data, binary) => {
        if (stream.destroyed) return;
        if (!binary || !Buffer.isBuffer(data) || data.length > 64 * 1024) { stream.destroy(); return; }
        if (!stream.push(data)) socket.pause();
      });
      socket.once("error", () => stream.destroy());
      socket.once("close", () => { stream.push(null); });
      if (open.kind === "tls") this.options.acceptTLS(stream); else this.options.acceptHTTP01(stream);
    } catch { socket.terminate(); }
  }
}
