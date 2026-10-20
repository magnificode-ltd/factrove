import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_SECONDS = 60;
export const CONTENT_GRANT_TTL_SECONDS = 5 * 60;
const GRANT_DOMAIN = "factrove:content-grant:v1";

export function mintContentGrant(artifactId: string, secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS + CONTENT_GRANT_TTL_SECONDS;
  const signature = signGrant(artifactId, exp, secret);
  return `${exp.toString(36)}.${signature}`;
}

export function contentGrantAllows(token: string, artifactId: string, secret: string, nowMs = Date.now()): boolean {
  const separator = token.indexOf(".");
  if (separator <= 0 || separator !== token.lastIndexOf(".")) {
    return false;
  }
  const exp = Number.parseInt(token.slice(0, separator), 36);
  if (!Number.isSafeInteger(exp)) {
    return false;
  }
  const given = token.slice(separator + 1);
  const expected = signGrant(artifactId, exp, secret);
  const expectedBytes = Buffer.from(expected);
  const givenBytes = Buffer.from(given);
  if (expectedBytes.length === 0 || expectedBytes.length !== givenBytes.length) {
    return false;
  }
  if (!timingSafeEqual(expectedBytes, givenBytes)) {
    return false;
  }
  return exp > Math.floor(nowMs / 1000);
}

export function artifactContentUrl(origin: string, artifactId: string): string {
  return `${origin}/api/v1/artifacts/${artifactId}/content`;
}

export function grantedContentUrl(origin: string, artifactId: string, secret: string, nowMs = Date.now()): string {
  const token = mintContentGrant(artifactId, secret, nowMs);
  return `${artifactContentUrl(origin, artifactId)}?access=${encodeURIComponent(token)}`;
}

function signGrant(artifactId: string, exp: number, secret: string): string {
  const payload = `${artifactId}.${exp}`;
  return createHmac("sha256", grantKey(secret)).update(payload).digest("base64url");
}

function grantKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(GRANT_DOMAIN).digest();
}
