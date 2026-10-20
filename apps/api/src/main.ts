import "reflect-metadata";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { configureHttpApp } from "./configure-http-app.js";
import { API_CONFIG, type ApiConfig } from "./services/api-config.js";

loadLocalEnv();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttpApp(app);
  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.port, config.host);
}

function loadLocalEnv(): void {
  try {
    loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(startupMessage(error));
  process.exitCode = 1;
});

function startupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "API failed to start";
  if (/postgres(ql)?:\/\//i.test(message)) {
    return "API failed to start. Check database configuration.";
  }
  return message;
}
