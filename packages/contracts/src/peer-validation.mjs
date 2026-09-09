import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalPeerJson, parsePeerJson } from "./peer-json.mjs";

const schema = JSON.parse(readFileSync(new URL("../generated/runtime/peer-schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map(Object.keys(schema.$defs).map(kind => [kind, ajv.getSchema(`${schema.$id}#/$defs/${kind}`)]));

export function validatePeer(kind, value) {
  try { canonicalPeerJson(value); } catch { return false; }
  return validators.get(kind)?.(value) === true;
}

export function decodePeer(kind, data) {
  const value = parsePeerJson(data, { integerOnly: true });
  if (!validatePeer(kind, value)) throw new Error("Invalid Peer message");
  return value;
}
