import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import { helpText } from "./parse-args.js";
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
    if (invocation.kind !== "upload") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
    }

    const upload = await this.files.read(invocation.path);
    const file = new Blob([arrayBufferOf(upload.bytes)], { type: "text/html" });
    // One request only. Retrying POST /artifacts would create another artifact.
    const envelope = await callApi(invocation.apiUrl, () =>
      this.client.uploadArtifact({
        file,
        filename: upload.filename,
        accessType: invocation.access,
      }),
    );

    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    process.stdout.write(`${envelope.artifact.viewerUrl}\n`);
  }
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer;
  if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer;
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
