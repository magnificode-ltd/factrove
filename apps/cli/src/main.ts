import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { CliModule } from "./cli.module.js";
import { formatFailure } from "./cli-error.js";
import { cliWantsJson } from "./parse-args.js";
import { UploadCommand } from "./upload.command.js";

type ApplicationContext = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

async function run(): Promise<void> {
  let app: ApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(CliModule, {
      logger: false,
      abortOnError: false,
    });
    await app.get(UploadCommand).execute();
  } catch (error) {
    process.stderr.write(formatFailure(error, cliWantsJson(process.argv.slice(2))));
    process.exitCode = 1;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (error) {
        if (process.exitCode === undefined || process.exitCode === 0) {
          process.stderr.write(formatFailure(error, cliWantsJson(process.argv.slice(2))));
          process.exitCode = 1;
        }
      }
    }
  }
}

void run();
