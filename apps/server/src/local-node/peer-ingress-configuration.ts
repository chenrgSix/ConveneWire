import { constants } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import type { PeerIngressConfiguration } from "@convene-wire/contracts/peer";
import { decodePeer, validatePeer } from "@convene-wire/contracts/peer-validation";
import { assertPeerOrigin } from "../security/peer-proof-verifier.js";

const invalid = () => new Error("Peer HTTPS configuration or certificate is invalid");
const filename = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.pem$/u;

export interface PeerIngressMaterial {
  configuration: PeerIngressConfiguration;
  tls?: { cert: Buffer; key: Buffer };
}

export function parsePeerIngressConfiguration(input: unknown): PeerIngressConfiguration {
  if (!validatePeer("PeerIngressConfiguration", input)) throw invalid();
  const value = input as PeerIngressConfiguration;
  try { assertPeerOrigin(value.origin); } catch { throw invalid(); }
  if (!value.origin.startsWith("https://") || !isIP(value.listenHost) ||
      !filename.test(value.certificateFile) || !filename.test(value.privateKeyFile) ||
      value.certificateFile === value.privateKeyFile) throw invalid();
  return { ...value };
}

async function privateFile(directory: string, name: string, maximum: number): Promise<Buffer> {
  let file: FileHandle | undefined;
  try {
    const target = path.join(directory, name), before = await lstat(target);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum || before.size === 0 ||
        (process.platform !== "win32" && ((before.mode & 0o077) !== 0 || before.uid !== process.getuid?.()))) throw invalid();
    file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const actual = await file.stat();
    if (actual.dev !== before.dev || actual.ino !== before.ino || actual.size !== before.size) throw invalid();
    const bytes = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length-size, null);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size !== before.size || size > maximum) throw invalid();
    return bytes.subarray(0, size);
  } catch { throw invalid(); }
  finally { await file?.close(); }
}

export function validatePeerIngressCertificate(configuration: PeerIngressConfiguration, cert: Buffer, key: Buffer, now = new Date()): void {
  try {
    const certificate = new X509Certificate(cert), origin = new URL(configuration.origin);
    const host = origin.hostname.replace(/^\[|\]$/gu, "");
    const matches = isIP(host) ? certificate.checkIP(host) : certificate.checkHost(host, { subject: "never" });
    if (!matches || !certificate.checkPrivateKey(createPrivateKey(key)) || certificate.ca ||
        Date.parse(certificate.validFrom) > now.getTime() || Date.parse(certificate.validTo) <= now.getTime()) throw invalid();
  } catch { throw invalid(); }
}

/** The native supervisor retains the private Node root lease throughout this read. */
export async function loadPeerIngressMaterial(root: string, now = new Date()): Promise<PeerIngressMaterial | undefined> {
  if (!path.isAbsolute(root)) throw invalid();
  const directory = path.join(root, "peer-ingress");
  let metadata;
  try { metadata = await lstat(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw invalid(); }
  if (!metadata.isDirectory() || (process.platform !== "win32" && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.()))) throw invalid();
  let configuration: PeerIngressConfiguration;
  try { configuration = parsePeerIngressConfiguration(decodePeer("PeerIngressConfiguration", await privateFile(directory, "config.json", 4096))); }
  catch { throw invalid(); }
  if (!configuration.enabled) return { configuration };
  const cert = await privateFile(directory, configuration.certificateFile, 64 * 1024);
  const key = await privateFile(directory, configuration.privateKeyFile, 16 * 1024);
  validatePeerIngressCertificate(configuration, cert, key, now);
  return { configuration, tls: { cert, key } };
}
