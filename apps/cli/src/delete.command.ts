import { createInterface } from "node:readline/promises";
import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";

@Injectable()
export class DeleteCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "delete") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: factrove --help");
    }
    if (!invocation.skipConfirm) {
      await confirmDelete(invocation.id);
    }
    await callApi(invocation.apiUrl, () => this.client.deleteArtifact(invocation.id));
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify({ deleted: true, id: invocation.id })}\n`);
      return;
    }
    process.stdout.write(`Deleted ${invocation.id}.\n`);
  }
}

async function confirmDelete(id: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "INVALID_INPUT",
      "Delete needs confirmation. Pass --yes or --force when stdin is not a terminal.",
    );
  }
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await reader.question(`Delete artifact ${id}? This removes the stored HTML and any public link. [y/N] `))
      .trim()
      .toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      throw new CliError("INVALID_INPUT", "Delete cancelled.");
    }
  } finally {
    reader.close();
  }
}
