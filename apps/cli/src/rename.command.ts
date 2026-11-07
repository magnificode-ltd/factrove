import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";

@Injectable()
export class RenameCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "rename") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: factrove --help");
    }
    const envelope = await callApi(invocation.apiUrl, () => this.client.renameArtifact(invocation.id, invocation.name));
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    process.stdout.write(`Renamed ${invocation.id}.\n`);
  }
}
