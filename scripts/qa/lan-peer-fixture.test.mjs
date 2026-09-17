import assert from "node:assert/strict";
import test from "node:test";
import { acceptedLanHello, privateIPv4, lanCases } from "./lan-peer-fixture.mjs";

test("LAN fixture refuses public/listen-all addresses and unreviewed control sessions", () => {
  for (const address of ["0.0.0.0", "8.8.8.8", "134.175.217.20", "192.168.1.999", "example.org"]) assert.equal(Boolean(privateIPv4(address)), false);
  for (const address of ["127.0.0.1", "192.168.1.82", "172.16.1.2", "10.0.0.1"]) assert.equal(privateIPv4(address), true);
  const token = "a".repeat(43), value = { token, now: "2026-09-17T00:00:00Z", test: lanCases[0] };
  assert.equal(acceptedLanHello(value, token), true);
  for (const changed of [{ ...value, token: "b".repeat(43) }, { ...value, token: "short" }, { ...value, test: "arbitrary-command" },
    { ...value, token: "é".repeat(43) }, { ...value, now: "invalid" }, { ...value, command: "unreviewed" }, null]) assert.equal(acceptedLanHello(changed, token), false);
});
