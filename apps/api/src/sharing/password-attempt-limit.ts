import { Injectable } from "@nestjs/common";
import { rateLimitKey } from "./public-view-limit.js";
import { RateWindow } from "./rate-window.js";

// Password attempts on protected public links, in memory per API process. These buckets are
// separate from the public view limit, so viewing a page never spends password attempts
// and a run of wrong passwords does not block views.
//
// Only failures are charged. A correct password never spends a budget, so a meeting of
// visitors does not lock the next person out. The client bucket is checked before Argon2
// and charged only after a failed verification or a dead-token lookup, so one address
// cannot spend unbounded KDF work. Invalid or non-JSON bodies are rejected before either
// bucket is touched, so a cross-site text/plain POST costs nothing.
//
// The share bucket is keyed by the current share token hash. Revoking and sharing again
// mints a new hash and a fresh budget. Exhausting that bucket still rate-limits further
// wrong guesses on that token, but a correct password succeeds unless this client address
// has already used its own budget. Clients use the same address key as the view limit,
// including the IPv6 /64.
export const PASSWORD_ATTEMPTS_PER_CLIENT = 10;
export const PASSWORD_ATTEMPTS_PER_SHARE = 30;
export const PASSWORD_ATTEMPT_WINDOW_MS = 10 * 60_000;
export const PASSWORD_ATTEMPT_MAX_KEYS = 10_000;

@Injectable()
export class PasswordAttemptLimiter {
  private readonly clients: RateWindow;
  private readonly shares: RateWindow;

  constructor(
    perClient = PASSWORD_ATTEMPTS_PER_CLIENT,
    perShare = PASSWORD_ATTEMPTS_PER_SHARE,
    windowMs = PASSWORD_ATTEMPT_WINDOW_MS,
    private readonly now: () => number = () => performance.now(),
    maxKeys = PASSWORD_ATTEMPT_MAX_KEYS,
  ) {
    const at = this.now();
    this.clients = new RateWindow(perClient, windowMs, maxKeys, at);
    this.shares = new RateWindow(perShare, windowMs, maxKeys, at);
  }

  hasClientRoom(clientIp: string | null): boolean {
    return this.clients.hasRoom(rateLimitKey(clientIp), this.now());
  }

  chargeClient(clientIp: string | null): boolean {
    return this.clients.take(rateLimitKey(clientIp), this.now());
  }

  chargeShare(shareTokenHash: string): boolean {
    return this.shares.take(shareTokenHash, this.now());
  }
}
