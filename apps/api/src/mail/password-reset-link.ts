import { invitationReturnPath } from "@factrove/contracts";

// Better Auth's default reset token lifetime. The email copy uses the label.
export const PASSWORD_RESET_EXPIRES_IN_SECONDS = 60 * 60;
export const PASSWORD_RESET_EXPIRES_LABEL = "one hour";

// Better Auth already limits this path to 3 requests per 60 seconds. The same
// numbers are set on createAuth so a later global change does not loosen it.
export const PASSWORD_RESET_REQUEST_WINDOW_SECONDS = 60;
export const PASSWORD_RESET_REQUEST_MAX = 3;
export const PASSWORD_RESET_SUBMIT_WINDOW_SECONDS = 60;
export const PASSWORD_RESET_SUBMIT_MAX = 10;

// Same default lifetime as a reset token. Sign-in does not wait for it.
export const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
export const EMAIL_VERIFICATION_EXPIRES_LABEL = "one hour";
export const EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS = 60;
export const EMAIL_VERIFICATION_REQUEST_MAX = 3;

const TOKEN_MAX_LENGTH = 4096;

export function passwordResetUrl(webOrigin: string, token: string): string | null {
  return actionUrl(webOrigin, "/reset-password", token);
}

export function emailVerificationUrl(webOrigin: string, token: string, returnPath?: string | null): string | null {
  const url = actionUrl(webOrigin, "/verify-email", token);
  if (url === null) {
    return null;
  }
  const next = invitationReturnPath(returnPath);
  if (next === null) {
    return url;
  }
  const parsed = new URL(url);
  parsed.searchParams.set("next", next);
  return parsed.toString();
}

// Better Auth puts the signup callbackURL on its own verify URL. This reads
// that value and keeps only a same-origin invitation path.
export function invitationCallbackPath(authUrl: string | null | undefined): string | null {
  if (!authUrl) {
    return null;
  }
  try {
    return invitationReturnPath(new URL(authUrl).searchParams.get("callbackURL"));
  } catch {
    return null;
  }
}

function actionUrl(webOrigin: string, pathname: string, token: string): string | null {
  if (!isResetToken(token)) {
    return null;
  }
  let origin: URL;
  try {
    origin = new URL(webOrigin);
  } catch {
    return null;
  }
  const url = new URL(pathname, origin.origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function isResetToken(token: string): boolean {
  if (token.length === 0 || token.length > TOKEN_MAX_LENGTH) {
    return false;
  }
  return !/[\u0000-\u0020\u007f"'<>\\]/.test(token);
}
