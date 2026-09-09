import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalPeerJson, parsePeerJson, peerJsonMaximumBytes, peerJsonMaximumDepth } from "../src/peer-json.mjs";
const fixtures = JSON.parse(await readFile(new URL("./fixtures/peer-json.json", import.meta.url)));
const text = value => new TextDecoder().decode(canonicalPeerJson(value));

test("Peer canonical JSON matches RFC number and Unicode ordering vectors", () => {
  for (const [bits, expected] of fixtures.numbers) {
    const value = Buffer.from(bits, "hex").readDoubleBE();
    if (expected === null) assert.throws(() => text(value));
    else assert.equal(text(value), expected, bits);
  }
  for (const item of fixtures.good) assert.equal(text(parsePeerJson(item.input)), item.canonical);
});

test("Peer decoding rejects ambiguous keys, malformed Unicode and invalid JSON", () => {
  for (const input of fixtures.bad) assert.throws(() => parsePeerJson(input), input);
  for (const value of [undefined, NaN, Infinity, 1n, Symbol(), new Date(), new Map(), '\ud800', [undefined], new Array(2)]) assert.throws(() => text(value));
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => text(cyclic));
  const getter = {get value() {throw new Error("getter ran");}};
  assert.throws(() => text(getter), /Invalid Peer JSON/u);
  const hook = {toJSON() {throw new Error("hook ran");}};
  assert.throws(() => text(hook), /Invalid Peer JSON/u);
  assert.throws(() => parsePeerJson(new Uint8Array([0x22,0xed,0xa0,0x80,0x22])));
  assert.throws(() => parsePeerJson('"'+'x'.repeat(peerJsonMaximumBytes)+'"'));
  assert.throws(() => parsePeerJson('['.repeat(peerJsonMaximumDepth+1)+'0'+']'.repeat(peerJsonMaximumDepth+1)));
  assert.throws(() => text(new Array(peerJsonMaximumBytes+1)));
});

test("actual Go canonicalizer matches Node for raw JSON and IEEE754 samples", () => {
  let seed = 0x7e57c0de12345678n;
  const inputs = fixtures.good.map(x => x.input);
  for (const [bits, expected] of fixtures.numbers) if (expected !== null) inputs.push(JSON.stringify(Buffer.from(bits, "hex").readDoubleBE()));
  for (let i = 0; i < 2048; i++) {
    seed = BigInt.asUintN(64, seed * 6364136223846793005n + 1442695040888963407n);
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(seed); const number = bytes.readDoubleBE();
    if (Number.isFinite(number)) inputs.push(JSON.stringify({"2":number,"10":[number,"\u2029<>&",{"😀":true,"דּ":false}]}));
  }
  inputs.push(...fixtures.bad, '['.repeat(65)+'0'+']'.repeat(65));
  const result = spawnSync("go", ["run", "./test/interop-peer-json"], {cwd:new URL("../",import.meta.url),input:inputs.map(input=>JSON.stringify({input})).join("\n")+"\n",encoding:"utf8",maxBuffer:8*1024*1024,timeout:120_000});
  assert.equal(result.status,0,result.stderr);
  const output = result.stdout.trim().split("\n").map(line=>JSON.parse(line)); assert.equal(output.length,inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    let canonical;
    try { canonical = text(parsePeerJson(inputs[i])); } catch { assert.equal(output[i].invalid,true,inputs[i]); continue; }
    assert.equal(output[i].canonical,canonical,inputs[i]);
    assert.equal(output[i].sha256,createHash("sha256").update(canonical).digest("hex"));
  }
});
