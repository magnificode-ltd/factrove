import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";

// After a correct password the visitor receives a grant: an HMAC over the artifact id, the
// share-token hash, the stored password fingerprint, and an expiry. The browser keeps it in
// sessionStorage and sends it in the x-factrove-share-grant header on the credential-free
// detail request. It is never a cookie and never part of a URL.
//
// The detail response then carries a content ticket in the iframe URL. A ticket is a separate,
// shorter value with its own label, so the iframe never sees the grant. A ticket only reads this
// share's HTML, lasts 60 seconds, and is honored a few times per process.
//
// Nothing is stored for a grant. Changing or removing the password changes the fingerprint.
// Revoking the share or sharing again changes the token hash. Rotating SHARE_TOKEN_KEY, or
// BETTER_AUTH_SECRET when that key is unset, changes the signing key. Each one invalidates
// every grant and ticket already issued.
export const SHARE_GRANT_TTL_SECONDS = 15 * 60;
export const SHARE_TICKET_TTL_SECONDS = 60;
// The frame's content check, a repeated check when React re-runs the effect, and the frame load.
export const SHARE_TICKET_MAX_USES = 3;
export const SHARE_TICKET_MAX_KEYS = 10_000;
const CLOCK_SKEW_SECONDS = 60;
const KEY_BYTES = 32;
const HKDF_SALT = "factrove-share-grant-v1";
const HKDF_INFO = "factrove share grant";
const GRANT_PREFIX = "g1";
const TICKET_PREFIX = "t1";
const NONCE_BYTES = 16;
const GRANT_PATTERN = /^g1\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{43})$/;
const TICKET_PATTERN = /^t1\.([0-9a-z]{1,10})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

export type ShareGrantScope = {
  artifactId: string;
  shareTokenHash: string;
  passwordFingerprint: string;
};

export function deriveShareGrantKey(material: string): Buffer {
  return Buffer.from(hkdfSync("sha256", material, HKDF_SALT, HKDF_INFO, KEY_BYTES));
}

export function mintShareGrant(scope: ShareGrantScope, key: Buffer, nowMs = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + SHARE_GRANT_TTL_SECONDS;
  const signature = sign(key, ["grant", ...scopeFields(scope), String(exp)]);
  return { token: `${GRANT_PREFIX}.${exp.toString(36)}.${signature}`, expiresAt: new Date(exp * 1000) };
}

export function shareGrantAllows(token: unknown, scope: ShareGrantScope, key: Buffer, nowMs = Date.now()): boolean {
  if (typeof token !== "string") {
    return false;
  }
  const match = GRANT_PATTERN.exec(token);
  if (!match) {
    return false;
  }
  const exp = Number.parseInt(match[1] ?? "", 36);
  if (!isLive(exp, SHARE_GRANT_TTL_SECONDS, nowMs)) {
    return false;
  }
  return sameSignature(match[2] ?? "", sign(key, ["grant", ...scopeFields(scope), String(exp)]));
}

export function mintShareTicket(scope: ShareGrantScope, key: Buffer, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SHARE_TICKET_TTL_SECONDS;
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  const signature = sign(key, ["ticket", ...scopeFields(scope), String(exp), nonce]);
  return `${TICKET_PREFIX}.${exp.toString(36)}.${nonce}.${signature}`;
}

export function readShareTicket(
  token: unknown,
  scope: ShareGrantScope,
  key: Buffer,
  nowMs = Date.now(),
): { nonce: string; expiresAtMs: number } | null {
  if (typeof token !== "string") {
    return null;
  }
  const match = TICKET_PATTERN.exec(token);
  if (!match) {
    return null;
  }
  const exp = Number.parseInt(match[1] ?? "", 36);
  const nonce = match[2] ?? "";
  if (!isLive(exp, SHARE_TICKET_TTL_SECONDS, nowMs)) {
    return null;
  }
  if (!sameSignature(match[3] ?? "", sign(key, ["ticket", ...scopeFields(scope), String(exp), nonce]))) {
    return null;
  }
  return { nonce, expiresAtMs: exp * 1000 };
}

// Counts ticket redemptions in this process. Entries leave when their ticket expires.
// When the map is full the oldest entry is dropped, which can give that ticket its uses
// back until it expires. Other API processes keep their own counts.
@Injectable()
export class ShareTicketLedger {
  private readonly uses = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly maxUses = SHARE_TICKET_MAX_USES,
    private readonly maxKeys = SHARE_TICKET_MAX_KEYS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get size(): number {
    return this.uses.size;
  }

  redeem(nonce: string, expiresAtMs: number): boolean {
    const at = this.now();
    this.sweep(at);
    const entry = this.uses.get(nonce);
    if (entry) {
      if (entry.count >= this.maxUses) {
        return false;
      }
      entry.count += 1;
      return true;
    }
    if (this.uses.size >= this.maxKeys) {
      const oldest = this.uses.keys().next().value;
      if (oldest !== undefined) {
        this.uses.delete(oldest);
      }
    }
    this.uses.set(nonce, { count: 1, until: expiresAtMs });
    return true;
  }

  private sweep(at: number): void {
    for (const [nonce, entry] of this.uses) {
      if (entry.until > at) {
        return;
      }
      this.uses.delete(nonce);
    }
  }
}

function scopeFields(scope: ShareGrantScope): string[] {
  return [scope.artifactId.toLowerCase(), scope.shareTokenHash, scope.passwordFingerprint];
}

function sign(key: Buffer, fields: string[]): string {
  return createHmac("sha256", key).update(fields.join("\n")).digest("base64url");
}

function sameSignature(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

function isLive(exp: number, ttlSeconds: number, nowMs: number): boolean {
  if (!Number.isSafeInteger(exp)) {
    return false;
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  return exp > nowSeconds && exp <= nowSeconds + ttlSeconds + CLOCK_SKEW_SECONDS;
}
