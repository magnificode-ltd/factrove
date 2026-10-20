import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import { AuthService } from "./auth/auth.service.js";
import { assignClientIp } from "./auth/client-ip.js";
import { rejectCookieAuthenticatedWrite } from "./auth/cookie-origin.js";
import { ApiExceptionFilter } from "./controllers/api-exception.filter.js";
import { API_CONFIG, type ApiConfig } from "./services/api-config.js";
import { browserOrigins } from "./sharing/public-origin.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

const CREDENTIALED_METHODS = "GET,HEAD,POST,DELETE,OPTIONS";
const PUBLIC_METHODS = "GET,HEAD,OPTIONS";
const CREDENTIALED_HEADERS = "Content-Type,Accept,Authorization";
const PUBLIC_HEADERS = "Content-Type,Accept";

export function configureHttpApp(app: INestApplication): void {
  const config = app.get<ApiConfig>(API_CONFIG);
  const auth = app.get(AuthService);
  app.setGlobalPrefix("api/v1");
  app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (applyCors(request, response, browserOrigins(config.webOrigin, config.publicBaseUrl))) {
      return;
    }
    next();
  });
  // Session writes are accepted from the owner app and from PUBLIC_BASE_URL.
  // API-key calls send Authorization and skip this check. This runs before the body parser.
  app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (rejectCookieAuthenticatedWrite(request, response, browserOrigins(config.webOrigin, config.publicBaseUrl))) {
      return;
    }
    next();
  });
  // Replace any caller-supplied client IP, then mount Better Auth once.
  // The handler is resolved per request because Better Auth is created in onModuleInit.
  app.use("/api/auth", (request: IncomingMessage, _response: ServerResponse, next: () => void) => {
    assignClientIp(request, config.trustedProxies);
    next();
  });
  // Public views use the same client-IP header. Drop any caller-supplied value first.
  app.use("/api/v1/public", (request: IncomingMessage, _response: ServerResponse, next: () => void) => {
    assignClientIp(request, config.trustedProxies);
    next();
  });
  app.use("/api/auth", (request: IncomingMessage, response: ServerResponse) => {
    void toNodeHandler(auth.handler())(request, response);
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((_request: unknown, response: HeaderResponse, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
}

function applyCors(request: IncomingMessage, response: ServerResponse, origins: readonly string[]): boolean {
  const path = requestPath(request);
  const publicApi = path === "/api/v1/public" || path.startsWith("/api/v1/public/");
  if (publicApi) {
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Robots-Tag", "noindex");
  }
  const origin = headerValue(request.headers, "origin");
  const allowed = origin !== undefined && origin !== "null" && origins.includes(origin);
  if (allowed && origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    if (!publicApi) {
      response.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
  if ((request.method ?? "GET").toUpperCase() !== "OPTIONS") {
    return false;
  }
  if (allowed) {
    response.setHeader("Access-Control-Allow-Methods", publicApi ? PUBLIC_METHODS : CREDENTIALED_METHODS);
    response.setHeader("Access-Control-Allow-Headers", publicApi ? PUBLIC_HEADERS : CREDENTIALED_HEADERS);
  }
  response.statusCode = 204;
  response.end();
  return true;
}

function requestPath(request: IncomingMessage): string {
  const withOriginal = request as IncomingMessage & { originalUrl?: string };
  const raw = withOriginal.originalUrl ?? request.url ?? "";
  return raw.split("?")[0] ?? raw;
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}
