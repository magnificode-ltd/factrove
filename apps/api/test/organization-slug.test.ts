import { describe, expect, it } from "vitest";
import { normalizeOrganizationName } from "@factrove/contracts";
import { organizationSlugCandidates } from "../src/auth/organization-slug.js";

describe("organization names and slugs", () => {
  it("trims a name and rejects control characters and an empty name", () => {
    expect(normalizeOrganizationName("  Ada Lab  ")).toBe("Ada Lab");
    expect(normalizeOrganizationName("a".repeat(80))).toHaveLength(80);
    expect(normalizeOrganizationName(` ${"a".repeat(81)}`)).toBeNull();
    expect(normalizeOrganizationName("   ")).toBeNull();
    expect(normalizeOrganizationName("Ada\nLab")).toBeNull();
  });

  it("builds a unique server slug and skips reserved words", () => {
    expect(organizationSlugCandidates("Ada Lab", () => "abc123")).toEqual([
      "ada-lab",
      "ada-lab-2",
      "ada-lab-3",
      "ada-lab-4",
      "ada-lab-5",
      "ada-lab-6",
      "ada-lab-7",
      "ada-lab-8",
      "org-abc123",
    ]);
    expect(organizationSlugCandidates("Local", () => "abc123")[0]).toBe("local-2");
    expect(organizationSlugCandidates("!!!", () => "abc123")[0]).toBe("org-2");
    expect(organizationSlugCandidates("Árvíz", () => "abc123")[0]).toBe("arviz");
  });

  it("keeps a numeric suffix when the stem is already at the length cap", () => {
    const stem47 = "b".repeat(47);
    const stem48 = "c".repeat(48);
    const from47 = organizationSlugCandidates(stem47, () => "abc123");
    const from48 = organizationSlugCandidates(stem48, () => "abc123");
    expect(from47[0]).toBe(stem47);
    expect(from48[0]).toBe(stem48);
    expect(from47[1]).toBe(`${"b".repeat(46)}-2`);
    expect(from48[1]).toBe(`${"c".repeat(46)}-2`);
    expect(from47[1]).not.toBe(from47[0]);
    expect(from48[1]).not.toBe(from48[0]);
    for (const slug of [...from47, ...from48]) {
      expect(slug.length).toBeLessThanOrEqual(48);
    }
  });
});
