import { Inject, Injectable } from "@nestjs/common";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { safeApiOrigin } from "./parse-args.js";

@Injectable()
export class GetCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "get") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
    }

    let content;
    try {
      content = await this.client.getArtifactContent(invocation.id, { format: invocation.format });
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
      process.stdout.write(`${JSON.stringify(content)}\n`);
      return;
    }
    process.stdout.write(content.content);
  }
}
