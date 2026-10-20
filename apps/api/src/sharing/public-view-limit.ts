import { Injectable } from "@nestjs/common";

// Public HTML views per client address. Keyed by x-factrove-client-ip after assignClientIp.
export const PUBLIC_VIEW_RATE_MAX = 60;
export const PUBLIC_VIEW_RATE_WINDOW_MS = 60_000;

const UNKNOWN_CLIENT = "unknown";

@Injectable()
export class PublicViewLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max = PUBLIC_VIEW_RATE_MAX,
    private readonly windowMs = PUBLIC_VIEW_RATE_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  allow(clientIp: string | null): boolean {
    const key = clientIp && clientIp.length > 0 ? clientIp : UNKNOWN_CLIENT;
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((stamp) => at - stamp < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    return true;
  }
}
