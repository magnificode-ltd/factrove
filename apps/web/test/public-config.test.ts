import { afterEach, describe, expect, it, vi } from "vitest";
import { docsUrl } from "../src/docs";
import {
  browserApiUrl,
  cliApiOrigin,
  DEFAULT_DOCS_BASE_URL,
  DEFAULT_SOURCE_CODE_URL,
  docsBaseUrl,
  publicConfigScript,
  readDocsBaseUrl,
  readPublicApiOrigin,
  readSourceCodeUrl,
  serverApiUrl,
  sourceCodeUrl,
} from "../src/public-config";

const keys = ["BROWSER_API_URL", "INTERNAL_API_URL", "NEXT_PUBLIC_API_URL", "SOURCE_CODE_URL", "DOCS_BASE_URL"] as const;

afterEach(() => {
  for (const key of keys) {
    delete process.env[key];
  }
  delete (globalThis as { window?: Window }).window;
  vi.restoreAllMocks();
});

describe("public API origin", () => {
  it("accepts an absolute http(s) origin and drops a trailing slash", () => {
    expect(readPublicApiOrigin(" https://api.example.com/ ")).toBe("https://api.example.com");
    expect(readPublicApiOrigin("http://localhost:3001")).toBe("http://localhost:3001");
    expect(readPublicApiOrigin("http://api.example.com/v1")).toBeUndefined();
    expect(readPublicApiOrigin("http://user:secret@api.example.com")).toBeUndefined();
    expect(readPublicApiOrigin("ftp://api.example.com")).toBeUndefined();
    expect(readPublicApiOrigin("")).toBeUndefined();
  });

  it("uses the internal origin for server fetches and the browser origin next", () => {
    expect(serverApiUrl({ INTERNAL_API_URL: "http://api:3001/", BROWSER_API_URL: "https://api.example.com" })).toBe(
      "http://api:3001",
    );
    expect(serverApiUrl({ BROWSER_API_URL: "https://api.example.com" })).toBe("https://api.example.com");
    process.env.NEXT_PUBLIC_API_URL = "https://baked.example.com";
    expect(serverApiUrl({})).toBe("https://baked.example.com");
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(serverApiUrl({})).toBe("http://localhost:3001");
  });

  it("ignores an invalid override and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(serverApiUrl({ INTERNAL_API_URL: "http://api:3001/path", BROWSER_API_URL: "https://api.example.com" })).toBe(
      "https://api.example.com",
    );
    expect(serverApiUrl({ INTERNAL_API_URL: "not a url" })).toBe("http://localhost:3001");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("injects BROWSER_API_URL and leaves the baked origin alone when it is unset", () => {
    expect(publicConfigScript({ BROWSER_API_URL: "https://api.example.com" })).toBe(
      'window.__FACTROVE_PUBLIC__={"apiUrl":"https://api.example.com"}',
    );
    expect(publicConfigScript({})).toBe("window.__FACTROVE_PUBLIC__=window.__FACTROVE_PUBLIC__||{}");
    expect(publicConfigScript({ BROWSER_API_URL: "https://api.example.com/library" })).toBe(
      "window.__FACTROVE_PUBLIC__=window.__FACTROVE_PUBLIC__||{}",
    );
  });

  it("uses the Factrove repository unless SOURCE_CODE_URL is an absolute http(s) URL", () => {
    expect(readSourceCodeUrl(" https://github.com/example/fork ")).toBe("https://github.com/example/fork");
    expect(readSourceCodeUrl("https://git.example.com/factrove/")).toBe("https://git.example.com/factrove/");
    expect(readSourceCodeUrl("http://user:secret@git.example.com/factrove")).toBeUndefined();
    expect(readSourceCodeUrl("javascript:alert(1)")).toBeUndefined();
    expect(readSourceCodeUrl("")).toBeUndefined();
    expect(sourceCodeUrl({})).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceCodeUrl({ SOURCE_CODE_URL: "https://git.example.com/fork" })).toBe("https://git.example.com/fork");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sourceCodeUrl({ SOURCE_CODE_URL: "not a url" })).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("uses the public docs site unless DOCS_BASE_URL is an absolute http(s) URL", () => {
    expect(readDocsBaseUrl(" https://docs.example.com/factrove/ ")).toBe("https://docs.example.com/factrove");
    expect(readDocsBaseUrl("https://docs.example.com")).toBe("https://docs.example.com");
    expect(readDocsBaseUrl("http://user:secret@docs.example.com")).toBeUndefined();
    expect(readDocsBaseUrl("javascript:alert(1)")).toBeUndefined();
    expect(readDocsBaseUrl("")).toBeUndefined();
    expect(readDocsBaseUrl("   ")).toBeUndefined();
    expect(readDocsBaseUrl("https://docs.example.com/?lang=en")).toBeUndefined();
    expect(readDocsBaseUrl("https://docs.example.com/#guide")).toBeUndefined();
    expect(readDocsBaseUrl("https://docs.example.com/?")).toBeUndefined();
    expect(readDocsBaseUrl("https://docs.example.com/#")).toBeUndefined();
    expect(docsBaseUrl({})).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "" })).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "   " })).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/factrove/" })).toBe(
      "https://docs.example.com/factrove",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(docsBaseUrl({ DOCS_BASE_URL: "not a url" })).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/?lang=en" })).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/factrove#guide" })).toBe(DEFAULT_DOCS_BASE_URL);
    process.env.DOCS_BASE_URL = "https://docs.example.com/?lang=en";
    expect(docsUrl("/cli-reference/overview")).toBe(`${DEFAULT_DOCS_BASE_URL}/cli-reference/overview`);
    expect(docsUrl("/cli-reference/overview")).not.toContain("?lang=en/");
    process.env.DOCS_BASE_URL = "https://docs.example.com/#guide";
    expect(docsUrl("/cli-reference/overview")).toBe(`${DEFAULT_DOCS_BASE_URL}/cli-reference/overview`);
    expect(docsUrl("/cli-reference/overview")).not.toContain("#guide/");
    expect(docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/?" })).toBe(DEFAULT_DOCS_BASE_URL);
    expect(docsBaseUrl({ DOCS_BASE_URL: "https://docs.example.com/#" })).toBe(DEFAULT_DOCS_BASE_URL);
    process.env.DOCS_BASE_URL = "https://docs.example.com/?";
    const bareQuery = docsUrl("/cli-reference/overview");
    expect(bareQuery).toBe(`${DEFAULT_DOCS_BASE_URL}/cli-reference/overview`);
    expect(bareQuery).not.toContain("?/");
    process.env.DOCS_BASE_URL = "https://docs.example.com/#";
    const bareHash = docsUrl("/cli-reference/overview");
    expect(bareHash).toBe(`${DEFAULT_DOCS_BASE_URL}/cli-reference/overview`);
    expect(bareHash).not.toContain("#/");
    expect(warn).toHaveBeenCalledTimes(11);
  });

  it("uses the browser API origin for the CLI and skips the internal address", () => {
    expect(cliApiOrigin({ BROWSER_API_URL: "https://api.example.com/", INTERNAL_API_URL: "http://api:3001" })).toBe(
      "https://api.example.com",
    );
    process.env.NEXT_PUBLIC_API_URL = "https://baked.example.com";
    expect(cliApiOrigin({})).toBe("https://baked.example.com");
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(cliApiOrigin({})).toBe("http://localhost:3001");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cliApiOrigin({ BROWSER_API_URL: "https://api.example.com/library" })).toBe("http://localhost:3001");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("prefers the injected browser origin over the baked value", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://baked.example.com";
    expect(browserApiUrl()).toBe("https://baked.example.com");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __FACTROVE_PUBLIC__: { apiUrl: "https://api.example.com/" } },
    });
    expect(browserApiUrl()).toBe("https://api.example.com");
  });
});
