import { lstat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { privateRead } from "./relay-private.js";

const queues = new Map<string, Promise<unknown>>();

/** The native installation lease owns the root across processes. This queue
 * also serializes both settings services and startup within that lease. */
export function withNetworkSettingsLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(root), result = (queues.get(key) ?? Promise.resolve()).then(work);
  const settled = result.then(() => {}, () => {});
  queues.set(key, settled);
  void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}

export async function networkSettingsRevision(root: string, mode: "relay" | "peer-ingress"): Promise<string> {
  const directory = path.join(root, mode);
  let current: Buffer | null = null;
  try { await lstat(directory); current = await privateRead(directory, "config.json"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const next = await privateRead(root, `${mode}.pending.json`);
  const digest = (value: Buffer | null) => value ? createHash("sha256").update(value).digest("hex") : null;
  return peerDigest({current: digest(current), pending: digest(next)});
}
