import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, host);
}

void bootstrap();
