const DEFAULT_PUBLIC_API_URL = "http://localhost:3001";

export const DEFAULT_SOURCE_CODE_URL = "https://github.com/magnificode-ltd/factrove";

type RuntimeEnv = {
  BROWSER_API_URL?: string;
  INTERNAL_API_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  SOURCE_CODE_URL?: string;
};

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

export function readSourceCodeUrl(value: string | undefined): string | undefined {
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
  return url.href;
}

// URL of the Source code link. Read when a page renders so a fork can set
// SOURCE_CODE_URL without rebuilding the web app.
export function sourceCodeUrl(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const override = readSourceCodeUrl(source.SOURCE_CODE_URL);
  if (source.SOURCE_CODE_URL?.trim() && !override) {
    console.warn("SOURCE_CODE_URL must be an absolute http(s) URL without a username or password.");
  }
  return override ?? DEFAULT_SOURCE_CODE_URL;
}

// Origin the Next.js server uses for its own fetches. INTERNAL_API_URL and BROWSER_API_URL
// are ordinary environment variables, so they stay out of the client bundle.
function runtimeEnv(env?: RuntimeEnv): RuntimeEnv {
  return env ?? (process.env as RuntimeEnv);
}

export function serverApiUrl(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const internal = readPublicApiOrigin(source.INTERNAL_API_URL);
  if (source.INTERNAL_API_URL?.trim() && !internal) {
    warnInvalid("INTERNAL_API_URL");
  }
  if (internal) {
    return internal;
  }
  const browser = readPublicApiOrigin(source.BROWSER_API_URL);
  if (source.BROWSER_API_URL?.trim() && !browser) {
    warnInvalid("BROWSER_API_URL");
  }
  if (browser) {
    return browser;
  }
  return readPublicApiOrigin(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_PUBLIC_API_URL;
}

// Origin a CLI on the user's machine should call. This is the browser API origin,
// not the address the Next.js server uses inside a private network.
export function cliApiOrigin(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const browser = readPublicApiOrigin(source.BROWSER_API_URL);
  if (source.BROWSER_API_URL?.trim() && !browser) {
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
export function publicConfigScript(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const override = readPublicApiOrigin(source.BROWSER_API_URL);
  if (source.BROWSER_API_URL?.trim() && !override) {
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
