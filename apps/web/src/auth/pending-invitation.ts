import { invitationReturnPath } from "@factrove/contracts";
import { createRequestClient } from "@/api/server-client";
import { INVITE_RETURN_COOKIE } from "@/auth/return-path";

type CookieJar = {
  get: (name: string) => { value: string } | undefined;
  delete?: (name: string) => void;
  set?: (name: string, value: string, options: { path: string; maxAge: number }) => void;
};

export async function pendingInvitationPath(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const raw = jar.get(INVITE_RETURN_COOKIE)?.value;
    if (!raw) {
      return null;
    }
    const path = invitationReturnPath(decodeCookie(raw));
    const token = path ? invitationToken(path) : null;
    if (!path || !token) {
      clearInviteCookie(jar);
      return null;
    }
    try {
      await (await createRequestClient()).previewInvitation(token);
    } catch {
      clearInviteCookie(jar);
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

function invitationToken(path: string): string | null {
  try {
    const token = new URL(path, "http://return.invalid").searchParams.get("token")?.trim() ?? "";
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function clearInviteCookie(jar: CookieJar): void {
  try {
    if (jar.delete) {
      jar.delete(INVITE_RETURN_COOKIE);
      return;
    }
    jar.set?.(INVITE_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
  } catch {
    // A Server Component cannot always write cookies. Skipping the redirect is enough.
  }
}

function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
