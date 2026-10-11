import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { CliModule } from "./cli.module.js";

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CliModule, { logger: false });
  try {
    // The upload command is added by the CLI implementation task.
  } finally {
    await app.close();
  }
}

void run();
