import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { writeFile, chmod, symlink, unlink } from "node:fs/promises";
import { createTestResources } from "../../../scripts/test/resources.mjs";
import { createServerApp } from "../src/app.js";
import { readSpaceDirectory } from "../src/local-node/space-directory.js";

const nodeId = "node_localfixture001", origin = "http://127.0.0.1:48123";
const remote = { authorityNodeId: "node_remotefixture001", teamId: "team_samefixture001", label: "Remote Host", kind: "remote", browserOrigin: "https://remote.example" };
test("Space references reject secret fields, hostile origins, identity aliases and unsafe local files", async t => {
  const resources = await createTestResources(t, "convenewire-spaces-");
  const file = path.join(resources.directory, "spaces.json");
  assert.deepEqual(await readSpaceDirectory(file,nodeId,origin),{schemaVersion:1,spaces:[]});
  const save = (spaces: unknown[]) => writeFile(file,JSON.stringify({schemaVersion:1,spaces}),{mode:0o600});
  await save([remote]); assert.deepEqual((await readSpaceDirectory(file,nodeId,origin)).spaces,[remote]);
  for (const change of [{token:"secret"},{browserOrigin:"javascript:alert(1)"},{browserOrigin:"https://user:secret@remote.example"},
    {browserOrigin:"http://remote.example"},{browserOrigin:"https://remote.example/path"},{browserOrigin:"https://remote.example?token=secret"},
    {browserOrigin:origin},{kind:"hosted"},{authorityNodeId:nodeId}]) {
    await save([{...remote,...change}]); await assert.rejects(readSpaceDirectory(file,nodeId,origin),/unavailable/u);
  }
  for (const spaces of [[remote,remote], [remote,{...remote,authorityNodeId:"node_aliasedfixture001"}], Array(17).fill(remote)]) {
    await save(spaces); await assert.rejects(readSpaceDirectory(file,nodeId,origin));
  }
  await writeFile(file," ".repeat(16385)); await assert.rejects(readSpaceDirectory(file,nodeId,origin));
  if (process.platform !== "win32") {
    await save([remote]); await chmod(file,0o644); await assert.rejects(readSpaceDirectory(file,nodeId,origin));
    await chmod(file,0o600); const link=path.join(resources.directory,"link.json");await symlink(file,link);
    await assert.rejects(readSpaceDirectory(link,nodeId,origin)); await unlink(link);
  }
});
test("Local Space endpoint requires the local Owner and exposes only navigation references", async t => {
  const resources=await createTestResources(t,"convenewire-spaces-owner-");
  const file=path.join(resources.directory,"spaces.json");await writeFile(file,JSON.stringify({schemaVersion:1,spaces:[remote]}),{mode:0o600});
  const secret=()=>randomBytes(32).toString("base64url");
  const localNode={schemaVersion:1 as const,controlToken:secret(),identity:{schemaVersion:1 as const,nodeId,ownerUserId:"user_localfixture001",port:48123,secret:secret()}};
  const app=await createServerApp({databasePath:path.join(resources.directory,"hub.sqlite"),localNode,localNodeSpaceDirectory:file});resources.defer(()=>app.close());
  const host=new URL(origin).host;
  assert.equal((await app.inject({url:"/api/local-node/spaces",headers:{host}})).statusCode,401);
  const entry=await app.inject({method:"POST",url:"/api/local-node/control/entry",headers:{host,"x-convenewire-node-control":localNode.controlToken}});
  const session=await app.inject({method:"POST",url:"/api/local-node/session",headers:{host,origin},payload:{ticket:entry.json().url.split("/").at(-1)}});
  const response=await app.inject({url:"/api/local-node/spaces",headers:{host,authorization:`Bearer ${session.json().session.token}`}});
  assert.equal(response.statusCode,200,response.body); assert.deepEqual(response.json().spaces,[remote]);
  assert.match(response.headers["cache-control"] as string,/no-store/u);
  assert.ok(!response.body.includes(localNode.identity.secret));assert.ok(!response.body.includes(session.json().session.token));
});
