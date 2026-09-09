import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateBridgeMessage } from "../generated/runtime/bridge-validator.mjs";
test("runtime approvals retain closed request and single-operation decision contracts", async () => {
 const suite = JSON.parse(await readFile(new URL("../fixtures/runtime-approval-cases.json", import.meta.url), "utf8"));
 for (const item of suite.cases) assert.equal(validateBridgeMessage(item.instance),item.valid,item.name);
});
