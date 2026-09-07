import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertDisclosure, disclosureContentDigest, disclosureIntentDigest } from "../src/disclosure-validation.mjs";
const { cases } = JSON.parse(await readFile(new URL("../fixtures/disclosure-cases.json", import.meta.url), "utf8"));
for (const entry of cases) test(`disclosure: ${entry.name}`, () => {
  if (entry.valid) assert.doesNotThrow(() => assertDisclosure(entry.kind, entry.value));
  else assert.throws(() => assertDisclosure(entry.kind, entry.value));
});
test("disclosure hashes bind exact UTF-8 and source range", () => {
  const intent = cases[0].value;
  assert.notEqual(disclosureIntentDigest(intent), disclosureIntentDigest({ ...intent, source: { ...intent.source, start: 1 } }));
  assert.notEqual(disclosureContentDigest("yes"), disclosureContentDigest("Yes"));
  for (const value of ["", "text\n", "\ud800", "证".repeat(6000)]) assert.throws(() => disclosureContentDigest(value));
});
