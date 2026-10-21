// A per-key budget over a sliding window, approximated from the current window and the
// previous window. Advancing a window rotates those maps, so a request does not scan every key.
// The caller supplies a monotonic time. A backward step keeps the budgets already charged.
//
// When the current map is full, the oldest key is dropped and the new key is counted.
// Oldest means first inserted in this window, not least recently used. A caller who can
// present more than maxKeys keys can cycle them and exceed the per-key limit. The cap
// bounds memory.
export class RateWindow {
  private windowStart: number;
  private current = new Map<string, number>();
  private previous = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys: number,
    at: number,
  ) {
    this.windowStart = this.windowOf(at);
  }

  get size(): number {
    return this.current.size;
  }

  hasRoom(key: string, at: number): boolean {
    this.rotate(at);
    return this.used(key, at) < this.max;
  }

  used(key: string, at: number): number {
    this.rotate(at);
    return this.estimate(key, at);
  }

  retryAfterSeconds(key: string, at: number): number {
    this.rotate(at);
    if (this.estimate(key, at) < this.max) {
      return 0;
    }
    const elapsed = at - this.windowStart;
    const current = this.current.get(key) ?? 0;
    const previous = this.previous.get(key) ?? 0;
    if (current >= this.max || previous <= 0) {
      return Math.max(1, Math.ceil((this.windowMs - elapsed) / 1000));
    }
    const neededElapsed = this.windowMs - ((this.max - current) * this.windowMs) / previous;
    return Math.max(1, Math.ceil(Math.max(0, neededElapsed - elapsed) / 1000));
  }

  take(key: string, at: number): boolean {
    this.rotate(at);
    if (this.estimate(key, at) >= this.max) {
      return false;
    }
    if (!this.current.has(key) && this.current.size >= this.maxKeys) {
      const oldest = this.current.keys().next().value;
      if (oldest !== undefined) {
        this.current.delete(oldest);
      }
    }
    this.current.set(key, (this.current.get(key) ?? 0) + 1);
    return true;
  }

  refund(key: string, at: number): void {
    this.rotate(at);
    if (decrementMap(this.current, key)) {
      return;
    }
    decrementMap(this.previous, key);
  }

  private estimate(key: string, at: number): number {
    const elapsed = at - this.windowStart;
    const previousWeight = Math.min(1, Math.max(0, this.windowMs - elapsed) / this.windowMs);
    return (this.previous.get(key) ?? 0) * previousWeight + (this.current.get(key) ?? 0);
  }

  private rotate(at: number): void {
    const start = this.windowOf(at);
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

function decrementMap(counts: Map<string, number>, key: string): boolean {
  const count = counts.get(key);
  if (count === undefined || count <= 0) {
    return false;
  }
  if (count === 1) {
    counts.delete(key);
  } else {
    counts.set(key, count - 1);
  }
  return true;
}

