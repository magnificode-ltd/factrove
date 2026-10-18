import { describe, expect, it } from "vitest";
import { contentGrantAllows, grantedContentUrl, mintContentGrant } from "../src/auth/content-grant.js";

const secret = "factrove-test-auth-secret-32chars-min";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";

describe("content grants", () => {
  it("accepts a grant for the same artifact inside its window", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 30);
    const token = mintContentGrant(artifactId, secret, now);
    expect(contentGrantAllows(token, artifactId, secret, now + 60_000)).toBe(true);
    expect(mintContentGrant(artifactId, secret, now + 60_000)).toBe(token);
  });

  it("rejects another artifact, a bad signature, and an expired grant", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0, 0);
    const token = mintContentGrant(artifactId, secret, now);
    expect(contentGrantAllows(token, "123e4567-e89b-42d3-a456-426614174001", secret, now)).toBe(false);
    expect(contentGrantAllows(`${token}x`, artifactId, secret, now)).toBe(false);
    expect(contentGrantAllows(token, artifactId, secret, now + 13 * 60 * 60 * 1000)).toBe(false);
    const url = new URL(grantedContentUrl("http://localhost:3001", artifactId, secret, now));
    expect(url.pathname).toBe(`/api/v1/artifacts/${artifactId}/content`);
    expect(url.searchParams.get("access")).toBe(token);
  });
});
