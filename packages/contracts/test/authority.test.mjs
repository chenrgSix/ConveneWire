import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { authorityProofTranscript } from "../src/authority-proof.mjs";

test("Authority foundation accepts explicit references and denies scope or Peer fallback", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/authority/foundation.schema.json", import.meta.url)));
  const cases = JSON.parse(await readFile(new URL("./fixtures/authority.json", import.meta.url)));
  const validator = new Ajv2020({ strict: true }).addSchema(schema);
  for (const item of cases) assert.equal(validator.getSchema(`${schema.$id}#/$defs/${item.kind}`)(item.value), item.valid, item.description);
});

test("Authority proof transcript and Ed25519 vector match the Go fixture", async () => {
  const vector = JSON.parse(await readFile(new URL("./fixtures/authority-proof-vector.json", import.meta.url)));
  const transcript = authorityProofTranscript(vector.payload);
  assert.equal(Buffer.from(transcript).toString(), vector.transcript);
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(vector.payload.publicKey, "base64url")]), format: "der", type: "spki" });
  assert.ok(verify(null, transcript, publicKey, Buffer.from(vector.payload.signature, "base64url")));
  for (const field of ["authorityNodeId", "publicKey", "teamId", "deviceId", "ownerMemberId", "browserOrigin", "nonce", "issuedAt", "expiresAt"]) {
    const changed = authorityProofTranscript({ ...vector.payload, [field]: `${vector.payload[field]}x` });
    assert.equal(verify(null, changed, publicKey, Buffer.from(vector.payload.signature, "base64url")), false, field);
  }
});
