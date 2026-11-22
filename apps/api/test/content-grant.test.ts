import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONTENT_GRANT_TTL_SECONDS, contentGrantAllows, grantedContentUrl, mintContentGrant, type ContentGrantClaims } from "../src/auth/content-grant.js";

const secret = "factrove-test-auth-secret-32chars-min";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const claims: ContentGrantClaims = {
  artifactId,
  userId: "user-1",
  sessionId: "session-1",
  contentRevision: 0,
};
const issuer = { userId: claims.userId, sessionId: claims.sessionId };

describe("content grants", () => {
  it("accepts a grant for the same artifact, user, session, and revision inside its window", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 30);
    const token = mintContentGrant(claims, secret, now);
    expect(contentGrantAllows(token, artifactId, 0, secret, now + 20_000)).toEqual(issuer);
    expect(mintContentGrant(claims, secret, now + 20_000)).toBe(token);
    expect(CONTENT_GRANT_TTL_SECONDS).toBe(5 * 60);
    expect(token.startsWith("v2.")).toBe(true);
  });

  it("rejects another artifact, another revision, a raw-secret signature, and an expired grant", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    const token = mintContentGrant(claims, secret, now);
    expect(contentGrantAllows(token, "123e4567-e89b-42d3-a456-426614174001", 0, secret, now)).toBeNull();
    expect(contentGrantAllows(token, artifactId, 1, secret, now)).toBeNull();
    expect(contentGrantAllows(`${token}x`, artifactId, 0, secret, now)).toBeNull();
    expect(contentGrantAllows(token, artifactId, 0, secret, now + (CONTENT_GRANT_TTL_SECONDS + 60) * 1000)).toBeNull();
    const exp = Math.floor(now / 1000 / 60) * 60 + CONTENT_GRANT_TTL_SECONDS;
    const body = Buffer.from(JSON.stringify({
      exp,
      userId: claims.userId,
      sessionId: claims.sessionId,
      contentRevision: 0,
    }), "utf8").toString("base64url");
    const raw = createHmac("sha256", secret).update(`${artifactId}.${body}`).digest("base64url");
    expect(contentGrantAllows(`v2.${body}.${raw}`, artifactId, 0, secret, now)).toBeNull();
    const tamperedUser = Buffer.from(JSON.stringify({
      exp,
      userId: "user-2",
      sessionId: claims.sessionId,
      contentRevision: 0,
    }), "utf8").toString("base64url");
    const signature = token.split(".")[2] ?? "";
    expect(contentGrantAllows(`v2.${tamperedUser}.${signature}`, artifactId, 0, secret, now)).toBeNull();
    const url = new URL(grantedContentUrl("http://localhost:3001", claims, secret, now));
    expect(url.pathname).toBe(`/api/v1/artifacts/${artifactId}/content`);
    expect(url.searchParams.get("access")).toBe(token);
  });

  it("rejects a grant whose expiry is further ahead than the ttl and skew", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    const nowSeconds = Math.floor(now / 1000);
    const skew = 60;
    expect(contentGrantAllows(signedGrant(nowSeconds + CONTENT_GRANT_TTL_SECONDS + skew), artifactId, 0, secret, now)).toEqual(issuer);
    expect(contentGrantAllows(signedGrant(nowSeconds + CONTENT_GRANT_TTL_SECONDS + skew + 1), artifactId, 0, secret, now)).toBeNull();
    expect(contentGrantAllows(signedGrant(nowSeconds + 24 * 60 * 60), artifactId, 0, secret, now)).toBeNull();
  });
});

function signedGrant(exp: number): string {
  const body = Buffer.from(JSON.stringify({
    exp,
    userId: claims.userId,
    sessionId: claims.sessionId,
    contentRevision: 0,
  }), "utf8").toString("base64url");
  const key = createHmac("sha256", secret).update("factrove:content-grant:v2").digest();
  const signature = createHmac("sha256", key).update(`${artifactId}.${body}`).digest("base64url");
  return `v2.${body}.${signature}`;
}
