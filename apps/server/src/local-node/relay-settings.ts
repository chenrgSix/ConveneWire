import { constants, type Stats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { parsePeerJson } from "@convene-wire/contracts/peer-json";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { decodePeer, validatePeer } from "@convene-wire/contracts/peer-validation";
import { relayHostname } from "@convene-wire/contracts/relay-proof";
import type { RelayServiceProfile } from "@convene-wire/contracts/peer";
import { parsePeerIngressConfiguration } from "./peer-ingress-configuration.js";
import { preparePendingPeerIngress } from "./peer-ingress-settings.js";
import { exactObject, privateDirectory, privateRead, privateWrite, relayInvalid, syncPrivateDirectory } from "./relay-private.js";
import { networkSettingsRevision, withNetworkSettingsLock } from "./network-settings-lock.js";

export interface RelaySaved {
  schemaVersion: 1; profile: RelayServiceProfile; origin: string; enabled: boolean; termsAccepted: true;
}
interface Pending { schemaVersion: 1; baseDigest: string; saved: RelaySaved }
export interface RelayRunning {
  state: "disabled" | "connecting" | "issuing_certificate" | "ready" | "retrying" | "unavailable";
  origin: string | null; errorCode: string | null; certificateExpiresAt: string | null;
}
export const disabledRelay = (): RelayRunning => ({state: "disabled", origin: null, errorCode: null, certificateExpiresAt: null});
export function parseRelayProfile(input: unknown): RelayServiceProfile {
  if (!validatePeer("RelayServiceProfile", input)) throw relayInvalid();
  return input as RelayServiceProfile;
}
export function relayOrigin(profile: RelayServiceProfile, publicKey: string): string {
  const port = new URL(profile.relayOrigin).port;
  return `https://${relayHostname(publicKey, profile.nodeDomain)}${port ? `:${port}` : ""}`;
}
function saved(input: unknown, publicKey: string): RelaySaved {
  const value = exactObject(input, ["schemaVersion", "profile", "origin", "enabled", "termsAccepted"]);
  const profile = parseRelayProfile(value.profile);
  if (value.schemaVersion !== 1 || typeof value.enabled !== "boolean" || value.termsAccepted !== true || value.origin !== relayOrigin(profile, publicKey)) throw relayInvalid();
  return {schemaVersion: 1, profile, origin: value.origin as string, enabled: value.enabled, termsAccepted: true};
}
async function ensureRelayRoot(root: string): Promise<string> {
  await privateDirectory(root); const directory = path.join(root, "relay"); await privateDirectory(directory, true); return directory;
}
export async function loadRelayProfile(root: string, bundleProfile?: string): Promise<RelayServiceProfile | null> {
  const override = await privateRead(root, "relay-service.json", 16 * 1024);
  if (override) return parseRelayProfile(decodePeer("RelayServiceProfile", override));
  if (!bundleProfile) return null;
  let before: Stats;
  try { before = await lstat(bundleProfile); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const maximum = 16 * 1024;
  if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > maximum) throw relayInvalid();
  const sameFile = (left: Stats, right: Stats) => right.isFile() && right.nlink === 1 &&
    left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
  const file = await open(bundleProfile, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat();
    if (!sameFile(before, opened)) throw relayInvalid();
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maximum || length !== opened.size || !sameFile(opened, await file.stat()) || !sameFile(opened, await lstat(bundleProfile))) throw relayInvalid();
    return parseRelayProfile(decodePeer("RelayServiceProfile", buffer.subarray(0, length)));
  } finally { await file.close(); }
}
export async function loadRelaySaved(root: string, publicKey: string): Promise<RelaySaved | null> {
  const directory = await ensureRelayRoot(root), bytes = await privateRead(directory, "config.json");
  return bytes ? saved(parsePeerJson(bytes), publicKey) : null;
}
async function pending(root: string, publicKey: string): Promise<Pending | null> {
  const bytes = await privateRead(root, "relay.pending.json");
  if (!bytes) return null;
  const value = exactObject(parsePeerJson(bytes), ["schemaVersion", "baseDigest", "saved"]);
  if (value.schemaVersion !== 1 || typeof value.baseDigest !== "string" || !/^[a-f0-9]{64}$/u.test(value.baseDigest)) throw relayInvalid();
  return {schemaVersion: 1, baseDigest: value.baseDigest, saved: saved(value.saved, publicKey)};
}
async function assertNoDirectBinding(root: string, next: RelaySaved): Promise<void> {
  const directory = path.join(root, "peer-ingress");
  let exists = true;
  try { await lstat(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false; else throw error; }
  const bytes = exists ? await privateRead(directory, "config.json", 4096) : null;
  if (bytes) {
    const direct = parsePeerIngressConfiguration(parsePeerJson(bytes));
    if (direct.origin !== next.origin || (next.enabled && direct.enabled)) throw new Error("已有 HTTPS 地址已绑定到此 Node。请先处理原有邀请和成员关系，再按停机流程切换接入方式。");
  }
  const staged = await privateRead(root, "peer-ingress.pending.json");
  if (staged) {
    try {
      const value = exactObject(parsePeerJson(staged), ["schemaVersion", "baseDigest", "configuration", "certificatePem", "privateKeyPem"]);
      const direct = parsePeerIngressConfiguration(value.configuration);
      if (direct.origin === next.origin && !(next.enabled && direct.enabled)) return;
    } catch { /* A malformed pending decision must never permit another mode. */ }
    throw new Error("已有冲突的待生效手动 HTTPS 配置，请先取消该配置。");
  }
}
async function preparePendingRelay(root: string, publicKey: string): Promise<() => Promise<RelaySaved | null>> {
  const current = await loadRelaySaved(root, publicKey), next = await pending(root, publicKey);
  if (!next) {
    if (current) await assertNoDirectBinding(root, current);
    return async () => current;
  }
  await assertNoDirectBinding(root, next.saved);
  const alreadyApplied = peerDigest(current) === peerDigest(next.saved);
  if (!alreadyApplied && (next.baseDigest !== peerDigest(current) || (current && current.origin !== next.saved.origin))) throw relayInvalid();
  return async () => {
    if (!alreadyApplied) await privateWrite(await ensureRelayRoot(root), "config.json", Buffer.from(JSON.stringify(next.saved)));
    await unlink(path.join(root, "relay.pending.json")); await syncPrivateDirectory(root);
    return next.saved;
  };
}
export function applyPendingRelay(root: string, publicKey: string): Promise<RelaySaved | null> {
  return withNetworkSettingsLock(root, async () => { const commit = await preparePendingRelay(root, publicKey); return commit(); });
}

/** Native startup, before loading ingress or starting listeners. Validate both
 * decisions before either config pointer changes; each existing pointer remains
 * its own recoverable commit point if filesystem I/O is interrupted. */
export function applyPendingNetworkSettings(root: string, publicKey: string, now = new Date()): Promise<RelaySaved | null> {
  return withNetworkSettingsLock(root, async () => {
    const direct = await preparePendingPeerIngress(root, now), relay = await preparePendingRelay(root, publicKey);
    await direct();
    return relay();
  });
}

/** Fixed local Owner service; no caller chooses a root, profile, key or endpoint. */
export class RelaySettings {
  public constructor(private readonly root: string, private readonly publicKey: string,
    private readonly profile: RelayServiceProfile | null, private readonly running: () => RelayRunning = disabledRelay) {
    if (!path.isAbsolute(root)) throw relayInvalid();
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    return withNetworkSettingsLock(this.root, work);
  }
  private async state() {
    const current = await loadRelaySaved(this.root, this.publicKey), next = await pending(this.root, this.publicKey);
    const pinned = current?.profile ?? next?.saved.profile;
    const sameService = pinned && this.profile && ["id", "relayOrigin", "nodeDomain", "acmeDirectoryUrl"]
      .every(key => pinned[key as keyof RelayServiceProfile] === this.profile![key as keyof RelayServiceProfile]);
    const provider = sameService ? this.profile : pinned ?? this.profile;
    const directRevision = await networkSettingsRevision(this.root, "peer-ingress");
    return {current, next, provider, revisionDigest: peerDigest({current, next, provider, directRevision})};
  }
  public status() { return this.serialize(async () => {
    const state = await this.state();
    return {revisionDigest: state.revisionDigest, provider: state.provider,
      termsAcceptanceRequired: Boolean(state.current?.enabled && state.current.profile.termsUrl !== state.provider?.termsUrl),
      saved: {enabled: state.current?.enabled ?? false, origin: state.current?.origin ?? null}, running: this.running(),
      pending: state.next ? {enabled: state.next.saved.enabled, origin: state.next.saved.origin, reviewDigest: peerDigest(state.next)} : null};
  }); }
  private selection(input: unknown, state: Awaited<ReturnType<RelaySettings["state"]>>, saving: boolean): Pending {
    const keys = ["revisionDigest", "enabled", "termsAccepted", ...(saving ? ["reviewDigest"] : [])];
    const value = exactObject(input, keys);
    if (typeof value.enabled !== "boolean" || typeof value.termsAccepted !== "boolean" || (value.enabled && !value.termsAccepted) || !state.provider) throw relayInvalid();
    const configuration: RelaySaved = {schemaVersion: 1, profile: state.provider,
      origin: relayOrigin(state.provider, this.publicKey), enabled: value.enabled, termsAccepted: true};
    return {schemaVersion: 1, baseDigest: peerDigest(state.current), saved: configuration};
  }
  public review(input: unknown, authorize: () => void = () => {}) { return this.serialize(async () => {
    authorize(); const state = await this.state(), next = this.selection(input, state, false);
    if ((input as {revisionDigest: string}).revisionDigest !== state.revisionDigest) throw relayInvalid();
    await assertNoDirectBinding(this.root, next.saved);
    authorize(); return {revisionDigest: state.revisionDigest, reviewDigest: peerDigest(next), enabled: next.saved.enabled,
      origin: next.saved.origin, provider: next.saved.profile};
  }); }
  public save(input: unknown, authorize: () => void = () => {}) { return this.serialize(async () => {
    authorize(); const state = await this.state(), next = this.selection(input, state, true), digest = peerDigest(next);
    const value = input as {revisionDigest: string; reviewDigest: string};
    if (value.reviewDigest !== digest || (value.revisionDigest !== state.revisionDigest && (!state.next || peerDigest(state.next) !== digest))) throw relayInvalid();
    await assertNoDirectBinding(this.root, next.saved);
    authorize(); if (!state.next || peerDigest(state.next) !== digest) await privateWrite(this.root, "relay.pending.json", Buffer.from(JSON.stringify(next)));
    return {status: "pending" as const, reviewDigest: digest};
  }); }
  public discard(input: unknown, authorize: () => void = () => {}) { return this.serialize(async () => {
    authorize(); const value = exactObject(input, ["revisionDigest"]), state = await this.state();
    if (value.revisionDigest !== state.revisionDigest) throw relayInvalid();
    authorize(); if (state.next) { await unlink(path.join(this.root, "relay.pending.json")); await syncPrivateDirectory(this.root); }
    return {status: "discarded" as const};
  }); }
}
