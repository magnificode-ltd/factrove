import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { sharePasswordSchema, SHARE_PASSWORD_MAX_LENGTH, SHARE_PASSWORD_MIN_LENGTH } from "@factrove/contracts";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import type { ShareInvocation } from "./parse-args.js";
import { promptSecret, readAllStdin } from "./secret-input.js";

@Injectable()
export class ShareCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "share") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: factrove --help");
    }

    const password = invocation.password === null ? undefined : await readPassword(invocation.password);
    if (invocation.removePassword) {
      await this.removePassword(invocation);
      return;
    }
    const envelope = await callApi(invocation.apiUrl, () =>
      invocation.revoke
        ? this.client.revokeArtifactShare(invocation.id)
        : this.client.createArtifactShare(invocation.id, password === undefined ? undefined : { password }),
    );
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    if (invocation.revoke) {
      process.stdout.write(`Revoked the public link for ${invocation.id}.\n`);
      return;
    }
    if (!envelope.share.shareUrl) {
      throw new CliError("INVALID_INPUT", "The API did not return a share link.");
    }
    process.stdout.write(`${envelope.share.shareUrl}\n`);
    process.stdout.write(
      envelope.share.passwordProtected
        ? "This link is password protected.\nIf visitors are locked out after too many wrong guesses, revoke, then share again.\n"
        : "This link is not password protected.\n",
    );
  }

  private async removePassword(invocation: ShareInvocation): Promise<void> {
    const current = await callApi(invocation.apiUrl, () => this.client.getArtifactShare(invocation.id));
    if (!current.share.shared || !current.share.passwordProtected) {
      if (invocation.json) {
        process.stdout.write(`${JSON.stringify(current)}\n`);
        return;
      }
      process.stdout.write(current.share.shared ? "This link has no password.\n" : "This artifact is not shared.\n");
      return;
    }
    const envelope = await callApi(invocation.apiUrl, () => this.client.removeArtifactSharePassword(invocation.id));
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    process.stdout.write(`Removed the password for ${invocation.id}.\n`);
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
  const second = (await promptSecret("Repeat password: ", "Share cancelled.")).normalize("NFC");
  if (first !== second) {
    throw new CliError("INVALID_INPUT", "The passwords do not match.");
  }
  return first;
}

function checkPassword(value: string): string {
  const parsed = sharePasswordSchema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "The password is invalid.";
    if (message === `Use at least ${SHARE_PASSWORD_MIN_LENGTH} characters.`) {
      throw new CliError("INVALID_INPUT", `The password must be at least ${SHARE_PASSWORD_MIN_LENGTH} characters.`);
    }
    if (message === `Use at most ${SHARE_PASSWORD_MAX_LENGTH} characters.`) {
      throw new CliError("INVALID_INPUT", `The password must be at most ${SHARE_PASSWORD_MAX_LENGTH} characters.`);
    }
    throw new CliError("INVALID_INPUT", message);
  }
  return parsed.data;
}
