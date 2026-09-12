import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { readPeerPrivateFile } from "./peer-ingress-configuration.js";

export const relayInvalid = () => new Error("便捷接入配置无效或已变化，请刷新后重新审阅。");
export async function privateDirectory(directory: string, create = false): Promise<void> {
  if (create) await mkdir(directory, {mode: 0o700}).catch(error => { if (error.code !== "EEXIST") throw error; });
  const value = await lstat(directory);
  if (!value.isDirectory() || value.isSymbolicLink() || (process.platform !== "win32" &&
      ((value.mode & 0o077) !== 0 || value.uid !== process.getuid?.()))) throw relayInvalid();
}
export async function privateRead(directory: string, name: string, maximum = 128 * 1024): Promise<Buffer | null> {
  if (!/^[a-z0-9][a-z0-9.-]*$/u.test(name)) throw relayInvalid();
  await privateDirectory(directory);
  try { await lstat(path.join(directory, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  return readPeerPrivateFile(directory, name, maximum);
}
export async function privateWrite(directory: string, name: string, bytes: Buffer): Promise<void> {
  await privateRead(directory, name);
  const temporary = path.join(directory, `.relay-${randomBytes(16).toString("hex")}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path.join(directory, name)); await syncPrivateDirectory(directory);
  } finally { await unlink(temporary).catch(() => {}); }
}
export async function syncPrivateDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const file = await open(directory, "r"); try { await file.sync(); } finally { await file.close(); }
}
export function exactObject(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join() !== [...keys].sort().join()) throw relayInvalid();
  return input as Record<string, unknown>;
}
