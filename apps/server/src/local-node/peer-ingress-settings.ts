import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { parsePeerJson } from "@convene-wire/contracts/peer-json";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { loadPeerIngressMaterial, parsePeerIngressConfiguration, readPeerPrivateFile, validatePeerIngressCertificate, type PeerIngressMaterial } from "./peer-ingress-configuration.js";
import { networkSettingsRevision, withNetworkSettingsLock } from "./network-settings-lock.js";

const pendingFile = "peer-ingress.pending.json";
const invalid = () => new Error("本机网络配置无效或已变化，请刷新后重新审阅。");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
type Configuration = PeerIngressMaterial["configuration"];
interface Candidate { schemaVersion: 1; baseDigest: string; configuration: Configuration; certificatePem: string; privateKeyPem: string }
interface Snapshot { configuration: Configuration | null; cert: Buffer; key: Buffer; digest: string }
interface Selection { enabled: boolean; origin: string; listenHost: string; certificatePem: string; privateKeyPem: string }
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join() !== keys.sort().join()) throw invalid();
  return input as Record<string, unknown>;
}
async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw invalid(); }
}
async function directory(target: string): Promise<void> {
  const value = await lstat(target);
  if (!value.isDirectory() || (process.platform !== "win32" && ((value.mode & 0o077) || value.uid !== process.getuid?.()))) throw invalid();
}
async function syncDirectory(target: string): Promise<void> {
  if (process.platform === "win32") return;
  const file = await open(target, "r"); try { await file.sync(); } finally { await file.close(); }
}
async function replacePrivate(directoryPath: string, name: string, bytes: Buffer): Promise<void> {
  await directory(directoryPath);
  const target = path.join(directoryPath, name);
  if (await exists(target)) await readPeerPrivateFile(directoryPath, name, 128 * 1024);
  const temporary = path.join(directoryPath, `.network-${randomBytes(16).toString("hex")}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target); await syncDirectory(directoryPath);
  } finally { await unlink(temporary).catch(() => {}); }
}
async function immutablePrivate(directoryPath: string, name: string, bytes: Buffer): Promise<void> {
  if (await exists(path.join(directoryPath, name))) {
    if (!(await readPeerPrivateFile(directoryPath, name, 128 * 1024)).equals(bytes)) throw invalid();
    return;
  }
  // A crash before rename leaves only an unreferenced temporary file. Never
  // overwrite certificate material referenced by the current configuration.
  await replacePrivate(directoryPath, name, bytes);
}
async function snapshot(root: string): Promise<Snapshot> {
  await directory(root);
  const target = path.join(root, "peer-ingress");
  let configuration: Configuration | null = null, cert: Buffer = Buffer.alloc(0), key: Buffer = Buffer.alloc(0);
  if (await exists(target)) {
    await directory(target);
    configuration = parsePeerIngressConfiguration(parsePeerJson(await readPeerPrivateFile(target, "config.json", 4096)));
    if (configuration.enabled) {
      cert = await readPeerPrivateFile(target, configuration.certificateFile, 64 * 1024);
      key = await readPeerPrivateFile(target, configuration.privateKeyFile, 16 * 1024);
    }
  }
  return {configuration, cert, key, digest: peerDigest({configuration, certificateDigest: hash(cert), privateKeyDigest: hash(key)})};
}
function selection(input: unknown, now?: Date): Selection {
  const v = object(input, ["enabled", "origin", "listenHost", "certificatePem", "privateKeyPem"]);
  if (typeof v.enabled !== "boolean" || [v.origin, v.listenHost, v.certificatePem, v.privateKeyPem].some(value => typeof value !== "string") ||
    Buffer.byteLength(v.certificatePem as string) > 64 * 1024 || Buffer.byteLength(v.privateKeyPem as string) > 16 * 1024) throw invalid();
  const value = v as unknown as Selection, configuration = configurationFor(value);
  if (value.enabled) {
    const certificate = new X509Certificate(value.certificatePem);
    validatePeerIngressCertificate(configuration, Buffer.from(value.certificatePem), Buffer.from(value.privateKeyPem), now ?? new Date(Date.parse(certificate.validFrom) + 1));
  }
  else if (value.certificatePem || value.privateKeyPem) throw invalid();
  return value;
}
function configurationFor(value: Selection): Configuration {
  const suffix = hash(`${value.certificatePem}\0${value.privateKeyPem}`);
  return parsePeerIngressConfiguration({schemaVersion: 1, enabled: value.enabled, origin: value.origin, listenHost: value.listenHost,
    certificateFile: `cert-${suffix}.pem`, privateKeyFile: `key-${suffix}.pem`});
}
function candidate(input: unknown, baseDigest: string, now?: Date): Candidate {
  if (!/^[a-f0-9]{64}$/u.test(baseDigest)) throw invalid();
  const value = selection(input, now);
  return {schemaVersion: 1, baseDigest, configuration: configurationFor(value), certificatePem: value.certificatePem, privateKeyPem: value.privateKeyPem};
}
async function pending(root: string): Promise<Candidate | null> {
  if (!await exists(path.join(root, pendingFile))) return null;
  const v = object(parsePeerJson(await readPeerPrivateFile(root, pendingFile, 128 * 1024)), ["schemaVersion", "baseDigest", "configuration", "certificatePem", "privateKeyPem"]);
  if (v.schemaVersion !== 1 || typeof v.baseDigest !== "string") throw invalid();
  const config = parsePeerIngressConfiguration(v.configuration);
  const result = candidate({enabled: config.enabled, origin: config.origin, listenHost: config.listenHost, certificatePem: v.certificatePem, privateKeyPem: v.privateKeyPem}, v.baseDigest);
  if (peerDigest(result) !== peerDigest(v)) throw invalid();
  return result;
}
function publicConfiguration(configuration: Configuration | null, cert: Buffer) {
  if (!configuration) return null;
  let certificateFingerprint: string | null = null, certificateExpiresAt: string | null = null;
  if (cert.length) try { const value = new X509Certificate(cert); certificateFingerprint = value.fingerprint256; certificateExpiresAt = new Date(value.validTo).toISOString(); } catch { /* Invalid current material remains replaceable by explicit review. */ }
  return {enabled: configuration.enabled, origin: configuration.origin, listenHost: configuration.listenHost, certificateFingerprint, certificateExpiresAt};
}

async function assertRelayBoundary(root: string, next: Configuration): Promise<void> {
  const relayRoot = path.join(root, "relay"), staged = path.join(root, "relay.pending.json");
  const assertCompatible = (input: unknown, message: string) => {
    const configuration = object(input, ["schemaVersion", "profile", "origin", "enabled", "termsAccepted"]);
    if (configuration.schemaVersion !== 1 || typeof configuration.enabled !== "boolean" || configuration.termsAccepted !== true) throw invalid();
    if (configuration.origin !== next.origin || (next.enabled && configuration.enabled)) throw new Error(message);
  };
  if (await exists(path.join(relayRoot, "config.json"))) {
    await directory(relayRoot);
    assertCompatible(parsePeerJson(await readPeerPrivateFile(relayRoot, "config.json", 128 * 1024)), "此 Node 已绑定便捷接入地址，请先按停机流程处理原有邀请和成员关系。");
  }
  if (await exists(staged)) {
    const value = object(parsePeerJson(await readPeerPrivateFile(root, "relay.pending.json", 128 * 1024)), ["schemaVersion", "baseDigest", "saved"]);
    assertCompatible(value.saved, "已有冲突的待生效便捷接入配置，请先取消该配置。");
  }
}

/** Only the live native Hub under its installation lease constructs this
 * service. Mutations serialize locally; no browser/Peer can supply a root. */
export class PeerIngressSettings {
  public constructor(private readonly root: string, private readonly running?: PeerIngressMaterial) {
    if (!path.isAbsolute(root)) throw invalid();
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    return withNetworkSettingsLock(this.root, work);
  }
  private async state() {
    const current = await snapshot(this.root), next = await pending(this.root);
    const relayRevision = await networkSettingsRevision(this.root, "relay");
    return {current, next, revisionDigest: peerDigest({current: current.digest, pending: next ? peerDigest(next) : null, relayRevision})};
  }
  public status() { return this.serialize(async () => {
    const state = await this.state();
    return {revisionDigest: state.revisionDigest, running: publicConfiguration(this.running?.configuration ?? null, this.running?.tls?.cert ?? Buffer.alloc(0)),
      saved: publicConfiguration(state.current.configuration, state.current.cert), pending: state.next ? {reviewDigest: peerDigest(state.next),
        ...publicConfiguration(state.next.configuration, Buffer.from(state.next.certificatePem))!} : null};
  }); }
  public review(input: unknown, now = new Date()) { return this.serialize(async () => {
    const v = object(input, ["revisionDigest", "selection"]), state = await this.state();
    if (v.revisionDigest !== state.revisionDigest) throw invalid();
    const next = candidate(v.selection, state.current.digest, now);
    this.assertOrigin(state.current.configuration, next.configuration);
    await assertRelayBoundary(this.root, next.configuration);
    return {revisionDigest: state.revisionDigest, reviewDigest: peerDigest(next), ...publicConfiguration(next.configuration, Buffer.from(next.certificatePem))!};
  }); }
  private assertOrigin(previous: Configuration | null, next: Configuration) {
    if ((previous && previous.origin !== next.origin) || (this.running && this.running.configuration.origin !== next.origin)) throw new Error("已有 HTTPS 地址不能在运行中更换；请先按停机流程处理原有邀请和成员关系。");
  }
  public save(input: unknown, now = new Date(), authorize: () => void = () => {}) { return this.serialize(async () => {
    authorize();
    const v = object(input, ["revisionDigest", "reviewDigest", "selection"]), state = await this.state();
    const next = candidate(v.selection, state.current.digest, now), digest = peerDigest(next);
    this.assertOrigin(state.current.configuration, next.configuration);
    await assertRelayBoundary(this.root, next.configuration);
    if (v.reviewDigest !== digest || (v.revisionDigest !== state.revisionDigest && (!state.next || peerDigest(state.next) !== digest))) throw invalid();
    authorize();
    if (!state.next || peerDigest(state.next) !== digest) await replacePrivate(this.root, pendingFile, Buffer.from(JSON.stringify(next)));
    return {status: "pending" as const, reviewDigest: digest};
  }); }
  public discard(input: unknown, authorize: () => void = () => {}) { return this.serialize(async () => {
    authorize();
    const v = object(input, ["revisionDigest"]), state = await this.state();
    if (v.revisionDigest !== state.revisionDigest) throw invalid();
    authorize();
    if (state.next) { await unlink(path.join(this.root, pendingFile)); await syncDirectory(this.root); }
    return {status: "discarded" as const};
  }); }
}

/** Called before starting either listener, under the native installation lease.
 * The config pointer is the sole commit point. Failure never enables a fallback
 * listener or deletes the old material; the stopped Owner can repair the root. */
export function applyPendingPeerIngress(root: string, now = new Date()): Promise<void> {
  return withNetworkSettingsLock(root, async () => { const commit = await preparePendingPeerIngress(root, now); await commit(); });
}

/** Prepare under the shared network lock. The combined native startup validates
 * both plans before invoking either commit closure. */
export async function preparePendingPeerIngress(root: string, now = new Date()): Promise<() => Promise<void>> {
  await directory(root);
  const next = await pending(root);
  if (!next) {
    const current = await loadPeerIngressMaterial(root, now);
    if (current) await assertRelayBoundary(root, current.configuration);
    return async () => {};
  }
  selection({enabled: next.configuration.enabled, origin: next.configuration.origin, listenHost: next.configuration.listenHost, certificatePem: next.certificatePem, privateKeyPem: next.privateKeyPem}, now);
  const current = await snapshot(root), config = next.configuration;
  const alreadyApplied = peerDigest(current.configuration) === peerDigest(config) && (!config.enabled ||
    (current.cert.equals(Buffer.from(next.certificatePem)) && current.key.equals(Buffer.from(next.privateKeyPem))));
  await assertRelayBoundary(root, config);
  if (!alreadyApplied && (current.digest !== next.baseDigest || (current.configuration && current.configuration.origin !== config.origin))) throw invalid();
  return async () => {
    if (!alreadyApplied) {
      const destination = path.join(root, "peer-ingress"), initial = current.configuration === null;
      const target = initial ? path.join(root, `.peer-ingress-${randomBytes(16).toString("hex")}.tmp`) : destination;
      if (initial) await mkdir(target, {mode: 0o700});
      try {
        await directory(target);
        if (config.enabled) {
          await immutablePrivate(target, config.certificateFile, Buffer.from(next.certificatePem));
          await immutablePrivate(target, config.privateKeyFile, Buffer.from(next.privateKeyPem));
        }
        await replacePrivate(target, "config.json", Buffer.from(JSON.stringify(config)));
        if (initial) await rename(target, destination);
      } finally { if (initial) await rm(target, {recursive: true, force: true}); }
      await syncDirectory(root);
    }
    await loadPeerIngressMaterial(root, now);
    await unlink(path.join(root, pendingFile)); await syncDirectory(root);
  };
}
