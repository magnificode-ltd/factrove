import { Injectable } from "@nestjs/common";
import { rateLimitKey } from "./public-view-limit.js";
import { RateWindow } from "./rate-window.js";

// Password attempts on protected public links, in memory per API process. These buckets are
// separate from the public view limit, so viewing a page never spends password attempts
// and a run of wrong passwords does not block views.
//
// Every attempt is charged, right or wrong, so Argon2 work per caller stays bounded.
// The client bucket is charged before the link is looked up, so guessing tokens here is
// throttled too. The share bucket is charged only after the token matches, so only someone
// who already holds the link can spend that share's budget. Clients use the same address
// key as the view limit, including the IPv6 /64.
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

  allowClient(clientIp: string | null): boolean {
    return this.clients.take(rateLimitKey(clientIp), this.now());
  }

  allowShare(artifactId: string): boolean {
    return this.shares.take(artifactId.toLowerCase(), this.now());
  }
}
