import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateBridgeMessage } from "../generated/runtime/bridge-validator.mjs";

test("conversation proposals retain a bounded optional wire contract", async () => {
  const suite = JSON.parse(await readFile(new URL("../fixtures/conversation-work-cases.json", import.meta.url), "utf8"));
  for (const item of suite.cases) assert.equal(validateBridgeMessage(item.instance), item.valid, item.name);
  const legacy = structuredClone(suite.cases[0].instance);
  delete legacy.payload.conversationWork;
  assert.equal(validateBridgeMessage(legacy), true);
});
