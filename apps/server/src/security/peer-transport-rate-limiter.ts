import { AnonymousRateLimiter } from "./anonymous-rate-limiter.js";

// Continuous, signed Runtime traffic has a different budget from invitation
// attempts. Limits still apply before parsing/authentication, by actual IP;
// untrusted Node IDs cannot create a fresh bucket or bypass these ceilings.
export class PeerTransportRateLimiter {
  private readonly identity = new AnonymousRateLimiter(600);
  private readonly run = new AnonymousRateLimiter(1_200);

  public consume(kind: "identity" | "run", ip: string, nowMilliseconds: number): void {
    this[kind].consume(ip, nowMilliseconds);
  }
}
