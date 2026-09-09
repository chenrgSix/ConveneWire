import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { AuthoritySpaceDirectory } from "@convene-wire/contracts/authority";
import schema from "@convene-wire/contracts/authority-schema" with { type: "json" };
import { Ajv2020 } from "ajv/dist/2020.js";

const validate = new Ajv2020({ strict: true }).addSchema(schema).getSchema(`${schema.$id}#/$defs/AuthoritySpaceDirectory`)!;
const empty = (): AuthoritySpaceDirectory => ({ schemaVersion: 1, spaces: [] });
function validOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === "https:" || (url.protocol === "http:" &&
      (url.hostname === "localhost" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/u.test(url.hostname) || url.hostname === "[::1]")));
  } catch { return false; }
}

/** Bounded owner-local references, never Host records or an execution grant. */
export async function readSpaceDirectory(file: string | undefined, nodeId: string, origin: string): Promise<AuthoritySpaceDirectory> {
  if (!file) return empty();
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16_384 || (process.platform !== "win32" &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error("Invalid Space directory");
    const buffer = Buffer.alloc(16_385);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 16_384) throw new Error("Invalid Space directory");
    const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    if (!validate(value)) throw new Error("Invalid Space directory");
    const directory = value as AuthoritySpaceDirectory;
    const nodes = new Set<string>(), origins = new Map<string, string>();
    for (const space of directory.spaces) {
      if (!validOrigin(space.browserOrigin) || nodes.has(space.authorityNodeId) ||
        (space.kind === "hosted" && (space.authorityNodeId !== nodeId || space.browserOrigin !== origin)) ||
        (space.kind === "remote" && (space.authorityNodeId === nodeId || space.browserOrigin === origin)) ||
        (origins.has(space.browserOrigin) && origins.get(space.browserOrigin) !== space.authorityNodeId)) throw new Error("Invalid Space directory");
      nodes.add(space.authorityNodeId); origins.set(space.browserOrigin, space.authorityNodeId);
    }
    return directory;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") return empty();
    // Never include paths or raw local state in Web errors.
    throw new Error("Local Space references are unavailable");
  } finally { await handle?.close(); }
}
