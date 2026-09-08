import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertExecutionCommand, executionOperationDigest, workTaskGrantId
} from "../src/execution-validation.mjs";

const suite = JSON.parse(await readFile(
  new URL("../fixtures/work-policy-cases.json", import.meta.url), "utf8"
));

test("standing policy negotiation admits only bounded shared wire fixtures", () => {
  for (const { name, kind, instance, valid } of suite.cases) {
    if (valid) assert.doesNotThrow(() => assertExecutionCommand(kind, instance), name);
    else assert.throws(() => assertExecutionCommand(kind, instance), undefined, name);
  }
});

test("authorization identity precedes its plan and cannot follow another initiator", () => {
  const request = suite.cases.find((entry) => entry.kind === "workAuthorization").instance;
  assert.equal(workTaskGrantId(request.parent), suite.grantId);
  assert.notEqual(workTaskGrantId({ ...request.parent, authorizationId: "op_work_second001" }), suite.grantId);
  assert.notEqual(workTaskGrantId({ ...request.parent, initiatorMemberId: "member_other0001" }), suite.grantId);
  const changed = structuredClone(request);
  changed.spec.planDigest = "f".repeat(64);
  assert.equal(workTaskGrantId(changed.parent), suite.grantId);
  assert.notEqual(executionOperationDigest(changed), executionOperationDigest(request));
  assert.throws(() => workTaskGrantId({ ...request.parent, revision: 2 }));
});
