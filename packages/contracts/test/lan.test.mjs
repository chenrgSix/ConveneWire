import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {decodePeer, validatePeer} from "../src/peer-validation.mjs";

test("LAN material is closed, bounded and decoded identically by Go and Node", () => {
  const transport = {schemaVersion: 1, host: {nodeId: "node_lanfixture001", publicKey: "A".repeat(43)},
    hostOrigin: "https://node.convenewire.invalid", caCertificatePem: "X".repeat(100), endpoints: [{address: "192.168.1.254", port: 48124}], expiresAt: "2026-09-23T10:00:00.000Z"};
  const cases = [{kind: "PeerLANTransport", value: transport, valid: true},
    {kind: "PeerLANSignedTransport", value: {transport, signature: "A".repeat(86)}, valid: true}];
  for (const [key, value] of [["privateKeyPem", "private"], ["schemaVersion", 2], ["endpoints", []], ["endpoints", Array(9).fill(transport.endpoints[0])], ["caCertificatePem", "X".repeat(8193)]]) {
    cases.push({kind: "PeerLANTransport", value: {...transport, [key]: value}, valid: false});
  }
  for (const address of ["127.0.0.1", "8.8.8.8", "localhost", "192.168.01.1", "10.999.1.1", "172.32.1.1", "::1", "10.0.0.1\n"]) {
    cases.push({kind: "PeerLANTransport", value: {...transport, endpoints: [{address, port: 48124}]}, valid: false});
  }
  for (const port of [0, 443, 65536, 48124.1, "48124"]) cases.push({kind: "PeerLANTransport", value: {...transport, endpoints: [{address: "10.0.0.1", port}]}, valid: false});
  const inputs = cases.map(item => {
    assert.equal(validatePeer(item.kind, item.value), item.valid, JSON.stringify(item));
    return {action: "decode", kind: item.kind, raw: JSON.stringify(item.value), valid: item.valid};
  });
  inputs.push({action: "decode", kind: "PeerLANTransport", raw: JSON.stringify(transport).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), valid: false});
  assert.throws(() => decodePeer("PeerLANTransport", inputs.at(-1).raw));
  const result = spawnSync("go", ["run", "./test/interop-relay"], {cwd: new URL("../", import.meta.url), input: inputs.map(item => JSON.stringify(item)).join("\n")+"\n", encoding: "utf8", timeout: 120000, maxBuffer: 1024*1024});
  assert.equal(result.status, 0, result.stderr);
  const actual = result.stdout.trim().split("\n").map(line => JSON.parse(line).valid);
  assert.deepEqual(actual, inputs.map(item => item.valid));
});
