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
  return pathnameOf(request.originalUrl ?? request.url ?? "");
}

// Express matches a mounted prefix against the URL pathname, including an
// absolute-form request target. Classify the same way so a raw target such
// as http://host/api/v1/public/... is still a public path.
function pathnameOf(raw: string): string {
  const withoutHash = raw.split("#", 1)[0] ?? raw;
  if (withoutHash.startsWith("http://") || withoutHash.startsWith("https://")) {
    try {
      return new URL(withoutHash).pathname;
    } catch {
      return withoutHash.split("?", 1)[0] ?? withoutHash;
    }
  }
  return withoutHash.split("?", 1)[0] ?? withoutHash;
}

export function assignClientIpForPublicPath(request: IncomingMessage, trustedProxies: readonly string[]): void {
  if (!isPublicApiPath(requestPath(request))) {
    return;
  }
  assignClientIp(request, trustedProxies);
}
