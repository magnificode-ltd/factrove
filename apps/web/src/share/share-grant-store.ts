// Unlock grants live in this tab's sessionStorage on the web origin. The artifact iframe is a
// sandboxed document on the API origin, so it cannot read them, and they never enter a URL or cookie.
const PREFIX = "factrove:share-grant:";

type StoredGrant = { token: string; grant: string; expiresAt: string };

export function readShareGrant(id: string, token: string, now = Date.now()): string | null {
  const storage = sessionStore();
  if (!storage) {
    return null;
  }
  let stored: StoredGrant | null = null;
  try {
    stored = JSON.parse(storage.getItem(PREFIX + id) ?? "null") as StoredGrant | null;
  } catch {
    stored = null;
  }
  if (
    !stored ||
    typeof stored.grant !== "string" ||
    stored.token !== token ||
    !(Date.parse(stored.expiresAt) > now)
  ) {
    if (stored) {
      storage.removeItem(PREFIX + id);
    }
    return null;
  }
  return stored.grant;
}

export function saveShareGrant(id: string, token: string, grant: { token: string; expiresAt: string }): void {
  const value: StoredGrant = { token, grant: grant.token, expiresAt: grant.expiresAt };
  try {
    sessionStore()?.setItem(PREFIX + id, JSON.stringify(value));
  } catch {
    // Storage can be full or disabled. The visitor unlocks again after a reload.
  }
}

export function clearShareGrant(id: string): void {
  sessionStore()?.removeItem(PREFIX + id);
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
