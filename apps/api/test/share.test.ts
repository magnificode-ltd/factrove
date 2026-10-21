import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/rendering/html-policy.js";
import { assignClientIpForPublicPath, isPublicApiPath } from "../src/sharing/public-api-path.js";
import { browserOrigins } from "../src/sharing/public-origin.js";
import { PublicViewLimiter, rateLimitKey } from "../src/sharing/public-view-limit.js";
import {
  artifactShareUrl,
  artifactViewerUrl,
  createShareToken,
  hashShareToken,
  isShareToken,
  publicContentUrl,
} from "../src/sharing/share-link.js";
import { decryptShareToken, deriveShareTokenKey, encryptShareToken } from "../src/sharing/share-token-cipher.js";

describe("public base URL links", () => {
  it("uses localhost or a domain plus the artifact id, and a separate token", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(artifactViewerUrl("http://localhost:3000", id)).toBe(`http://localhost:3000/artifacts/${id}`);
    expect(artifactViewerUrl("https://factrove.app", id)).toBe(`https://factrove.app/artifacts/${id}`);
    const token = createShareToken();
    expect(isShareToken(token)).toBe(true);
    expect(token).not.toBe(id);
    expect(artifactShareUrl("https://factrove.app", id, token)).toBe(`https://factrove.app/share/${id}/${token}`);
    expect(artifactShareUrl("http://localhost:3000", id, token)).toBe(`http://localhost:3000/share/${id}/${token}`);
    expect(publicContentUrl("http://localhost:3001", id, token)).toBe(
      `http://localhost:3001/api/v1/public/artifacts/${id}/${token}/content`,
    );
    expect(hashShareToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashShareToken(token)).not.toBe(token);
    expect(isShareToken(id)).toBe(false);
    expect(isShareToken(`${token}x`)).toBe(false);
  });

  it("frames both the public origin and the owner app when they differ", () => {
    expect(browserOrigins("http://localhost:3000", "http://localhost:3000")).toEqual(["http://localhost:3000"]);
    expect(browserOrigins("http://localhost:3000", "https://factrove.app")).toEqual([
      "https://factrove.app",
      "http://localhost:3000",
    ]);
    const policy = contentSecurityPolicy(browserOrigins("http://localhost:3000", "https://factrove.app"));
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).not.toContain("allow-same-origin");
    expect(policy).toContain("frame-ancestors https://factrove.app http://localhost:3000");
    expect(policy).not.toContain("*");
  });
});

describe("share token encryption", () => {
  it("stores ciphertext bound to the artifact id and decrypts with the same key", () => {
    const token = createShareToken();
    const artifactId = "123e4567-e89b-42d3-a456-426614174000";
    const key = deriveShareTokenKey("local-only-factrove-auth-secret-change-me");
    const stored = encryptShareToken(token, key, artifactId);
    expect(stored).not.toBe(token);
    expect(stored).not.toContain(token);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(decryptShareToken(stored, key, artifactId)).toBe(token);
    expect(hashShareToken(decryptShareToken(stored, key, artifactId) ?? "")).toBe(hashShareToken(token));
    expect(decryptShareToken(stored, key, "123e4567-e89b-42d3-a456-426614174001")).toBeNull();
    expect(decryptShareToken(stored, deriveShareTokenKey("another-share-token-key-value-here"), artifactId)).toBeNull();
    expect(hashShareToken(token)).not.toBe(stored);
  });
});

describe("public view limiter", () => {
  it("buckets by client IP and shares one bucket when the address is missing", () => {
    let now = 1_000_000;
    const limiter = new PublicViewLimiter(2, 60_000, () => now);
    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow("203.0.113.5")).toBe(false);
    expect(limiter.allow("203.0.113.6")).toBe(true);
    expect(limiter.allow(null)).toBe(true);
    expect(limiter.allow("")).toBe(true);
    expect(limiter.allow(null)).toBe(false);
    expect(limiter.size).toBe(3);
    now += 60_001;
    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow(null)).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it("keys an IPv6 client by its /64 and admits a new visitor when the map is full", () => {
    let now = 5_000;
    const limiter = new PublicViewLimiter(1, 1_000, () => now, 3);
    expect(rateLimitKey("2001:db8:1:2::1")).toBe(rateLimitKey("2001:DB8:1:2:ffff::abcd"));
    expect(rateLimitKey("2001:db8:1:2::1")).not.toBe(rateLimitKey("2001:db8:1:3::1"));
    expect(limiter.allow("2001:db8:1:2::1")).toBe(true);
    expect(limiter.allow("2001:db8:1:2:ffff::abcd")).toBe(false);
    expect(limiter.allow("2001:db8:1:3::1")).toBe(true);
    expect(limiter.allow("203.0.113.9")).toBe(true);
    expect(limiter.size).toBe(3);
    expect(limiter.allow("203.0.113.10")).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(3);
    expect(limiter.allow("203.0.113.9")).toBe(false);
    now += 1_001;
    expect(limiter.allow("198.51.100.8")).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("includes two content loads in the view that charged the visitor", () => {
    let now = 10_000;
    const limiter = new PublicViewLimiter(1, 60_000, () => now);
    expect(limiter.allowContent("203.0.113.9")).toBe(true);
    expect(limiter.allowContent("203.0.113.9")).toBe(false);
    expect(limiter.allow("203.0.113.7")).toBe(true);
    expect(limiter.allowContent("203.0.113.7")).toBe(true);
    expect(limiter.allowContent("203.0.113.7")).toBe(true);
    expect(limiter.allowContent("203.0.113.7")).toBe(false);
    expect(limiter.allow("203.0.113.8")).toBe(true);
    now += 30_001;
    expect(limiter.allowContent("203.0.113.8")).toBe(false);
  });
});

describe("public API paths", () => {
  it("treats a mixed-case public path as public and replaces a spoofed client address", () => {
    expect(isPublicApiPath("/API/V1/PUBLIC/artifacts/not-an-id")).toBe(true);
    expect(isPublicApiPath("/Api/v1/public/artifacts/x/token?x=1")).toBe(true);
    expect(isPublicApiPath("/api/v1/publicity")).toBe(false);
    const request = {
      url: "/API/V1/PUBLIC/artifacts/00000000-0000-4000-8000-000000000000/token",
      headers: { "x-factrove-client-ip": "203.0.113.50" },
      socket: { remoteAddress: "192.0.2.10" },
    } as IncomingMessage;
    assignClientIpForPublicPath(request, []);
    expect(request.headers["x-factrove-client-ip"]).toBe("192.0.2.10");
    const privatePath = {
      url: "/api/v1/artifacts/00000000-0000-4000-8000-000000000000",
      headers: { "x-factrove-client-ip": "203.0.113.50" },
      socket: { remoteAddress: "192.0.2.10" },
    } as IncomingMessage;
    assignClientIpForPublicPath(privatePath, []);
    expect(privatePath.headers["x-factrove-client-ip"]).toBe("203.0.113.50");
  });
});
