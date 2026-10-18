import { Inject, Injectable } from "@nestjs/common";
import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { helpText, safeApiOrigin } from "./parse-args.js";
import { UploadFileService } from "./upload-file.service.js";

@Injectable()
export class UploadCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(UploadFileService) private readonly files: UploadFileService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind === "help") {
      process.stdout.write(helpText());
      return;
    }

    const upload = await this.files.read(invocation.path);
    const file = new Blob([bytesAsArrayBuffer(upload.bytes)], { type: "text/html" });
    let envelope;
    try {
      // One request only. Retrying POST /artifacts would create another artifact.
      envelope = await this.client.uploadArtifact({
        file,
        filename: upload.filename,
        accessType: invocation.access,
      });
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
    process.stdout.write(`${envelope.artifact.viewerUrl}\n`);
  }
}

function bytesAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
