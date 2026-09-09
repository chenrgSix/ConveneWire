import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

test("Local Node private control fixtures obey the shared closed schema", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/local-node/control.schema.json", import.meta.url)));
  const cases = JSON.parse(await readFile(new URL("./fixtures/local-node.json", import.meta.url)));
  const ajv = new Ajv2020({ strict: true }).addSchema(schema);
  for (const item of cases) assert.equal(ajv.getSchema(`${schema.$id}#/$defs/${item.kind}`)(item.value), item.valid, JSON.stringify(item));
});
