import type { IncomingHttpHeaders } from "node:http";
import { ApiErrorException } from "../services/api-error.js";

type ParsedRequest = {
  headers: IncomingHttpHeaders;
  body?: unknown;
};

// BetterAuthMiddleware parses JSON and urlencoded bodies for product routes. Share routes accept
// JSON only, so a form post or a text body is an error rather than a silently missing password.
// Requiring application/json also means a cross-site form cannot submit one without a preflight.
export function jsonBody(request: ParsedRequest): unknown {
  const length = Number.parseInt(String(request.headers["content-length"] ?? "0"), 10);
  const hasBody = (Number.isFinite(length) && length > 0) || request.headers["transfer-encoding"] !== undefined;
  if (!hasBody) {
    return undefined;
  }
  const mediaType = (request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ApiErrorException(400, "INVALID_REQUEST", "Send JSON with Content-Type application/json.");
  }
  return request.body;
}
