import { describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import { artifactIdFromKey, factroveUri, parseFactroveUri } from "../src/uri.js";

const id = "123e4567-e89b-42d3-a456-426614174000";

describe("factrove URIs", () => {
  it("parses scopes and id keys", () => {
    expect(parseFactroveUri("factrove://mine")).toEqual({ scope: "mine", key: undefined });
    expect(parseFactroveUri("factrove://mine/")).toEqual({ scope: "mine", key: undefined });
    expect(parseFactroveUri("FACTROVE://ORG/")).toEqual({ scope: "org", key: undefined });
    expect(parseFactroveUri(`factrove://mine/${id}`)).toEqual({ scope: "mine", key: id });
    expect(parseFactroveUri(`factrove://org/${id}.html`)).toEqual({ scope: "org", key: `${id}.html` });
    expect(artifactIdFromKey(id)).toBe(id);
    expect(artifactIdFromKey(`${id}.HTML`)).toBe(id);
    expect(artifactIdFromKey("report.html")).toBeUndefined();
    expect(factroveUri("mine", id)).toBe(`factrove://mine/${id}`);
    expect(factroveUri("org")).toBe("factrove://org/");
  });

  it("rejects s3 URIs, queries, and nested keys", () => {
    expect(failure("s3://mine/a.html")).toMatch(/factrove:\/\//);
    expect(failure("factrove://bucket/a.html")).toMatch(/mine or org/);
    expect(failure("factrove://mine/a/b.html")).toMatch(/cannot contain/);
    expect(failure("factrove://mine/a.html?x=1")).toMatch(/query or hash/);
    expect(failure("factrove://user@mine/a.html")).toMatch(/username/);
    expect(failure("factrove://mine/%")).toMatch(/percent-encoding/);
    expect(failure("factrove://mine/prefix/")).toMatch(/cannot end with/);
    expect(failure(`factrove://mine/${id}/`)).toMatch(/cannot end with/);
    expect(failure("factrove://mine/report.html/")).toMatch(/cannot end with/);
  });
});

function failure(value: string): string {
  try {
    parseFactroveUri(value);
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return (error as CliError).message;
  }
  throw new Error("expected the URI to be rejected");
}
