import { invitationReturnPath, safeNextPath } from "@factrove/contracts";

export { invitationReturnPath, safeNextPath } from "@factrove/contracts";

export const INVITE_RETURN_COOKIE = "factrove-invite-next";

// An invitation lasts 7 days. The return cookie never outlives that, and a
// refresh that does not know the expiry uses a shorter hour.
export const INVITATION_RETURN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const INVITE_RETURN_REFRESH_SECONDS = 60 * 60;

export function invitationCookieMaxAge(expiresAt: string, now = Date.now()): number {
  const remaining = Math.floor((Date.parse(expiresAt) - now) / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 0;
  }
  return Math.min(remaining, INVITATION_RETURN_MAX_AGE_SECONDS);
}

export function artifactReturnPath(id: string): string {
  return `/artifacts/${encodeURIComponent(id)}`;
}

export function authPageHref(page: "login" | "signup" | "forgot-password", next: string): string {
  const safe = safeNextPath(next);
  if (safe === "/") {
    return `/${page}`;
  }
  return `/${page}?next=${encodeURIComponent(safe)}`;
}

export function readInvitationReturn(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const prefix = `${INVITE_RETURN_COOKIE}=`;
  const raw = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  if (!raw) {
    return null;
  }
  return invitationReturnPath(decodeCookie(raw.slice(prefix.length)));
}

export function rememberInvitationReturn(value: string | null | undefined, maxAgeSeconds = INVITE_RETURN_REFRESH_SECONDS): void {
  const path = invitationReturnPath(value);
  if (!path || typeof document === "undefined") {
    return;
  }
  const maxAge = Math.floor(maxAgeSeconds);
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    return;
  }
  const capped = Math.min(maxAge, INVITATION_RETURN_MAX_AGE_SECONDS);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${INVITE_RETURN_COOKIE}=${encodeURIComponent(path)}; Path=/; Max-Age=${capped}; SameSite=Lax${secure}`;
}

export function forgetInvitationReturn(): void {
  if (typeof document === "undefined") {
    return;
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${INVITE_RETURN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
