import { isIP } from "node:net";
import { Injectable } from "@nestjs/common";

// In-memory public HTML views per API process. Processes do not share buckets.
// Keyed by x-factrove-client-ip after assignClientIp. Behind a proxy, set
// TRUSTED_PROXIES or every visitor shares the proxy address.
export const PUBLIC_VIEW_RATE_MAX = 60;
export const PUBLIC_VIEW_RATE_WINDOW_MS = 60_000;
export const PUBLIC_VIEW_RATE_MAX_KEYS = 10_000;

const UNKNOWN_CLIENT = "unknown";

@Injectable()
export class PublicViewLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max = PUBLIC_VIEW_RATE_MAX,
    private readonly windowMs = PUBLIC_VIEW_RATE_WINDOW_MS,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = PUBLIC_VIEW_RATE_MAX_KEYS,
  ) {}

  get size(): number {
    return this.hits.size;
  }

  allow(clientIp: string | null): boolean {
    const at = this.now();
    this.sweep(at);
    const key = rateLimitKey(clientIp);
    const recent = this.hits.get(key) ?? [];
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    return true;
  }

  private sweep(at: number): void {
    for (const [key, stamps] of this.hits) {
      const recent = stamps.filter((stamp) => at - stamp < this.windowMs);
      if (recent.length === 0) {
        this.hits.delete(key);
        continue;
      }
      if (recent.length !== stamps.length) {
        this.hits.set(key, recent);
      }
    }
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
