import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserApiUrl,
  DEFAULT_SOURCE_CODE_URL,
  publicConfigScript,
  readPublicApiOrigin,
  readSourceCodeUrl,
  serverApiUrl,
  sourceCodeUrl,
} from "../src/public-config";

const keys = ["BROWSER_API_URL", "INTERNAL_API_URL", "NEXT_PUBLIC_API_URL", "SOURCE_CODE_URL"] as const;

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
