import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function rejectsCookieAuthenticatedWrite(
  method: string | undefined,
  headers: IncomingHttpHeaders,
  webOrigin: string,
): boolean {
  if (SAFE_METHODS.has((method ?? "GET").toUpperCase())) {
    return false;
  }
  if (headerValue(headers, "authorization") !== undefined) {
    return false;
  }
  if (!hasSessionCookie(headerValue(headers, "cookie"))) {
    return false;
  }
  return requestOrigin(headers) !== webOrigin;
}

export function rejectCookieAuthenticatedWrite(
  request: IncomingMessage,
  response: ServerResponse,
  webOrigin: string,
): boolean {
  if (!rejectsCookieAuthenticatedWrite(request.method, request.headers, webOrigin)) {
    return false;
  }
  if (response.headersSent) {
    return true;
  }
  response.statusCode = 403;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({
    error: {
      code: "FORBIDDEN",
      message: "This request origin is not allowed.",
    },
  }));
  return true;
}

function requestOrigin(headers: IncomingHttpHeaders): string | null {
  if (headerValue(headers, "origin") !== undefined) {
    return parseOrigin(headerValue(headers, "origin"));
  }
  return parseOrigin(headerValue(headers, "referer") ?? headerValue(headers, "referrer"));
}

function parseOrigin(value: string | undefined): string | null {
  if (!value || value === "null") {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function hasSessionCookie(cookie: string | undefined): boolean {
  if (!cookie) {
    return false;
  }
  return /(?:^|;\s*)(?:__Host-|__Secure-)?better-auth\.session_token=/.test(cookie);
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
