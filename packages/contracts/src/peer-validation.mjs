import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalPeerJson, parsePeerJson } from "./peer-json.mjs";
import schema from "../generated/runtime/peer-schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validators = new Map(Object.keys(schema.$defs).map(kind => [kind, ajv.getSchema(`${schema.$id}#/$defs/${kind}`)]));

export function validatePeer(kind, value) {
  try { canonicalPeerJson(value); } catch { return false; }
  return validators.get(kind)?.(value) === true;
}

export function decodePeer(kind, data) {
  // Assessment confidence is descriptive binary64 data. Every authorization
  // pin and sequence still validates its original exact integer spelling.
  const fractionalPaths = kind === "PeerRunEventRequest" ? ["/event/assessment/confidence"] :
    ["PeerRunEvent", "PeerRunReplyEvent"].includes(kind) ? ["/assessment/confidence"] : [];
  const value = parsePeerJson(data, { integerOnly: true, fractionalPaths });
  if (!validatePeer(kind, value)) throw new Error("Invalid Peer message");
  return value;
}
