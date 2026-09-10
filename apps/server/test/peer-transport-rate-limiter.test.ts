import assert from "node:assert/strict";
import test from "node:test";
import { PeerTransportRateLimiter } from "../src/security/peer-transport-rate-limiter.js";
import { AnonymousRateLimitError } from "../src/security/anonymous-rate-limiter.js";

test("Peer transport retains bounded independent IP budgets and one-minute recovery", () => {
  const limits = new PeerTransportRateLimiter();
  for (let count = 0; count < 600; count++) limits.consume("identity", "127.0.0.1", 0);
  assert.throws(() => limits.consume("identity", "127.0.0.1", 59_999), AnonymousRateLimitError);
  for (let count = 0; count < 1_200; count++) limits.consume("run", "127.0.0.1", 0);
  assert.throws(() => limits.consume("run", "127.0.0.1", 59_999), AnonymousRateLimitError);
  limits.consume("identity", "127.0.0.2", 59_999);
  limits.consume("run", "127.0.0.2", 59_999);
  limits.consume("identity", "127.0.0.1", 60_000);
  limits.consume("run", "127.0.0.1", 60_000);
});
