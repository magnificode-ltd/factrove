import type { IncomingMessage, ServerResponse } from "node:http";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import { json, urlencoded } from "express";

type NextFunction = (error?: unknown) => void;

const JSON_BODY_MAX_BYTES = 102_400;

@Injectable()
export class BetterAuthMiddleware implements NestMiddleware {
  use(request: IncomingMessage, response: ServerResponse, next: NextFunction): void {
    const url = "originalUrl" in request && typeof request.originalUrl === "string" ? request.originalUrl : request.url ?? "";
    // Better Auth is mounted once in configureHttpApp. Leave these bodies unread.
    if (isAuthPath(url)) {
      next();
      return;
    }
    json({ limit: JSON_BODY_MAX_BYTES })(request, response, (error?: unknown) => {
      if (error) {
        writeParseError(response, error);
        return;
      }
      urlencoded({ extended: false })(request, response, (parseError?: unknown) => {
        if (parseError) {
          writeParseError(response, parseError);
          return;
        }
        next();
      });
    });
  }
}

function writeParseError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    return;
  }
  const status = clientStatus(error);
  const tooLarge = status === 413;
  response.statusCode = tooLarge ? 413 : 400;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({
    error: tooLarge
      ? { code: "FILE_TOO_LARGE", message: "The request is too large." }
      : { code: "INVALID_REQUEST", message: "The request is invalid." },
  }));
}

function clientStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as { status?: unknown; statusCode?: unknown };
  const status = typeof record.status === "number" ? record.status : record.statusCode;
  return typeof status === "number" ? status : undefined;
}

function isAuthPath(url: string): boolean {
  const path = url.split("?", 1)[0] ?? "";
  return path === "/api/auth" || path.startsWith("/api/auth/");
}
