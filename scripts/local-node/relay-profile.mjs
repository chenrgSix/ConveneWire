import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePeer } from "@convene-wire/contracts/peer-validation";

export const relayProfileFilename = "relay-service.json";
const maximumProfileBytes = 16 * 1024;
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;

/** Read one explicitly selected public profile. Never follow a file link, read
 * unbounded data, or normalize the bytes whose digest enters the bundle. */
export async function readRelayProfile(filename) {
  if (typeof filename !== "string" || !filename.trim()) throw new Error("Select a Relay profile file explicitly");
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximumProfileBytes) {
    throw new Error("Relay profile must be a regular file of 1 to 16384 bytes, not a symlink");
  }
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || !sameFile(before, opened)) throw new Error("Relay profile changed while opening");
    const buffer = Buffer.alloc(maximumProfileBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > maximumProfileBytes || length !== opened.size || !sameFile(opened, await file.stat()) ||
      !sameFile(opened, await lstat(filename))) throw new Error("Relay profile changed or exceeds 16384 bytes");
    const bytes = buffer.subarray(0, length);
    let profile;
    try { profile = decodePeer("RelayServiceProfile", bytes); }
    catch { throw new Error("Invalid RelayServiceProfile: use only its public schema fields and HTTPS service URLs"); }
    return { profile, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  } finally { await file.close(); }
}

/** Library callers pass relayProfileFile directly. CLI environment import also
 * needs a flag, so an exported variable cannot silently alter a distribution. */
export function relayProfileOption(args, env = process.env) {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === "--relay-profile" && typeof args[1] === "string" && args[1].trim() && !args[1].startsWith("--")) {
    return path.resolve(args[1]);
  }
  if (args.length === 1 && args[0] === "--relay-profile-env" && typeof env.CONVENE_WIRE_RELAY_PROFILE_FILE === "string" &&
    env.CONVENE_WIRE_RELAY_PROFILE_FILE.trim()) return path.resolve(env.CONVENE_WIRE_RELAY_PROFILE_FILE);
  throw new Error("Select --relay-profile FILE or --relay-profile-env with CONVENE_WIRE_RELAY_PROFILE_FILE; do not combine them");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [filename, ...extra] = process.argv.slice(2);
  if (!filename || extra.length) throw new Error("Usage: relay-profile.mjs PROFILE_FILE");
  const result = await readRelayProfile(filename);
  console.log(JSON.stringify({ id: result.profile.id, relayOrigin: result.profile.relayOrigin, nodeDomain: result.profile.nodeDomain,
    bytes: result.bytes.length, sha256: result.sha256 }));
}
