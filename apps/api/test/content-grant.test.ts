import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONTENT_GRANT_TTL_SECONDS, contentGrantAllows, grantedContentUrl, mintContentGrant } from "../src/auth/content-grant.js";

const secret = "factrove-test-auth-secret-32chars-min";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";

describe("content grants", () => {
  it("accepts a grant for the same artifact inside its window", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 30);
    const token = mintContentGrant(artifactId, secret, now);
    expect(contentGrantAllows(token, artifactId, secret, now + 20_000)).toBe(true);
    expect(mintContentGrant(artifactId, secret, now + 20_000)).toBe(token);
    expect(CONTENT_GRANT_TTL_SECONDS).toBe(5 * 60);
  });

  it("rejects another artifact, a raw-secret signature, and an expired grant", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    const token = mintContentGrant(artifactId, secret, now);
    expect(contentGrantAllows(token, "123e4567-e89b-42d3-a456-426614174001", secret, now)).toBe(false);
    expect(contentGrantAllows(`${token}x`, artifactId, secret, now)).toBe(false);
    expect(contentGrantAllows(token, artifactId, secret, now + (CONTENT_GRANT_TTL_SECONDS + 60) * 1000)).toBe(false);
    const exp = Number.parseInt(token.slice(0, token.indexOf(".")), 36);
    const raw = createHmac("sha256", secret).update(`${artifactId}.${exp}`).digest("base64url");
    expect(contentGrantAllows(`${exp.toString(36)}.${raw}`, artifactId, secret, now)).toBe(false);
    const url = new URL(grantedContentUrl("http://localhost:3001", artifactId, secret, now));
    expect(url.pathname).toBe(`/api/v1/artifacts/${artifactId}/content`);
    expect(url.searchParams.get("access")).toBe(token);
  });

  it("rejects a grant whose expiry is further ahead than the ttl and skew", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    const nowSeconds = Math.floor(now / 1000);
    const skew = 60;
    expect(contentGrantAllows(signedGrant(nowSeconds + CONTENT_GRANT_TTL_SECONDS + skew), artifactId, secret, now)).toBe(true);
    expect(contentGrantAllows(signedGrant(nowSeconds + CONTENT_GRANT_TTL_SECONDS + skew + 1), artifactId, secret, now)).toBe(false);
    expect(contentGrantAllows(signedGrant(nowSeconds + 24 * 60 * 60), artifactId, secret, now)).toBe(false);
  });
});

function signedGrant(exp: number): string {
  const key = createHmac("sha256", secret).update("factrove:content-grant:v1").digest();
  const signature = createHmac("sha256", key).update(`${artifactId}.${exp}`).digest("base64url");
  return `${exp.toString(36)}.${signature}`;
}
