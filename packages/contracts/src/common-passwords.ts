import { readFileSync } from "node:fs";

const COMMON_SHARE_PASSWORDS = new Set(
  readFileSync(new URL("./common-passwords.txt", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.length > 0),
);

export function isCommonSharePassword(password: string): boolean {
  return COMMON_SHARE_PASSWORDS.has(password.normalize("NFC").toLowerCase());
}

export function uniqueSharePasswordCharacters(password: string): number {
  return new Set([...password.normalize("NFC")]).size;
}

export function isAllWhitespaceSharePassword(password: string): boolean {
  return password.normalize("NFC").trim().length === 0;
}
