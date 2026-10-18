import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { CliConfigService } from "./cli-config.service.js";
import { CliModule } from "./cli.module.js";
import { formatFailure } from "./cli-error.js";
import { ConfigureCommand } from "./configure.command.js";
import { GetCommand } from "./get.command.js";
import { cliWantsJson, helpText } from "./parse-args.js";
import { UploadCommand } from "./upload.command.js";

type ApplicationContext = Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;

async function run(): Promise<void> {
  let app: ApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(CliModule, {
      logger: false,
      abortOnError: false,
    });
    const invocation = app.get(CliConfigService).load();
    if (invocation.kind === "help") {
      process.stdout.write(helpText());
    } else if (invocation.kind === "configure") {
      await app.get(ConfigureCommand).execute();
    } else if (invocation.kind === "get") {
      await app.get(GetCommand).execute();
    } else {
      await app.get(UploadCommand).execute();
    }
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
