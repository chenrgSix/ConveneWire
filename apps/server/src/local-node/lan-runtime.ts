import { createHash, createPublicKey, sign, type KeyObject } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import type { PeerLANEndpoint, PeerLANSignedTransport, PeerLANTransport, PeerNodeIdentity } from "@convene-wire/contracts/peer";
import { canonicalPeerJson, parsePeerJson } from "@convene-wire/contracts/peer-json";
import { validatePeer } from "@convene-wire/contracts/peer-validation";
import { lanCertificates } from "./lan-certificates.js";
import { PeerIngress, type PeerIngressAccess } from "./peer-ingress.js";
import { exactObject, privateDirectory, privateRead, privateWrite } from "./relay-private.js";
import { assertNoPendingNetworkChange } from "./lan-settings.js";
import { withNetworkSettingsLock } from "./network-settings-lock.js";

export function privateLANAddress(value: string): boolean {
  if (!isIPv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31);
}
export function lanAddresses(): string[] {
  return [...new Set(Object.values(networkInterfaces()).flatMap(items => items ?? [])
    .filter(item => !item.internal && privateLANAddress(item.address)).map(item => item.address))].sort().slice(0, 8);
}

/** One optional transport for the same authority; business state stays in Hub. */
export class LANRuntime implements PeerIngressAccess {
  public readonly configuration;
  private readonly directory: string;
  private readonly host: PeerNodeIdentity;
  private current: PeerIngress | undefined;
  private target: Server | undefined;
  private material: Awaited<ReturnType<typeof lanCertificates>> | undefined;
  private enabled = false;
  private port = 0;
  private stopped = false;
  private pending: Promise<unknown> = Promise.resolve();
  private renewal: ReturnType<typeof setInterval> | undefined;
  private error: string | null = null;

  public constructor(private readonly root: string, nodeId: string, private readonly key: KeyObject, private readonly primary?: PeerIngress,
    private readonly addresses: () => string[] = lanAddresses, fallbackOrigin?: string) {
    const publicKey = createPublicKey(key).export({format: "der", type: "spki"}).subarray(-32).toString("base64url");
    this.host = {nodeId, publicKey};
    const hostname = `n${createHash("sha256").update(Buffer.from(publicKey, "base64url")).digest("hex").slice(0, 40)}.convenewire.invalid`;
    this.configuration = Object.freeze({schemaVersion: 1 as const, enabled: true,
      origin: primary?.configuration.origin ?? fallbackOrigin ?? `https://${hostname}`, listenHost: "0.0.0.0", certificateFile: "lan.pem", privateKeyFile: "lan-key.pem"});
    this.directory = path.join(root, "managed-lan");
  }
  public async initialize(): Promise<void> {
    await privateDirectory(this.directory, true);
    const raw = await privateRead(this.directory, "settings.json", 4096);
    if (raw) {
      const value = exactObject(parsePeerJson(raw), ["origin", "enabled", "port"]);
      if (value.origin !== this.configuration.origin || typeof value.enabled !== "boolean" || !Number.isSafeInteger(value.port) ||
          (value.port !== 0 && (Number(value.port) < 1024 || Number(value.port) > 65535))) throw new Error("局域网设置与节点身份不匹配。");
      this.enabled = value.enabled; this.port = value.port as number;
    }
    this.material = await lanCertificates(this.directory, this.configuration.origin, Date.now(), !raw);
  }
  public async attach(target: Server): Promise<void> {
    if (this.target || this.stopped || !this.material) throw new Error("LAN runtime is unavailable");
    this.target = target;
    if (this.enabled) await this.start().catch(() => { this.error = "局域网暂时无法启动，请关闭占用端口的程序后重试。本地工作不受影响。"; });
    this.renewal = setInterval(() => { void this.serial(async () => {
      const next = await lanCertificates(this.directory, this.configuration.origin);
      if (next.cert !== this.material?.cert) {
        this.material = next;
        await this.current?.close(); this.current = undefined;
        if (this.enabled) await this.start();
      }
    }).catch(() => { this.error = "局域网安全连接暂时不可用，请关闭后重新开启。"; }); }, 12 * 3600_000);
    this.renewal.unref();
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => { if (this.stopped) throw new Error("LAN runtime stopped"); return action(); });
    this.pending = result.catch(() => {}); return result;
  }
  private async save(): Promise<void> {
    await privateWrite(this.directory, "settings.json", Buffer.from(JSON.stringify({origin: this.configuration.origin, enabled: this.enabled, port: this.port})));
  }
  private async start(authorize: () => void = () => {}): Promise<void> {
    if (!this.material || !this.target) throw new Error("LAN runtime is unavailable");
    const ingress = new PeerIngress({configuration: this.configuration, tls: {cert: Buffer.from(this.material.cert), key: Buffer.from(this.material.key)}});
    await ingress.listen(this.target, {port: this.port, host: "0.0.0.0", allowAddress: address => privateLANAddress(address.replace(/^::ffff:/u, "")) || address === "127.0.0.1"});
    this.current = ingress; this.port = ingress.port()!; this.error = null;
    try { authorize(); await this.save(); } catch (error) { await ingress.close(); this.current = undefined; throw error; }
  }
  public setEnabled(enabled: boolean, authorize: () => void) {
    return this.serial(() => withNetworkSettingsLock(this.root, async () => {
      authorize();
      if (enabled && !this.current) {
        await assertNoPendingNetworkChange(this.root);
        if (!this.addresses().length) throw new Error("未找到局域网地址，请先连接 Wi-Fi 或有线网络。");
        authorize();
        this.enabled = true;
        try { await this.start(authorize); } catch (error) { this.enabled = false; throw error; }
      } else if (!enabled) {
        this.enabled = false; this.error = null;
        try { await this.save(); } finally { await this.current?.close(); this.current = undefined; }
      }
      return this.status();
    }));
  }
  public status() {
    const endpoints: PeerLANEndpoint[] = this.current ? this.addresses().filter(privateLANAddress).slice(0, 8).map(address => ({address, port: this.port})) : [];
    return {enabled: this.enabled, ready: !!this.current && endpoints.length > 0, endpoints, error: this.error};
  }
  public transport(): PeerLANSignedTransport {
    const status = this.status();
    if (!status.ready || !this.material) throw new Error("请先开启局域网连接。");
    const [first, ...rest] = status.endpoints;
    if (!first) throw new Error("未找到局域网地址。");
    const transport: PeerLANTransport = {schemaVersion: 1, host: this.host, hostOrigin: this.configuration.origin,
      caCertificatePem: this.material.ca, endpoints: [first, ...rest], expiresAt: new Date(Date.now() + 3600_000).toISOString()};
    if (!validatePeer("PeerLANTransport", transport)) throw new Error("Invalid LAN transport");
    return {transport, signature: sign(null, canonicalPeerJson({domain: "convenewire.peer.lan.v1", transport}), this.key).toString("base64url")};
  }
  public kind(request: IncomingMessage) { return this.current?.kind(request) ?? this.primary?.kind(request); }
  public invitationReady() { return this.status().ready || !!this.primary?.invitationReady(); }
  public async close(): Promise<void> {
    this.stopped = true; clearInterval(this.renewal); await this.pending;
    await this.current?.close(); this.current = undefined; await this.primary?.close();
  }
}
