import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { stat, writeFile, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { peerDigest } from "@convene-wire/contracts/peer-proof";
import { ingressSecret, nativePeerIngressFixture } from "./helpers/native-peer-ingress-fixture.js";

test("Peer Host browser fixture serves the production Web with actual scoped admission", {
  skip: !process.env.CONVENE_WIRE_PEER_HOST_PREVIEW_FILE, timeout: 600_000
}, async t => {
  const preview = path.resolve(process.env.CONVENE_WIRE_PEER_HOST_PREVIEW_FILE!);
  const f = await nativePeerIngressFixture(t, { webRoot: path.resolve("../web/dist") });
  const { joined } = await f.join();
  const offer = { schemaVersion: 1, displayName: "远端代码审阅", role: "Reviewer", grant: { schemaVersion: 1,
    exportId: "export_browserfixture1", revision: 1, state: "active", issuedAt: f.now, expiresAt: joined.runtime.membership.expiresAt,
    peerId: joined.runtime.membership.peerId, teamId: f.team.teamId, participantNodeId: joined.runtime.membership.participantNodeId,
    authorityNodeId: joined.runtime.membership.hostNodeId, localAgentId: "agent_browserfixture1", roomIds: [f.room.roomId], capabilities: {
      supportsStart: true, supportsStreaming: true, supportsInterrupt: true, supportsResume: false,
      supportsTaskContextIsolation: true, supportsOwnerPrivateOutput: false
    } } };
  const offered = await f.request("/api/peer/agents/offers", { method: "POST", headers: { authorization: `Bearer ${joined.runtime.machineCredential.token}` },
    payload: { schemaVersion: 1, offer, proof: f.proof("agent.export", "op_browserfixture1", ingressSecret(), peerDigest(offer)) } });
  assert.equal(offered.status, 200, offered.body);
  const entry = await f.app.inject({ method: "POST", url: "/api/local-node/control/entry",
    headers: { host: new URL(f.localOrigin).host, "x-convenewire-node-control": f.launch.controlToken } });
  assert.equal(entry.statusCode, 200);
  await writeFile(preview, JSON.stringify({ entry: entry.json().url, origin: f.localOrigin }), { mode: 0o600, flag: "wx" });
  t.after(async () => { await rm(preview, { force: true }); await rm(`${preview}.done`, { force: true }); });
  for (let attempt = 0; attempt < 1080; attempt++) {
    if (await stat(`${preview}.done`).then(() => true, () => false)) return;
    await setTimeout(500);
  }
  assert.fail("Browser fixture exceeded its bounded preview window");
});
