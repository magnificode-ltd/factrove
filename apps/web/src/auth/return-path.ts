import { invitationReturnPath, safeNextPath } from "@factrove/contracts";

export { invitationReturnPath, safeNextPath } from "@factrove/contracts";

export const INVITE_RETURN_COOKIE = "factrove-invite-next";

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

export function rememberInvitationReturn(value: string | null | undefined): void {
  const path = invitationReturnPath(value);
  if (!path || typeof document === "undefined") {
    return;
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${INVITE_RETURN_COOKIE}=${encodeURIComponent(path)}; Path=/; SameSite=Lax${secure}`;
}

function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
