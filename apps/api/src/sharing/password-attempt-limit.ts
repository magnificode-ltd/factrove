import { Injectable } from "@nestjs/common";
import { rateLimitKey } from "./public-view-limit.js";
import { RateWindow } from "./rate-window.js";

// Password attempts on protected public links, in memory per API process. These buckets are
// separate from the public view limit, so viewing a page never spends password attempts
// and a run of wrong passwords does not block views.
//
// Both budgets are reserved before Argon2, including a correct password. Exhausted means
// 429 with no hash verification. The client slot is refunded after a match so one address
// can unlock again; the share slot is kept, so rotating addresses cannot keep guessing.
// Invalid or non-JSON bodies are rejected before either bucket is touched, so a cross-site
// text/plain POST costs nothing. A dead-token lookup keeps the client charge. An unprotected
// matching link refunds the client and does not touch the share bucket.
//
// The share bucket is keyed by the current share token hash. Revoking and sharing again
// mints a new hash, a fresh budget, and a cleared backoff. That is how the owner recovers
// after the share is exhausted. Failed verifications also start a per-share exponential
// cooldown. During that cooldown the next attempt is 429 without Argon2. Clients use the
// same address key as the view limit, including the IPv6 /64.
export const PASSWORD_ATTEMPTS_PER_CLIENT = 10;
export const PASSWORD_ATTEMPTS_PER_SHARE = 30;
export const PASSWORD_ATTEMPT_WINDOW_MS = 10 * 60_000;
export const PASSWORD_ATTEMPT_MAX_KEYS = 10_000;
export const SHARE_BACKOFF_BASE_MS = 1_000;
export const SHARE_BACKOFF_MAX_MS = 32_000;

type ShareBackoff = {
  failures: number;
  until: number;
};

@Injectable()
export class PasswordAttemptLimiter {
  private readonly clients: RateWindow;
  private readonly shares: RateWindow;
  private readonly backoffs = new Map<string, ShareBackoff>();

  constructor(
    perClient = PASSWORD_ATTEMPTS_PER_CLIENT,
    perShare = PASSWORD_ATTEMPTS_PER_SHARE,
    windowMs = PASSWORD_ATTEMPT_WINDOW_MS,
    private readonly now: () => number = () => performance.now(),
    maxKeys = PASSWORD_ATTEMPT_MAX_KEYS,
    private readonly backoffBaseMs = SHARE_BACKOFF_BASE_MS,
  ) {
    const at = this.now();
    this.clients = new RateWindow(perClient, windowMs, maxKeys, at);
    this.shares = new RateWindow(perShare, windowMs, maxKeys, at);
  }

  reserveClient(clientIp: string | null): boolean {
    return this.clients.take(rateLimitKey(clientIp), this.now());
  }

  refundClient(clientIp: string | null): void {
    this.clients.refund(rateLimitKey(clientIp), this.now());
  }

  reserveShare(shareTokenHash: string): boolean {
    return this.shares.take(shareTokenHash, this.now());
  }

  refundShare(shareTokenHash: string): void {
    this.shares.refund(shareTokenHash, this.now());
  }

  shareIsCooling(shareTokenHash: string): boolean {
    if (this.backoffBaseMs <= 0) {
      return false;
    }
    const backoff = this.backoffs.get(shareTokenHash);
    return backoff !== undefined && this.now() < backoff.until;
  }

  noteShareFailure(shareTokenHash: string): void {
    if (this.backoffBaseMs <= 0) {
      return;
    }
    const previous = this.backoffs.get(shareTokenHash);
    const failures = (previous?.failures ?? 0) + 1;
    // The first miss stays free so a typo and the correct password can follow immediately.
    const delay = failures < 2
      ? 0
      : Math.min(SHARE_BACKOFF_MAX_MS, this.backoffBaseMs * 2 ** Math.min(failures - 2, 10));
    if (!this.backoffs.has(shareTokenHash) && this.backoffs.size >= PASSWORD_ATTEMPT_MAX_KEYS) {
      const oldest = this.backoffs.keys().next().value;
      if (oldest !== undefined) {
        this.backoffs.delete(oldest);
      }
    }
    this.backoffs.set(shareTokenHash, { failures, until: this.now() + delay });
  }

  clearShareBackoff(shareTokenHash: string): void {
    this.backoffs.delete(shareTokenHash);
  }
}

