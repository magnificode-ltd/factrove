import { Injectable } from "@nestjs/common";
import { rateLimitKey } from "./public-view-limit.js";
import { RateWindow, type RateCharge } from "./rate-window.js";

export type { RateCharge };

export type ShareCheckAdmission = "admitted" | "locked" | "busy";

// Password attempts on protected public links, in memory per API process. These buckets are
// separate from the public view limit, so viewing a page never spends password attempts
// and a run of wrong passwords does not block views.
//
// The client failure budget (10 per 10 minutes, IPv6 /64) is reserved before lookup and
// refunded after a match or an infrastructure failure. Dead tokens keep that charge.
// Confirmed share failures (30 per 10 minutes, keyed by the current token hash) are
// recorded only after a wrong password. A match or a server error releases the in-flight
// check without counting it. Exhausted confirmed failures are 429 with no hash work.
// Revoking and sharing again mints a new hash and a fresh share budget.
//
// In-flight checks are counted separately from confirmed failures. Argon2 starts only when
// confirmed + pending is still below 30, so verified wrong guesses cannot exceed the cap.
// 429, the share-lock Retry-After, the bounded delay, and the owner's locked state use
// confirmed failures only. When confirmed is under the cap but every remaining slot is
// already in flight, unlock returns 503 UNLOCK_UNAVAILABLE with Retry-After 1, the same
// as a saturated Argon2 gate. That busy response spends the per-IP verify budget and does
// not refund it, so retries are not free. The client failure budget is refunded.
//
// Every Argon2 verify, success or failure, spends a separate per-IP verify budget
// (20 per minute and 100 per 10 minutes). A saturated global gate does not refund that
// budget, so retries are not free. One IP may run only one verify at a time.
// Recent confirmed share failures add a bounded delay of at most two seconds before
// verify; they do not reject the request. The process-wide Argon2 gate is not held
// during that delay. Clients use the same address key as the view limit.
export const PASSWORD_ATTEMPTS_PER_CLIENT = 10;
export const PASSWORD_ATTEMPTS_PER_SHARE = 30;
export const PASSWORD_ATTEMPT_WINDOW_MS = 10 * 60_000;
export const PASSWORD_ATTEMPT_MAX_KEYS = 10_000;
export const VERIFY_ATTEMPTS_PER_MINUTE = 20;
export const VERIFY_MINUTE_WINDOW_MS = 60_000;
export const VERIFY_ATTEMPTS_PER_WINDOW = 100;
export const VERIFY_WINDOW_MS = PASSWORD_ATTEMPT_WINDOW_MS;
export const SHARE_DELAY_MAX_MS = 2_000;

@Injectable()
export class PasswordAttemptLimiter {
  private readonly clients: RateWindow;
  private readonly shares: RateWindow;
  private readonly verifyMinute: RateWindow;
  private readonly verifyWindow: RateWindow;
  private readonly verifying = new Set<string>();
  private readonly pending = new Map<string, number>();

  constructor(
    perClient = PASSWORD_ATTEMPTS_PER_CLIENT,
    private readonly perShare = PASSWORD_ATTEMPTS_PER_SHARE,
    windowMs = PASSWORD_ATTEMPT_WINDOW_MS,
    private readonly now: () => number = () => performance.now(),
    maxKeys = PASSWORD_ATTEMPT_MAX_KEYS,
    private delayMaxMs = SHARE_DELAY_MAX_MS,
    perVerifyMinute = VERIFY_ATTEMPTS_PER_MINUTE,
    verifyMinuteWindowMs = VERIFY_MINUTE_WINDOW_MS,
    perVerifyWindow = VERIFY_ATTEMPTS_PER_WINDOW,
    verifyWindowMs = VERIFY_WINDOW_MS,
  ) {
    const at = this.now();
    this.clients = new RateWindow(perClient, windowMs, maxKeys, at);
    this.shares = new RateWindow(perShare, windowMs, maxKeys, at);
    this.verifyMinute = new RateWindow(perVerifyMinute, verifyMinuteWindowMs, maxKeys, at);
    this.verifyWindow = new RateWindow(perVerifyWindow, verifyWindowMs, maxKeys, at);
  }

  setDelayMaxMs(delayMaxMs: number): void {
    this.delayMaxMs = delayMaxMs;
  }

  reserveClient(clientIp: string | null): RateCharge | null {
    return this.clients.take(rateLimitKey(clientIp), this.now());
  }

  refundClient(charge: RateCharge): void {
    this.clients.refund(charge, this.now());
  }

  clientRetryAfterSeconds(clientIp: string | null): number {
    return this.clients.retryAfterSeconds(rateLimitKey(clientIp), this.now());
  }

  shareHasRoom(shareTokenHash: string): boolean {
    return this.shares.hasRoom(shareTokenHash, this.now());
  }

  sharePending(shareTokenHash: string): number {
    return this.pending.get(shareTokenHash) ?? 0;
  }

  beginShareCheck(shareTokenHash: string): ShareCheckAdmission {
    const at = this.now();
    if (!this.shares.hasRoom(shareTokenHash, at)) {
      return "locked";
    }
    const pending = this.pending.get(shareTokenHash) ?? 0;
    if (this.shares.used(shareTokenHash, at) + pending >= this.perShare) {
      return "busy";
    }
    this.pending.set(shareTokenHash, pending + 1);
    return "admitted";
  }

  confirmShareFailure(shareTokenHash: string): void {
    if (!this.releasePending(shareTokenHash)) {
      return;
    }
    this.shares.take(shareTokenHash, this.now());
  }

  releaseShareCheck(shareTokenHash: string): void {
    this.releasePending(shareTokenHash);
  }

  shareRetryAfterSeconds(shareTokenHash: string): number {
    return this.shares.retryAfterSeconds(shareTokenHash, this.now());
  }

  shareDelayMs(shareTokenHash: string): number {
    if (this.delayMaxMs <= 0) {
      return 0;
    }
    const used = this.shares.used(shareTokenHash, this.now());
    if (used <= 0) {
      return 0;
    }
    return Math.min(this.delayMaxMs, Math.round((used / PASSWORD_ATTEMPTS_PER_SHARE) * this.delayMaxMs));
  }

  reserveVerify(clientIp: string | null): boolean {
    const key = rateLimitKey(clientIp);
    const at = this.now();
    const minute = this.verifyMinute.take(key, at);
    if (!minute) {
      return false;
    }
    if (!this.verifyWindow.take(key, at)) {
      this.verifyMinute.refund(minute, at);
      return false;
    }
    return true;
  }

  verifyRetryAfterSeconds(clientIp: string | null): number {
    const key = rateLimitKey(clientIp);
    const at = this.now();
    return Math.max(this.verifyMinute.retryAfterSeconds(key, at), this.verifyWindow.retryAfterSeconds(key, at));
  }

  tryBeginVerify(clientIp: string | null): boolean {
    const key = rateLimitKey(clientIp);
    if (this.verifying.has(key)) {
      return false;
    }
    this.verifying.add(key);
    return true;
  }

  endVerify(clientIp: string | null): void {
    this.verifying.delete(rateLimitKey(clientIp));
  }

  private releasePending(shareTokenHash: string): boolean {
    const pending = this.pending.get(shareTokenHash) ?? 0;
    if (pending <= 0) {
      return false;
    }
    if (pending === 1) {
      this.pending.delete(shareTokenHash);
    } else {
      this.pending.set(shareTokenHash, pending - 1);
    }
    return true;
  }
}
