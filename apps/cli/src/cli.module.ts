import { Module } from "@nestjs/common";
import { createFactroveClient, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { UploadCommand } from "./upload.command.js";
import { UploadFileService } from "./upload-file.service.js";

export { FACTROVE_CLIENT };

@Module({
  providers: [
    CliConfigService,
    UploadFileService,
    UploadCommand,
    {
      provide: FACTROVE_CLIENT,
      inject: [CliConfigService],
      useFactory: (config: CliConfigService): FactroveClient => lazyClient(config),
    },
  ],
  exports: [FACTROVE_CLIENT],
})
export class CliModule {}

function lazyClient(config: CliConfigService): FactroveClient {
  let client: FactroveClient | undefined;
  const resolve = (): FactroveClient => {
    if (!client) {
      const baseUrl = config.apiUrl();
      try {
        client = createFactroveClient({ baseUrl });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Invalid API URL";
        throw new CliError("INVALID_INPUT", `API URL must be an absolute HTTP or HTTPS URL. ${detail}`);
      }
    }
    return client;
  };
  return {
    getContext: () => resolve().getContext(),
    uploadArtifact: (input) => resolve().uploadArtifact(input),
    listArtifacts: (input) => resolve().listArtifacts(input),
    getArtifact: (id) => resolve().getArtifact(id),
  };
}
