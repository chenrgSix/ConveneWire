// Peer semantic JSON uses RFC 8785. Legacy Device Inbox hashing is unchanged.
export const peerJsonMaximumBytes = 1_048_576;
export const peerJsonMaximumDepth = 64;
const encoder = new TextEncoder();
const invalid = () => new Error("Invalid Peer JSON");
function unicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw invalid();
  }
  return value;
}

/** Strict raw decoding preserves JSON types and rejects duplicate decoded keys. */
export function parsePeerJson(input) {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) throw invalid();
  if (input.length > peerJsonMaximumBytes) throw invalid();
  const source = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  if (encoder.encode(source).length > peerJsonMaximumBytes) throw invalid();
  let position = 0;
  const space = () => { while (/[\x20\t\r\n]/u.test(source[position] ?? "x")) position++; };
  const string = () => {
    const start = position++;
    while (position < source.length) {
      const ch = source[position++];
      if (ch === '"') return unicode(JSON.parse(source.slice(start, position)));
      if (ch === "\\") position++;
    }
    throw invalid();
  };
  const read = (depth) => {
    if (depth > peerJsonMaximumDepth) throw invalid();
    space();
    const ch = source[position];
    if (ch === '"') return string();
    if (ch === "{" || ch === "[") {
      position++; space();
      const object = ch === "{";
      const result = object ? Object.create(null) : [];
      const close = object ? "}" : "]";
      if (source[position] === close) { position++; return result; }
      while (true) {
        space();
        if (object) {
          if (source[position] !== '"') throw invalid();
          const key = string(); space();
          if (source[position++] !== ":" || Object.hasOwn(result, key)) throw invalid();
          result[key] = read(depth + 1);
        } else result.push(read(depth + 1));
        space();
        const next = source[position++];
        if (next === close) return result;
        if (next !== ",") throw invalid();
      }
    }
    const primitive = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(source.slice(position));
    if (!primitive) throw invalid();
    position += primitive[0].length;
    const value = JSON.parse(primitive[0]);
    if (typeof value === "number" && !Number.isFinite(value)) throw invalid();
    return value;
  };
  const value = read(0); space();
  if (position !== source.length) throw invalid();
  return value;
}

/** Accept JSON values only; never invoke custom toJSON hooks or getters. */
export function canonicalPeerJson(value) {
  const active = new Set();
  const chunks = [];
  let size = 0;
  const append = (text) => {
    size += encoder.encode(text).length;
    if (size > peerJsonMaximumBytes) throw invalid();
    chunks.push(text);
  };
  const write = (item, depth) => {
    if (depth > peerJsonMaximumDepth) throw invalid();
    if (item === null || typeof item === "boolean") { append(JSON.stringify(item)); return; }
    if (typeof item === "string") { append(JSON.stringify(unicode(item))); return; }
    if (typeof item === "number" && Number.isFinite(item)) { append(JSON.stringify(item)); return; }
    if (typeof item !== "object" || active.has(item)) throw invalid();
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw invalid();
    if (Object.getOwnPropertySymbols(item).length) throw invalid();
    if (array && item.length > peerJsonMaximumBytes) throw invalid();
    active.add(item);
    append(array ? "[" : "{");
    const keys = array ? Array.from({ length: item.length }, (_, i) => String(i)) : Object.keys(item).sort();
    if (keys.length > peerJsonMaximumBytes) throw invalid();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i], descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw invalid();
      if (i) append(",");
      if (!array) { append(JSON.stringify(unicode(key))); append(":"); }
      write(descriptor.value, depth + 1);
    }
    if (array && Object.keys(item).length !== keys.length) throw invalid();
    append(array ? "]" : "}");
    active.delete(item);
  };
  write(value, 0);
  return encoder.encode(chunks.join(""));
}
