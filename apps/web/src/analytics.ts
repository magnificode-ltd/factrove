import { DEFAULT_POSTHOG_HOST, readPosthogHost, readPosthogKey } from "@/public-config";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Static app routes are shorter than this. Longer path segments are ids or tokens.
const OPAQUE_SEGMENT_LENGTH = 20;

const BLOCKED_EVENTS = new Set([
  "$identify",
  "$create_alias",
  "$groupidentify",
  "$set",
  "$autocapture",
  "$rageclick",
  "$dead_click",
  "$dead_swipe",
  "$exception",
  "$snapshot",
  "$web_vitals",
  "$heatmap",
  "$$heatmap",
]);

// `token` is PostHog's project key. Removing it makes before_send drop the event.
const TRANSPORT_CREDENTIAL = "token";

const DROPPED_PROPERTIES = new Set([
  "title",
  "$title",
  "$el_text",
  "$el_value",
  "$elements",
  "$elements_chain",
  "email",
  "name",
  "filename",
  "password",
  "content",
]);

const SENSITIVE_VALUE = /@|ftrv_|phc_|phx_|password=|api[_-]?key/i;

export type AnalyticsCapture = {
  event: string;
  properties?: Record<string, unknown>;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

export type AnalyticsClient = {
  init: (key: string, options: ReturnType<typeof posthogInitOptions>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
};

type BrowserSignals = {
  navigator?: { doNotTrack?: string | null; msDoNotTrack?: string | null; globalPrivacyControl?: boolean };
  doNotTrack?: string | null;
};

export function sanitizeAnalyticsPath(pathname: string): string {
  const cut = pathname.split(/[?#]/, 1)[0] ?? "";
  const withSlash = cut.startsWith("/") ? cut : `/${cut}`;
  const segments = withSlash.split("/");
  return segments
    .map((segment, index) => (index === 0 || segment.length === 0 ? segment : redactSegment(segment)))
    .join("/") || "/";
}

export function sanitizeAnalyticsUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return sanitizeAnalyticsPath(trimmed);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return sanitizeAnalyticsPath(url.pathname);
  }
  return `${url.origin}${sanitizeAnalyticsPath(url.pathname)}`;
}

export function analyticsPageUrl(pathname: string, origin: string): { path: string; url: string } {
  const path = sanitizeAnalyticsPath(pathname);
  let safeOrigin = "";
  try {
    const url = new URL(origin);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "") {
      safeOrigin = url.origin;
    }
  } catch {
    safeOrigin = "";
  }
  return { path, url: safeOrigin ? `${safeOrigin}${path}` : path };
}

export function sanitizePosthogCapture<T extends AnalyticsCapture>(event: T | null): T | null {
  if (!event) {
    return event;
  }
  if (BLOCKED_EVENTS.has(event.event)) {
    return null;
  }
  const properties: Record<string, unknown> = { ...(event.properties ?? {}) };
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    if (key === TRANSPORT_CREDENTIAL) {
      continue;
    }
    if (DROPPED_PROPERTIES.has(key) || /email|password|secret|token|filename|artifact/i.test(key)) {
      delete properties[key];
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    if (isUrlProperty(key)) {
      properties[key] = sanitizeAnalyticsUrl(value);
      continue;
    }
    if (SENSITIVE_VALUE.test(value)) {
      delete properties[key];
    }
  }
  const next: T = { ...event, properties };
  delete next.$set;
  delete next.$set_once;
  return next;
}

export function posthogInitOptions(host: string) {
  return {
    api_host: host,
    persistence: "memory" as const,
    cookieless_mode: "always" as const,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    mask_all_text: true,
    respect_dnt: true,
    person_profiles: "never" as const,
    // /flags and /decide skip before_send and attach the raw page URL.
    advanced_disable_flags: true,
    property_denylist: ["email", "name", "password", "filename", "title", "$title", "$el_text", "$el_value"],
    get_current_url: (defaultUrl: string) => sanitizeAnalyticsUrl(defaultUrl),
    before_send: sanitizePosthogCapture,
  };
}

export function browserTrackingDisabled(target?: BrowserSignals): boolean {
  const source = target ?? (typeof window === "undefined" ? undefined : (window as BrowserSignals));
  if (!source) {
    return false;
  }
  const signals = [
    source.navigator?.doNotTrack,
    source.navigator?.msDoNotTrack,
    source.doNotTrack,
    source.navigator?.globalPrivacyControl,
  ];
  return signals.some((signal) => signal === true || signal === "1" || signal === "yes");
}

export function browserPosthogConfig(): { key: string; host: string } | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const key = readPosthogKey(window.__FACTROVE_PUBLIC__?.posthogKey);
  if (!key) {
    return undefined;
  }
  return { key, host: readPosthogHost(window.__FACTROVE_PUBLIC__?.posthogHost) ?? DEFAULT_POSTHOG_HOST };
}

export function capturePageview(client: AnalyticsClient, pathname: string, origin: string): void {
  const page = analyticsPageUrl(pathname, origin);
  client.capture("$pageview", { $current_url: page.url, $pathname: page.path });
}

let pending: Promise<AnalyticsClient | undefined> | undefined;

async function loadPosthog(): Promise<{ default: AnalyticsClient }> {
  const imported = await import("posthog-js");
  return { default: imported.default };
}

// Dynamic import runs only after a valid key is present, so posthog-js stays unloaded otherwise.
export function startAnalytics(
  config: { key: string; host: string } | undefined,
  load: () => Promise<{ default: AnalyticsClient }> = loadPosthog,
): Promise<AnalyticsClient | undefined> {
  const key = readPosthogKey(config?.key);
  if (!key || browserTrackingDisabled()) {
    return Promise.resolve(undefined);
  }
  const host = readPosthogHost(config?.host) ?? DEFAULT_POSTHOG_HOST;
  if (!pending) {
    pending = load()
      .then((imported) => {
        imported.default.init(key, posthogInitOptions(host));
        return imported.default;
      })
      .catch(() => {
        pending = undefined;
        console.warn("PostHog analytics did not start.");
        return undefined;
      });
  }
  return pending;
}

export function resetAnalyticsForTests(): void {
  pending = undefined;
}

function redactSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  if (
    /\.html?$/i.test(decoded) ||
    UUID_RE.test(decoded) ||
    decoded.includes("@") ||
    /^(?:ftrv_|phc_|phx_)/i.test(decoded)
  ) {
    return ":id";
  }
  if (decoded.length >= OPAQUE_SEGMENT_LENGTH) {
    return ":id";
  }
  return segment;
}

function isUrlProperty(key: string): boolean {
  return key === "$pathname" || key === "$referrer" || key.endsWith("_url") || key.endsWith("_pathname") || key.endsWith("_referrer");
}
