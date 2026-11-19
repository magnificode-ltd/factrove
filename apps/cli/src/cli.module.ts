import { Module } from "@nestjs/common";
import { createFactroveClient, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { ConfigureCommand } from "./configure.command.js";
import { DeleteCommand } from "./delete.command.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { GetCommand } from "./get.command.js";
import { ListCommand } from "./list.command.js";
import { RenameCommand } from "./rename.command.js";
import { ShareCommand } from "./share.command.js";
import { UploadCommand } from "./upload.command.js";
import { UploadFileService } from "./upload-file.service.js";

@Module({
  providers: [
    CliConfigService,
    UploadFileService,
    UploadCommand,
    GetCommand,
    ShareCommand,
    ListCommand,
    RenameCommand,
    DeleteCommand,
    ConfigureCommand,
    {
      provide: FACTROVE_CLIENT,
      inject: [CliConfigService],
      useFactory: (config: CliConfigService): FactroveClient => lazyClient(config),
    },
  ],
})
export class CliModule {}

function lazyClient(config: CliConfigService): FactroveClient {
  let client: FactroveClient | undefined;
  const resolve = (): FactroveClient => {
    if (!client) {
      const baseUrl = config.apiUrl();
      const apiKey = config.requireApiKey();
      try {
        client = createFactroveClient({ baseUrl, apiKey });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Invalid API URL";
        throw new CliError("INVALID_INPUT", `API URL must be an absolute HTTP or HTTPS URL. ${detail}`);
      }
    }
    return client;
  };
  return {
    getContext: () => resolve().getContext(),
    createOrganization: (name) => resolve().createOrganization(name),
    uploadArtifact: (input) => resolve().uploadArtifact(input),
    replaceArtifactContent: (id, input) => resolve().replaceArtifactContent(id, input),
    shareArtifactWithOrganization: (id, organizationId) => resolve().shareArtifactWithOrganization(id, organizationId),
    renameArtifact: (id, name) => resolve().renameArtifact(id, name),
    deleteArtifact: (id) => resolve().deleteArtifact(id),
    listArtifacts: (input) => resolve().listArtifacts(input),
    getArtifact: (id) => resolve().getArtifact(id),
    getArtifactContent: (id, input) => resolve().getArtifactContent(id, input),
    getArtifactShare: (id) => resolve().getArtifactShare(id),
    createArtifactShare: (id, input) => resolve().createArtifactShare(id, input),
    revokeArtifactShare: (id) => resolve().revokeArtifactShare(id),
    removeArtifactSharePassword: (id) => resolve().removeArtifactSharePassword(id),
    getPublicArtifact: (id, token, input) => resolve().getPublicArtifact(id, token, input),
    unlockPublicArtifact: (id, token, password) => resolve().unlockPublicArtifact(id, token, password),
  };
}
