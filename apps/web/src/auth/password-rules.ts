import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  isCommonSharePassword
} from "@factrove/contracts";

export const ACCOUNT_PASSWORD_HINT = `${AUTH_PASSWORD_MIN_LENGTH} to ${AUTH_PASSWORD_MAX_LENGTH} characters. Avoid common passwords.`;

export function accountPasswordError(password: string): string | null {
  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    return `Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > AUTH_PASSWORD_MAX_LENGTH) {
    return `Use at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (isCommonSharePassword(password)) {
    return "Choose a less common password.";
  }
  return null;
}
