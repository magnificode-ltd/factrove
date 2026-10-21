import { isIP } from "node:net";
import { Injectable } from "@nestjs/common";

// In-memory public HTML views per API process. Processes do not share buckets.
// Keyed by x-factrove-client-ip after assignClientIp. Behind a proxy, set
// TRUSTED_PROXIES or every visitor shares the proxy address.
//
// Counts live in the current window and the previous window. Advancing a window
// rotates those maps, so a request does not scan every visitor. The clock is
// monotonic, and a backward step does not clear the counters.
// When the current map is full, the oldest key is dropped and the new visitor
// is counted. Oldest means first inserted in this window, not least recently
// used, so a busy early visitor is dropped before a later one. A caller who can
// present more than maxKeys addresses can cycle keys and exceed the per-address
// limit. The cap bounds memory. It is not a defence against a large set of
// source addresses. Share tokens are 256 bits, so this limit is for abuse and
// enumeration hygiene.
// allow() charges one view and includes two content loads for 30 seconds.
// allowContent() uses that grant, and charges only when the grant is spent.
export const PUBLIC_VIEW_RATE_MAX = 60;
export const PUBLIC_VIEW_RATE_WINDOW_MS = 60_000;
export const PUBLIC_VIEW_RATE_MAX_KEYS = 10_000;
export const PUBLIC_VIEW_CONTENT_GRANTS = 2;
export const PUBLIC_VIEW_CONTENT_GRANT_MS = 30_000;

const UNKNOWN_CLIENT = "unknown";

type ContentGrant = {
  left: number;
  until: number;
};

@Injectable()
export class PublicViewLimiter {
  private windowStart: number;
  private current = new Map<string, number>();
  private previous = new Map<string, number>();
  private readonly companions = new Map<string, ContentGrant>();

  constructor(
    private readonly max = PUBLIC_VIEW_RATE_MAX,
    private readonly windowMs = PUBLIC_VIEW_RATE_WINDOW_MS,
    private readonly now: () => number = () => performance.now(),
    private readonly maxKeys = PUBLIC_VIEW_RATE_MAX_KEYS,
  ) {
    this.windowStart = this.windowOf(this.now());
  }

  get size(): number {
    return this.current.size;
  }

  allow(clientIp: string | null): boolean {
    const at = this.now();
    this.rotate(at);
    const key = rateLimitKey(clientIp);
    if (!this.charge(key, at)) {
      return false;
    }
    this.grantCompanions(key, at);
    return true;
  }

  allowContent(clientIp: string | null): boolean {
    const at = this.now();
    this.rotate(at);
    const key = rateLimitKey(clientIp);
    if (this.takeCompanion(key, at)) {
      return true;
    }
    return this.charge(key, at);
  }

  private charge(key: string, at: number): boolean {
    const elapsed = at - this.windowStart;
    const previousWeight = Math.min(1, Math.max(0, this.windowMs - elapsed) / this.windowMs);
    const estimate = (this.previous.get(key) ?? 0) * previousWeight + (this.current.get(key) ?? 0);
    if (estimate >= this.max) {
      return false;
    }
    // Insertion order, not recency. Evicting the oldest admits the new visitor
    // and lets a large set of addresses cycle past the per-address limit.
    if (!this.current.has(key) && this.current.size >= this.maxKeys) {
      const oldest = this.current.keys().next().value;
      if (oldest !== undefined) {
        this.current.delete(oldest);
      }
    }
    this.current.set(key, (this.current.get(key) ?? 0) + 1);
    return true;
  }

  private grantCompanions(key: string, at: number): void {
    this.companions.delete(key);
    if (this.companions.size >= this.maxKeys) {
      const oldest = this.companions.keys().next().value;
      if (oldest !== undefined) {
        this.companions.delete(oldest);
      }
    }
    this.companions.set(key, {
      left: PUBLIC_VIEW_CONTENT_GRANTS,
      until: at + PUBLIC_VIEW_CONTENT_GRANT_MS,
    });
  }

  private takeCompanion(key: string, at: number): boolean {
    const grant = this.companions.get(key);
    if (!grant || grant.until < at || grant.left <= 0) {
      if (grant) {
        this.companions.delete(key);
      }
      return false;
    }
    grant.left -= 1;
    if (grant.left === 0) {
      this.companions.delete(key);
    }
    return true;
  }

  private rotate(at: number): void {
    const start = this.windowOf(at);
    // A backward step keeps the budgets already charged in this window.
    if (start <= this.windowStart) {
      return;
    }
    const steps = (start - this.windowStart) / this.windowMs;
    this.previous = steps === 1 ? this.current : new Map();
    this.current = new Map();
    this.windowStart = start;
  }

  private windowOf(at: number): number {
    if (!Number.isFinite(at) || this.windowMs <= 0) {
      return 0;
    }
    return Math.floor(at / this.windowMs) * this.windowMs;
  }
}

export function rateLimitKey(clientIp: string | null): string {
  if (!clientIp || clientIp.length === 0) {
    return UNKNOWN_CLIENT;
  }
  if (isIP(clientIp) === 6) {
    return `v6/${ipv6Prefix64(clientIp)}`;
  }
  return clientIp;
}

function ipv6Prefix64(ip: string): string {
  const halves = ip.toLowerCase().split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = halves.length === 2
    ? [...head, ...Array.from({ length: Math.max(missing, 0) }, () => "0"), ...tail]
    : head;
  return groups.slice(0, 4).map((group) => group.padStart(4, "0")).join(":");
}
