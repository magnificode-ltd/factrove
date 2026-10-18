import type { INestApplication } from "@nestjs/common";
import { ApiExceptionFilter } from "./controllers/api-exception.filter.js";
import { API_CONFIG, type ApiConfig } from "./services/api-config.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

export function configureHttpApp(app: INestApplication): void {
  const config = app.get<ApiConfig>(API_CONFIG);
  app.setGlobalPrefix("api/v1");
  app.enableCors({
    origin(requestOrigin: string | undefined, callback: (error: Error | null, allow?: boolean | string) => void) {
      if (requestOrigin === config.webOrigin) {
        callback(null, config.webOrigin);
        return;
      }
      callback(null, false);
    },
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.use((_request: unknown, response: HeaderResponse, next: () => void) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
}
