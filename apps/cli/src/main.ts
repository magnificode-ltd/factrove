#!/usr/bin/env node
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { CliConfigService } from "./cli-config.service.js";
import { CliModule } from "./cli.module.js";
import { CliError, formatFailure } from "./cli-error.js";
import { ConfigureCommand } from "./configure.command.js";
import { DeleteCommand } from "./delete.command.js";
import { GetCommand } from "./get.command.js";
import { ListCommand } from "./list.command.js";
import { cliWantsJson, helpText } from "./parse-args.js";
import { RenameCommand } from "./rename.command.js";
import { ShareCommand } from "./share.command.js";
import { UploadCommand } from "./upload.command.js";

// scripts/factrove.mjs loads apps/cli/.env for local development. This entrypoint does not.

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
      process.stdout.write(helpText(invocation.command));
    } else if (invocation.kind === "configure") {
      await app.get(ConfigureCommand).execute();
    } else if (invocation.kind === "get") {
      await app.get(GetCommand).execute();
    } else if (invocation.kind === "share") {
      await app.get(ShareCommand).execute();
    } else if (invocation.kind === "list") {
      await app.get(ListCommand).execute();
    } else if (invocation.kind === "rename") {
      await app.get(RenameCommand).execute();
    } else if (invocation.kind === "delete") {
      await app.get(DeleteCommand).execute();
    } else if (invocation.kind === "upload") {
      await app.get(UploadCommand).execute();
    } else {
      const unhandled: never = invocation;
      throw new CliError("INVALID_INPUT", `Missing command. Run: factrove --help (${String(unhandled)})`);
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
