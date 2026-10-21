import { describe, expect, it } from "vitest";
import { artifactNameFromFilename, normalizeArtifactName } from "@factrove/contracts";

describe("artifact names", () => {
  it("trims, normalizes, and keeps a name of 120 characters", () => {
    expect(normalizeArtifactName("  X launch calendar  ")).toBe("X launch calendar");
    expect(normalizeArtifactName("e\u0301")).toBe("\u00e9");
    expect(normalizeArtifactName("a".repeat(120))).toBe("a".repeat(120));
    expect(normalizeArtifactName("👍".repeat(120))).toBe("👍".repeat(120));
  });

  it("rejects an empty name, a broken line, and a name past 120 characters", () => {
    expect(normalizeArtifactName("   ")).toBeNull();
    expect(normalizeArtifactName("")).toBeNull();
    expect(normalizeArtifactName("hello\nthere")).toBeNull();
    expect(normalizeArtifactName("hello\u0000")).toBeNull();
    expect(normalizeArtifactName("hel\u2028lo")).toBeNull();
    expect(normalizeArtifactName("hel\u2029lo")).toBeNull();
    expect(normalizeArtifactName("hel\u007Flo")).toBeNull();
    expect(normalizeArtifactName("n".repeat(121))).toBeNull();
  });

  it("derives a library name from the file name", () => {
    expect(artifactNameFromFilename("notes/hello.HTML")).toBe("hello");
    expect(artifactNameFromFilename("my report.htm")).toBe("my report");
    expect(artifactNameFromFilename(".html")).toBeNull();
    expect(artifactNameFromFilename(`${"b".repeat(121)}.html`)).toBeNull();
    expect(artifactNameFromFilename(`${"c".repeat(120)}.htm`)).toBe("c".repeat(120));
  });
});
