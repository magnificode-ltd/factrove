import { invitationReturnPath } from "@factrove/contracts";
import { INVITE_RETURN_COOKIE } from "@/auth/return-path";

export async function pendingInvitationPath(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const jar = await cookies();
    const raw = jar.get(INVITE_RETURN_COOKIE)?.value;
    if (!raw) {
      return null;
    }
    return invitationReturnPath(decodeCookie(raw));
  } catch {
    return null;
  }
}

function decodeCookie(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
