import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";

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

    const content = await callApi(invocation.apiUrl, () =>
      this.client.getArtifactContent(invocation.id, { format: invocation.format }),
    );

    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(content)}\n`);
      return;
    }
    process.stdout.write(content.content);
  }
}
