import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalExecutionJSON } from "./execution-validation.mjs";

const ajv = new Ajv2020({ strict: true, allErrors: false });
addFormats(ajv);
const schema = JSON.parse(readFileSync(new URL("../generated/go/runtime/disclosure-schema.json", import.meta.url), "utf8"));
ajv.addSchema(schema);
const kinds = new Set(["disclosureIntent", "disclosureGrant", "disclosurePublishCommand", "disclosureRevokeCommand", "disclosureReceipt"]);
export function assertDisclosure(kind, value) {
  if (!kinds.has(kind) || !ajv.getSchema(`${schema.$id}#/$defs/${kind}`)(value)) throw new Error("Invalid evidence disclosure contract");
  // The canonical serializer also rejects non-finite numbers and malformed Unicode.
  canonicalExecutionJSON(value);
  const intent = kind === "disclosureGrant" ? value.intent : kind === "disclosureIntent" ? value : null;
  if (intent && intent.source.end <= intent.source.start) throw new Error("Invalid evidence disclosure range");
}
export function disclosureIntentDigest(value) {
  assertDisclosure("disclosureIntent", value);
  return createHash("sha256").update(canonicalExecutionJSON(value)).digest("hex");
}
export function disclosureContentDigest(content) {
  if (typeof content !== "string" || content !== content.trim() || !content || Buffer.byteLength(content) > 16384 ||
      Buffer.from(content, "utf8").toString("utf8") !== content) throw new Error("Invalid disclosure content");
  return createHash("sha256").update(content, "utf8").digest("hex");
}
