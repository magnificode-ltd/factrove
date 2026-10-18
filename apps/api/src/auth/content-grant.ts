import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_SECONDS = 300;
const TTL_SECONDS = 12 * 60 * 60;

export function mintContentGrant(artifactId: string, secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS + TTL_SECONDS;
  const payload = `${artifactId}.${exp}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
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
  const expected = createHmac("sha256", secret).update(`${artifactId}.${exp}`).digest("base64url");
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

export function grantedContentUrl(origin: string, artifactId: string, secret: string, nowMs = Date.now()): string {
  const token = mintContentGrant(artifactId, secret, nowMs);
  return `${origin}/api/v1/artifacts/${artifactId}/content?access=${encodeURIComponent(token)}`;
}
