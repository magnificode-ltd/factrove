import { ApiErrorException } from "./api-error.js";
import { RateWindow } from "../sharing/rate-window.js";

// These counters live in this API process. Another process, and a restart, has
// its own maps. The 60 second send cooldown is lastSentAt in PostgreSQL and is
// shared. assignClientIp sets the address from the socket, or from
// X-Forwarded-For when the peer is in TRUSTED_PROXIES.

const MAX_KEYS = 10_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const SEND_LIMIT = 10;
const EMAIL_LIMIT = 3;
const PREVIEW_LIMIT = 30;
const ACCEPT_LIMIT = 10;

const RATE_MESSAGE = "Too many invitation requests. Try again later.";

export class InvitationRateLimiter {
  private readonly owners = new RateWindow(SEND_LIMIT, MINUTE_MS, MAX_KEYS, Date.now());
  private readonly organizations = new RateWindow(SEND_LIMIT, MINUTE_MS, MAX_KEYS, Date.now());
  private readonly emails = new RateWindow(EMAIL_LIMIT, HOUR_MS, MAX_KEYS, Date.now());
  private readonly previews = new RateWindow(PREVIEW_LIMIT, MINUTE_MS, MAX_KEYS, Date.now());
  private readonly accepts = new RateWindow(ACCEPT_LIMIT, MINUTE_MS, MAX_KEYS, Date.now());

  chargeSend(ownerId: string, organizationId: string, email: string, at = Date.now()): void {
    this.take(this.owners, `owner:${ownerId}`, at);
    this.take(this.organizations, `org:${organizationId}`, at);
    this.take(this.emails, `email:${organizationId}:${email}`, at);
  }

  chargePreview(clientIp: string, at = Date.now()): void {
    this.take(this.previews, `preview:${clientIp}`, at);
  }

  chargeAccept(clientIp: string, sessionId: string, at = Date.now()): void {
    this.take(this.accepts, `accept:${clientIp}:${sessionId}`, at);
  }

  private take(window: RateWindow, key: string, at: number): void {
    if (window.take(key, at)) {
      return;
    }
    throw new ApiErrorException(429, "RATE_LIMITED", RATE_MESSAGE, window.retryAfterSeconds(key, at));
  }
}
