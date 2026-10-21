import type { IncomingMessage } from "node:http";
import { assignClientIp } from "../auth/client-ip.js";

// Express routing is case-insensitive. Compare a lowercased path so a mixed-case
// public URL keeps the public CORS policy, the public 404 body, and client-IP assignment.
export function isPublicApiPath(path: string): boolean {
  const normalized = path.split("?")[0]?.toLowerCase() ?? "";
  return normalized === "/api/v1/public" || normalized.startsWith("/api/v1/public/");
}

export function isPublicUnlockPath(path: string): boolean {
  const normalized = path.split("?")[0]?.toLowerCase() ?? "";
  return isPublicApiPath(normalized) && /^\/api\/v1\/public\/artifacts\/[^/]+\/[^/]+\/unlock\/?$/.test(normalized);
}

export function requestPath(request: { originalUrl?: string; url?: string }): string {
  const raw = request.originalUrl ?? request.url ?? "";
  return raw.split("?")[0] ?? raw;
}

export function assignClientIpForPublicPath(request: IncomingMessage, trustedProxies: readonly string[]): void {
  if (!isPublicApiPath(requestPath(request))) {
    return;
  }
  assignClientIp(request, trustedProxies);
}
