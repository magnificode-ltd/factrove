import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { FactroveClient } from "@factrove/api-client";
import { callApi } from "./api-call.js";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { FACTROVE_CLIENT } from "./factrove-client.token.js";
import type { CpInvocation } from "./parse-args.js";
import { artifactIdFromKey, factroveUri, isFactroveUri, parseFactroveUri, type FactroveScope, type FactroveUri } from "./uri.js";
import { readUploadFile } from "./upload-file.service.js";

const HTML_EXTENSION = /\.(html|htm)$/i;

@Injectable()
export class CpCommand {
  constructor(
    @Inject(CliConfigService) private readonly config: CliConfigService,
    @Inject(FACTROVE_CLIENT) private readonly client: FactroveClient,
  ) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "cp") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
    }
    const sourceRemote = classify(invocation.source);
    const destinationRemote = classify(invocation.destination);
    if (sourceRemote && destinationRemote) {
      throw new CliError(
        "INVALID_INPUT",
        "Copying between factrove:// URIs is not supported. Download the artifact, then upload it. The upload creates a new id.",
      );
    }
    if (!sourceRemote && !destinationRemote) {
      throw new CliError("INVALID_INPUT", "cp copies between a local path and a factrove:// URI.");
    }
    if (sourceRemote) {
      await this.download(invocation, parseFactroveUri(invocation.source));
      return;
    }
    await this.upload(invocation, parseFactroveUri(invocation.destination));
  }

  private async upload(invocation: CpInvocation, destination: FactroveUri): Promise<void> {
    if (invocation.source === "-") {
      throw new CliError("INVALID_INPUT", "cp reads a local file. Pass a path.");
    }
    const upload = await readUploadFile(invocation.source);
    const filename = uploadFilename(destination, upload.filename);
    const accessType = destination.scope === "org" ? "org_shared" : "private";
    const envelope = await callApi(invocation.apiUrl, () =>
      this.client.uploadArtifact({
        file: new Blob([arrayBufferOf(upload.bytes)], { type: "text/html" }),
        filename,
        accessType,
      }),
    );
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    if (!invocation.quiet) {
      process.stdout.write(`upload: ${invocation.source} to ${factroveUri(destination.scope, envelope.artifact.id)}\n`);
    }
  }

  private async download(invocation: CpInvocation, source: FactroveUri): Promise<void> {
    const id = downloadId(source);
    await this.artifactInScope(invocation, source.scope, id);
    const content = await callApi(invocation.apiUrl, () =>
      this.client.getArtifactContent(id, { format: invocation.format }),
    );
    const canonical = factroveUri(source.scope, id);
    if (invocation.destination === "-") {
      if (invocation.json) {
        process.stdout.write(`${JSON.stringify(content)}\n`);
        return;
      }
      process.stdout.write(content.content);
      if (!invocation.quiet) {
        process.stderr.write(`download: ${canonical} to -\n`);
      }
      return;
    }
    const downloadName = invocation.format === "markdown" ? `${id}.md` : `${id}.html`;
    const target = await resolveDownloadTarget(invocation.destination, downloadName);
    try {
      await mkdir(dirname(target.writePath), { recursive: true });
      await writeFile(target.writePath, content.content, "utf8");
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError("INVALID_INPUT", `Cannot write file: ${target.display}`);
    }
    if (invocation.json) {
      process.stdout.write(`${JSON.stringify(content)}\n`);
      return;
    }
    if (!invocation.quiet) {
      process.stdout.write(`download: ${canonical} to ${target.display}\n`);
    }
  }

  private async artifactInScope(invocation: CpInvocation, scope: FactroveScope, id: string): Promise<void> {
    const envelope = await callApi(invocation.apiUrl, () => this.client.getArtifact(id));
    const context = await callApi(invocation.apiUrl, () => this.client.getContext());
    const artifact = envelope.artifact;
    if (scope === "mine" && artifact.creatorUserId !== context.user.id) {
      throw new CliError("INVALID_INPUT", `Artifact ${id} is not in factrove://mine/.`);
    }
    if (
      scope === "org"
      && (artifact.accessType !== "org_shared" || artifact.organizationId !== (context.organization?.id ?? null))
    ) {
      throw new CliError("INVALID_INPUT", `Artifact ${id} is not in factrove://org/.`);
    }
  }
}

function classify(value: string): boolean {
  if (isFactroveUri(value)) {
    return true;
  }
  if (value.includes("://")) {
    throw new CliError("INVALID_INPUT", `Expected a factrove:// URI. Received '${value}'.`);
  }
  return false;
}

function uploadFilename(destination: FactroveUri, fallback: string): string {
  if (destination.key === undefined) {
    return fallback;
  }
  if (artifactIdFromKey(destination.key)) {
    throw new CliError(
      "INVALID_INPUT",
      "Uploads create a new artifact. The server assigns the id. Use factrove://mine/ or factrove://org/, or a filename such as factrove://mine/report.html.",
    );
  }
  if (!HTML_EXTENSION.test(destination.key)) {
    throw new CliError("INVALID_INPUT", "Only .html and .htm files are supported.");
  }
  return destination.key;
}

function downloadId(source: FactroveUri): string {
  if (source.key === undefined) {
    throw new CliError("INVALID_INPUT", `cp needs an artifact id, such as factrove://${source.scope}/<artifact-id>.`);
  }
  const id = artifactIdFromKey(source.key);
  if (!id) {
    throw new CliError(
      "INVALID_INPUT",
      `Artifact key '${source.key}' is not an id. Factrove does not store upload names. Use factrove://${source.scope}/<artifact-id> or <artifact-id>.html.`,
    );
  }
  return id;
}

async function resolveDownloadTarget(
  destination: string,
  filename: string,
): Promise<{ writePath: string; display: string }> {
  const resolved = resolve(process.cwd(), destination);
  if (destination.endsWith("/")) {
    await mkdir(resolved, { recursive: true });
    return { writePath: join(resolved, filename), display: `${destination}${filename}` };
  }
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      return { writePath: join(resolved, filename), display: `${destination.replace(/\/$/, "")}/${filename}` };
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw new CliError("INVALID_INPUT", `Cannot write file: ${destination}`);
    }
  }
  return { writePath: resolved, display: destination };
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

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
