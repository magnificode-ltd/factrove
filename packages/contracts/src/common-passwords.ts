import { COMMON_SHARE_PASSWORD_LIST } from "./common-password-list.js";

const COMMON_SHARE_PASSWORDS = new Set(COMMON_SHARE_PASSWORD_LIST);

export function isCommonSharePassword(password: string): boolean {
  return COMMON_SHARE_PASSWORDS.has(password.normalize("NFC").toLowerCase());
}

export function uniqueSharePasswordCharacters(password: string): number {
  return new Set([...password.normalize("NFC")]).size;
}

export function isAllWhitespaceSharePassword(password: string): boolean {
  return password.normalize("NFC").trim().length === 0;
}
