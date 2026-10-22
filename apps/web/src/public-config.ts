const DEFAULT_PUBLIC_API_URL = "http://localhost:3001";

export function readPublicApiOrigin(value: string | undefined): string | undefined {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }
  if (url.username !== "" || url.password !== "") {
    return undefined;
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return undefined;
  }
  return url.origin;
}

// Origin the Next.js server uses for its own fetches. INTERNAL_API_URL and BROWSER_API_URL
// are ordinary environment variables, so they stay out of the client bundle.
export function serverApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const internal = readPublicApiOrigin(env.INTERNAL_API_URL);
  if (env.INTERNAL_API_URL?.trim() && !internal) {
    warnInvalid("INTERNAL_API_URL");
  }
  if (internal) {
    return internal;
  }
  const browser = readPublicApiOrigin(env.BROWSER_API_URL);
  if (env.BROWSER_API_URL?.trim() && !browser) {
    warnInvalid("BROWSER_API_URL");
  }
  if (browser) {
    return browser;
  }
  return readPublicApiOrigin(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_PUBLIC_API_URL;
}

// Origin the browser uses. A value injected by the root layout wins over the build-time origin.
export function browserApiUrl(): string {
  if (typeof window !== "undefined") {
    const fromWindow = readPublicApiOrigin(window.__FACTROVE_PUBLIC__?.apiUrl);
    if (fromWindow) {
      return fromWindow;
    }
  }
  return readPublicApiOrigin(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_PUBLIC_API_URL;
}

// Inline script for the root layout. When BROWSER_API_URL is unset the baked origin stays in place.
export function publicConfigScript(env: NodeJS.ProcessEnv = process.env): string {
  const override = readPublicApiOrigin(env.BROWSER_API_URL);
  if (env.BROWSER_API_URL?.trim() && !override) {
    warnInvalid("BROWSER_API_URL");
  }
  if (!override) {
    return "window.__FACTROVE_PUBLIC__=window.__FACTROVE_PUBLIC__||{}";
  }
  const payload = JSON.stringify({ apiUrl: override }).replaceAll("<", "\\u003c");
  return `window.__FACTROVE_PUBLIC__=${payload}`;
}

function warnInvalid(name: string): void {
  console.warn(`${name} must be an absolute http(s) origin without a path, query, or hash.`);
}

declare global {
  interface Window {
    __FACTROVE_PUBLIC__?: { apiUrl?: string };
  }
}
