import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/rendering/html-policy.js";
import { browserOrigins } from "../src/sharing/public-origin.js";
import { PublicViewLimiter } from "../src/sharing/public-view-limit.js";
import {
  artifactShareUrl,
  artifactViewerUrl,
  createShareToken,
  hashShareToken,
  isShareToken,
  publicContentUrl,
} from "../src/sharing/share-link.js";

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
    now += 60_001;
    expect(limiter.allow("203.0.113.5")).toBe(true);
    expect(limiter.allow(null)).toBe(true);
  });
});
