/**
 * @vitest-environment happy-dom
 */
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capturePageview, resetAnalyticsForTests, startAnalytics } from "../src/analytics";

const ARTIFACT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABC";
const PROJECT_KEY = "phc_testkey123";
const PAGE_TITLE = "Quarterly plan";
const RESET_TOKEN = "header.payload.sig";

type CapturedRequest = { url: string; body: string };
type CapturedEvent = { event?: string; properties?: Record<string, unknown> };

afterEach(() => {
  resetAnalyticsForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("analytics transport", () => {
  it("sends a sanitized pageview with the project key and does not call flags or decide", async () => {
    const requests: CapturedRequest[] = [];
    installTransport(requests);
    const pagePath = `/share/${ARTIFACT_ID}/${SHARE_TOKEN}`;
    window.history.replaceState({}, "", `${pagePath}?password=hunter2&token=${RESET_TOKEN}`);
    window.location.hash = "inbox";
    document.title = PAGE_TITLE;

    const client = await startAnalytics({ key: PROJECT_KEY, host: "https://posthog.example.com" });
    expect(client).toBeDefined();
    capturePageview(client!, pagePath, "https://library.example.com");
    await vi.waitFor(
      () => {
        expect(requests.some((request) => request.body.includes('"$pageview"'))).toBe(true);
      },
      { timeout: 4000, interval: 50 },
    );

    expect(requests.some((request) => /\/flags(?:\/|\?|$)/.test(request.url) || /\/decide(?:\/|\?|$)/.test(request.url))).toBe(
      false,
    );
    const pageview = requests.flatMap((request) => eventsFrom(request.body)).find((event) => event.event === "$pageview");
    expect(pageview?.properties?.token).toBe(PROJECT_KEY);
    expect(pageview?.properties?.$current_url).toBe("https://library.example.com/share/:id/:id");
    expect(pageview?.properties?.$pathname).toBe("/share/:id/:id");
    expect(pageview?.properties).not.toHaveProperty("title");
    expect(pageview?.properties).not.toHaveProperty("$title");
    const payload = JSON.stringify(pageview);
    expect(payload).not.toContain(ARTIFACT_ID);
    expect(payload).not.toContain(SHARE_TOKEN);
    expect(payload).not.toContain(RESET_TOKEN);
    expect(payload).not.toContain("hunter2");
    expect(payload).not.toContain(PAGE_TITLE);
  });
});

function installTransport(requests: CapturedRequest[]): void {
  const record = (url: string, body: unknown) => {
    requests.push({ url, body: decodeBody(body) });
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = input instanceof Request && init?.body == null ? input.body : init?.body;
    record(url, body);
    return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  });
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = 200;
      responseText = "{}";
      readyState = 0;
      timeout = 0;
      onloadend: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      private url = "";
      open(_method: string, url: string) {
        this.url = url;
      }
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      send(body?: unknown) {
        record(this.url, body);
        this.readyState = 4;
        this.onloadend?.();
      }
    },
  );
  vi.stubGlobal("navigator", {
    ...window.navigator,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    sendBeacon: () => false,
    doNotTrack: null,
  });
}

function eventsFrom(body: string): CapturedEvent[] {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  if ("batch" in parsed && Array.isArray(parsed.batch)) {
    return parsed.batch.filter(isCapturedEvent);
  }
  return isCapturedEvent(parsed) ? [parsed] : [];
}

function isCapturedEvent(value: unknown): value is CapturedEvent {
  return typeof value === "object" && value !== null;
}

function decodeBody(body: unknown): string {
  if (body == null) {
    return "";
  }
  if (typeof body === "string") {
    return unwrapEncoded(body);
  }
  if (body instanceof URLSearchParams) {
    return unwrapEncoded(body.toString());
  }
  if (body instanceof ArrayBuffer) {
    return unwrapEncoded(decodeBytes(new Uint8Array(body)));
  }
  if (ArrayBuffer.isView(body)) {
    return unwrapEncoded(decodeBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength)));
  }
  return "";
}

function decodeBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return gunzipSync(bytes).toString("utf8");
  }
  return new TextDecoder().decode(bytes);
}

function unwrapEncoded(value: string): string {
  const data = value.startsWith("data=") ? safeDecodeURIComponent(value.slice("data=".length)) : value;
  return decodeBase64(data) ?? data;
}

function decodeBase64(value: string): string | undefined {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || value.length < 16) {
    return undefined;
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return decoded.includes("{") ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
