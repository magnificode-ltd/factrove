import { Inject, Injectable } from "@nestjs/common";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { safeApiOrigin } from "./parse-args.js";

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

    let envelope;
    try {
      envelope = invocation.revoke
        ? await this.client.revokeArtifactShare(invocation.id)
        : await this.client.createArtifactShare(invocation.id);
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
    if (!envelope.share.shareUrl) {
      throw new CliError("INVALID_INPUT", "The API did not return a share link.");
    }
    process.stdout.write(`${envelope.share.shareUrl}\n`);
  }
}
