import { createPrivateKey, randomBytes, webcrypto, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { BasicConstraintsExtension, ExtendedKeyUsageExtension, KeyUsageFlags, KeyUsagesExtension,
  SubjectAlternativeNameExtension, X509CertificateGenerator } from "@peculiar/x509";
import { exactObject, privateRead, privateWrite } from "./relay-private.js";
import { parsePeerJson } from "@convene-wire/contracts/peer-json";

interface CertificateState { origin: string; ca: string; caKey: string; cert: string; key: string }
const algorithm = {name: "ECDSA", namedCurve: "P-256"};
const signingAlgorithm = {name: "ECDSA", hash: "SHA-256"};
const day = 86400_000;
const invalid = () => new Error("局域网身份文件不可用，请保留原始数据目录。");
const pem = (value: ArrayBuffer) => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(value).toString("base64").match(/.{1,64}/gu)!.join("\n")}\n-----END PRIVATE KEY-----\n`;

/** Local issuance only. The installation root is protected by the supervisor;
 * no external CA, process, system trust store or browser trust is involved. */
export async function lanCertificates(directory: string, origin: string, now = Date.now(), allowUnpublishedOriginChange = false): Promise<CertificateState> {
  const raw = await privateRead(directory, "certificates.json", 32 * 1024);
  let state: CertificateState;
  if (raw) {
    const input = exactObject(parsePeerJson(raw), ["origin", "ca", "caKey", "cert", "key"]);
    if (Object.values(input).some(value => typeof value !== "string") || (input.origin !== origin && !allowUnpublishedOriginChange)) throw invalid();
    state = input as unknown as CertificateState;
    const ca = new X509Certificate(state.ca), leaf = new X509Certificate(state.cert);
    if (!ca.ca || !ca.checkPrivateKey(createPrivateKey(state.caKey)) || !ca.verify(ca.publicKey) ||
        Date.parse(ca.validFrom) > now || Date.parse(ca.validTo) < now + 100 * day || leaf.ca ||
        !leaf.verify(ca.publicKey) || !leaf.checkPrivateKey(createPrivateKey(state.key))) throw invalid();
    const host = new URL(state.origin).hostname.replace(/^\[|\]$/gu, "");
    if (!(isIP(host) ? leaf.checkIP(host) : leaf.checkHost(host, {subject: "never"}))) throw invalid();
    if (state.origin === origin && Date.parse(leaf.validFrom) <= now && Date.parse(leaf.validTo) > now + 30 * day) return state;
  } else {
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
    const ca = await X509CertificateGenerator.createSelfSigned({name: "CN=ConveneWire LAN", keys,
      serialNumber: randomBytes(16).toString("hex"), signingAlgorithm, notBefore: new Date(now - 5 * 60_000), notAfter: new Date(now + 3650 * day),
      extensions: [new BasicConstraintsExtension(true, 0, true), new KeyUsagesExtension(KeyUsageFlags.keyCertSign, true)]}, webcrypto as unknown as Crypto);
    state = {origin, ca: ca.toString("pem"), caKey: pem(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey)), cert: "", key: ""};
  }
  state.origin = origin;
  const caKey = createPrivateKey(state.caKey).export({format: "der", type: "pkcs8"});
  const signingKey = await webcrypto.subtle.importKey("pkcs8", caKey, algorithm, false, ["sign"]);
  const keys = await webcrypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const host = new URL(origin).hostname.replace(/^\[|\]$/gu, "");
  const cert = await X509CertificateGenerator.create({subject: "CN=ConveneWire LAN Node", issuer: "CN=ConveneWire LAN", publicKey: keys.publicKey,
    signingKey, signingAlgorithm, serialNumber: randomBytes(16).toString("hex"), notBefore: new Date(now - 5 * 60_000), notAfter: new Date(now + 90 * day),
    extensions: [new BasicConstraintsExtension(false, undefined, true), new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
      new ExtendedKeyUsageExtension(["1.3.6.1.5.5.7.3.1"]), new SubjectAlternativeNameExtension([{type: isIP(host) ? "ip" : "dns", value: host}])]}, webcrypto as unknown as Crypto);
  state.cert = cert.toString("pem"); state.key = pem(await webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
  await privateWrite(directory, "certificates.json", Buffer.from(JSON.stringify(state)));
  return state;
}
