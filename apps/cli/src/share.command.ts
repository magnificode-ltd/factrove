import { Inject, Injectable } from "@nestjs/common";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { safeApiOrigin, type ShareInvocation } from "./parse-args.js";
import { promptSecret, readAllStdin } from "./secret-input.js";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

@Injectable()
export class ShareCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "share") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
    }

    const password = invocation.password === null ? undefined : await readPassword(invocation.password);
    let envelope;
    try {
      envelope = await this.send(invocation, password);
    } catch (error) {
      if (error instanceof FactroveApiError && error.code === "NETWORK_ERROR") {
        throw new CliError(
          "NETWORK_ERROR",
          `Could not reach the Factrove API at ${safeApiOrigin(invocation.apiUrl)}.`,
        );
      }
      throw error;
    }

    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    if (invocation.revoke) {
      process.stdout.write(`Revoked the public link for ${invocation.id}.\n`);
      return;
    }
    if (invocation.removePassword) {
      process.stdout.write(`Removed the password for ${invocation.id}.\n`);
      return;
    }
    if (!envelope.share.shareUrl) {
      throw new CliError("INVALID_INPUT", "The API did not return a share link.");
    }
    process.stdout.write(`${envelope.share.shareUrl}\n`);
  }

  private send(invocation: ShareInvocation, password: string | undefined) {
    if (invocation.revoke) {
      return this.client.revokeArtifactShare(invocation.id);
    }
    if (invocation.removePassword) {
      return this.client.removeArtifactSharePassword(invocation.id);
    }
    return this.client.createArtifactShare(invocation.id, password === undefined ? undefined : { password });
  }
}

async function readPassword(source: "prompt" | "stdin"): Promise<string> {
  if (source === "stdin") {
    if (process.stdin.isTTY) {
      throw new CliError("INVALID_INPUT", "--password-stdin reads a pipe. Use --password to type it instead.");
    }
    return checkPassword((await readAllStdin()).replace(/\r?\n$/, ""));
  }
  if (!process.stdin.isTTY) {
    throw new CliError("INVALID_INPUT", "--password needs a terminal. Pipe the password with --password-stdin.");
  }
  const first = checkPassword(await promptSecret("Link password: ", "Share cancelled."));
  const second = await promptSecret("Repeat password: ", "Share cancelled.");
  if (first !== second) {
    throw new CliError("INVALID_INPUT", "The passwords do not match.");
  }
  return first;
}

function checkPassword(value: string): string {
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw new CliError("INVALID_INPUT", `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    throw new CliError("INVALID_INPUT", `The password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  return value;
}
