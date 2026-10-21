import { describe, expect, it } from "vitest";
import { artifactNameFromFilename, artifactNameValueSchema, normalizeArtifactName } from "@factrove/contracts";
import { decodeMultipartFilename, multipartFilenameParameter } from "../src/rendering/html-policy.js";

describe("artifact names", () => {
  it("trims, normalizes, and keeps a name of 120 characters", () => {
    expect(normalizeArtifactName("  X launch calendar  ")).toBe("X launch calendar");
    expect(normalizeArtifactName("e\u0301")).toBe("\u00e9");
    expect(normalizeArtifactName("a".repeat(120))).toBe("a".repeat(120));
    const emoji = "👍".repeat(120);
    expect(normalizeArtifactName(emoji)).toBe(emoji);
    expect(artifactNameValueSchema().parse(emoji)).toBe(emoji);
    expect(artifactNameValueSchema().safeParse("👍".repeat(121)).success).toBe(false);
  });

  it("rejects an empty name, a broken line, and a name past 120 characters", () => {
    expect(normalizeArtifactName("   ")).toBeNull();
    expect(normalizeArtifactName("")).toBeNull();
    expect(normalizeArtifactName("hello\nthere")).toBeNull();
    expect(normalizeArtifactName("hello\n")).toBeNull();
    expect(normalizeArtifactName("hello\u2028")).toBeNull();
    expect(normalizeArtifactName("hello\u0000")).toBeNull();
    expect(normalizeArtifactName("hel\u2028lo")).toBeNull();
    expect(normalizeArtifactName("hel\u2029lo")).toBeNull();
    expect(normalizeArtifactName("hel\u007Flo")).toBeNull();
    expect(normalizeArtifactName("hel\u0085lo")).toBeNull();
    expect(normalizeArtifactName("hello\u009F")).toBeNull();
    expect(normalizeArtifactName("n".repeat(121))).toBeNull();
  });

  it("derives a library name from the file name", () => {
    expect(artifactNameFromFilename("notes/hello.HTML")).toBe("hello");
    expect(artifactNameFromFilename("my report.htm")).toBe("my report");
    expect(artifactNameFromFilename(".html")).toBeNull();
    expect(artifactNameFromFilename(`${"b".repeat(121)}.html`)).toBeNull();
    expect(artifactNameFromFilename(`${"c".repeat(120)}.htm`)).toBe("c".repeat(120));
  });

  it("re-decodes a plain filename and keeps a filename* value", () => {
    const mojibake = "caf\u00C3\u00A9.html";
    expect(decodeMultipartFilename(mojibake, "filename")).toBe("caf\u00E9.html");
    expect(decodeMultipartFilename(mojibake, "extended")).toBe(mojibake);
    const boundary = "----factrove";
    const contentType = `multipart/form-data; boundary=${boundary}`;
    const extended = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename*=UTF-8''caf%C3%83%C2%A9.html\r\n\r\n`,
      "utf8",
    );
    const plain = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="caf\u00C3\u00A9.html"\r\n\r\n`,
      "latin1",
    );
    const both = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cafe.html"; filename*=UTF-8''caf%C3%83%C2%A9.html\r\n\r\n`,
      "utf8",
    );
    expect(multipartFilenameParameter(extended, contentType)).toBe("extended");
    expect(multipartFilenameParameter(plain, contentType)).toBe("filename");
    expect(multipartFilenameParameter(both, contentType)).toBe("extended");
  });
});
