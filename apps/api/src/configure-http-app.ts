import type { IncomingMessage, ServerResponse } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { toNodeHandler } from "better-auth/node";
import { AuthService } from "./auth/auth.service.js";
import { ApiExceptionFilter } from "./controllers/api-exception.filter.js";
import { API_CONFIG, type ApiConfig } from "./services/api-config.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

export function configureHttpApp(app: INestApplication): void {
  const config = app.get<ApiConfig>(API_CONFIG);
  const auth = app.get(AuthService);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin(requestOrigin: string | undefined, callback: (error: Error | null, allow?: boolean | string) => void) {
      if (requestOrigin === config.webOrigin) {
        callback(null, config.webOrigin);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  });
  // Registered after CORS so the browser can call /api/auth from the web origin.
  // The handler is resolved per request because Better Auth is created in onModuleInit.
  app.use("/api/auth", (request: IncomingMessage, response: ServerResponse) => {
    void toNodeHandler(auth.handler())(request, response);
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((_request: unknown, response: HeaderResponse, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
}
