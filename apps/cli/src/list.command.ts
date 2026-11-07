import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";

@Injectable()
export class ListCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "list") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: factrove --help");
    }
    const envelope = await callApi(invocation.apiUrl, () => this.client.listArtifacts({ view: invocation.view }));
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    for (const artifact of envelope.items) {
      process.stdout.write(listLine(artifact));
    }
  }
}

function listLine(artifact: ArtifactDto): string {
  const label = artifact.name ?? artifact.filename;
  return `${artifact.id}  ${artifact.accessType}  ${label}\n`;
}
