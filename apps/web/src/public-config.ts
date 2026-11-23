const DEFAULT_PUBLIC_API_URL = "http://localhost:3001";

export const DEFAULT_SOURCE_CODE_URL = "https://github.com/magnificode-ltd/factrove";

export const DEFAULT_DOCS_BASE_URL = "https://factrove.mintlify.app";

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const POSTHOG_KEY_RE = /^phc_[A-Za-z0-9_-]{8,200}$/;

type RuntimeEnv = {
  BROWSER_API_URL?: string;
  INTERNAL_API_URL?: string;
  NEXT_PUBLIC_API_URL?: string;
  SOURCE_CODE_URL?: string;
  DOCS_BASE_URL?: string;
  POSTHOG_KEY?: string;
  POSTHOG_HOST?: string;
  TURNSTILE_SITE_KEY?: string;
};

// Cloudflare site keys, including the documented dummy keys, fit this shape.
const TURNSTILE_SITE_KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;

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

export function readDocsBaseUrl(value: string | undefined): string | undefined {
  const raw = value?.trim() ?? "";
  if (raw.length === 0) {
    return undefined;
  }
  // URL.search and URL.hash are empty for a bare trailing "?" or "#", and
  // docsUrl would then append its path after that marker.
  if (raw.includes("?") || raw.includes("#")) {
    return undefined;
  }
  const href = readSourceCodeUrl(raw);
  if (!href) {
    return undefined;
  }
  return href.replace(/\/+$/, "");
}

// Base URL for docs links. The header Docs link opens this URL. Other links
// append a path, including the CLI reference. Read when a page renders so an
// install can set DOCS_BASE_URL without rebuilding the web app. Unset, empty,
// or a URL with a query or hash keeps the public docs site. A trailing slash
// is dropped.
export function docsBaseUrl(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const override = readDocsBaseUrl(source.DOCS_BASE_URL);
  if (source.DOCS_BASE_URL?.trim() && !override) {
    console.warn("DOCS_BASE_URL must be an absolute http(s) URL without a username, password, query, or hash.");
  }
  return override ?? DEFAULT_DOCS_BASE_URL;
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

// Public PostHog project key. A personal key is rejected. Empty and invalid
// values leave analytics off.
export function readPosthogKey(value: string | undefined): string | undefined {
  const raw = value?.trim() ?? "";
  if (raw.length === 0 || !POSTHOG_KEY_RE.test(raw)) {
    return undefined;
  }
  return raw;
}

export function readPosthogHost(value: string | undefined): string | undefined {
  return readPublicApiOrigin(value);
}

// Public Turnstile site key for the signup form. Empty and invalid values
// leave the widget off. The secret never belongs in this process.
export function readTurnstileSiteKey(value: string | undefined): string | undefined {
  const raw = value?.trim() ?? "";
  if (raw.length === 0 || !TURNSTILE_SITE_KEY_RE.test(raw)) {
    return undefined;
  }
  return raw;
}

export function turnstileSiteKey(env?: RuntimeEnv): string | undefined {
  const source = runtimeEnv(env);
  const key = readTurnstileSiteKey(source.TURNSTILE_SITE_KEY);
  if (source.TURNSTILE_SITE_KEY?.trim() && !key) {
    console.warn("TURNSTILE_SITE_KEY must be a Turnstile site key. The signup check stays off.");
  }
  return key;
}

// Key and host for the browser. Unset or invalid POSTHOG_KEY disables analytics.
// An invalid POSTHOG_HOST keeps the key and uses the default US Cloud host.
export function posthogSettings(env?: RuntimeEnv): { key: string; host: string } | undefined {
  const source = runtimeEnv(env);
  const key = readPosthogKey(source.POSTHOG_KEY);
  if (source.POSTHOG_KEY?.trim() && !key) {
    console.warn("POSTHOG_KEY must be a public PostHog project key (phc_...). Analytics stays off.");
  }
  if (!key) {
    return undefined;
  }
  const host = readPosthogHost(source.POSTHOG_HOST);
  if (source.POSTHOG_HOST?.trim() && !host) {
    console.warn(
      "POSTHOG_HOST must be an absolute http(s) origin without a path, query, or hash. Using https://us.i.posthog.com.",
    );
  }
  return { key, host: host ?? DEFAULT_POSTHOG_HOST };
}

// Inline script for the root layout. When BROWSER_API_URL is unset the baked origin stays in place.
// POSTHOG_KEY is included only when it is a public project key, so an unset key does not reach the browser.
export function publicConfigScript(env?: RuntimeEnv): string {
  const source = runtimeEnv(env);
  const override = readPublicApiOrigin(source.BROWSER_API_URL);
  if (source.BROWSER_API_URL?.trim() && !override) {
    warnInvalid("BROWSER_API_URL");
  }
  const analytics = posthogSettings(source);
  const payload: { apiUrl?: string; posthogKey?: string; posthogHost?: string } = {};
  if (override) {
    payload.apiUrl = override;
  }
  if (analytics) {
    payload.posthogKey = analytics.key;
    payload.posthogHost = analytics.host;
  }
  if (!payload.apiUrl && !payload.posthogKey) {
    return "window.__FACTROVE_PUBLIC__=window.__FACTROVE_PUBLIC__||{}";
  }
  const json = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `window.__FACTROVE_PUBLIC__=${json}`;
}

function warnInvalid(name: string): void {
  console.warn(`${name} must be an absolute http(s) origin without a path, query, or hash.`);
}

declare global {
  interface Window {
    __FACTROVE_PUBLIC__?: { apiUrl?: string; posthogKey?: string; posthogHost?: string };
  }
}
