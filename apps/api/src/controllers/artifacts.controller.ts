import { Readable } from "node:stream";
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  artifactDtoSchema,
  artifactViewSchema,
  contentFormatSchema,
  type ArtifactEnvelope,
  type ArtifactListEnvelope,
  type ContentFormat,
} from "@factrove/contracts";
import { htmlContentHeaders, markdownContentHeaders, MAX_HTML_BYTES } from "../rendering/html-policy.js";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { ApiErrorException, type ApiErrorCode } from "../services/api-error.js";
import { ArtifactsService } from "../services/artifacts.service.js";
import { BlobNotFoundError, BlobStoreUnavailableError } from "../storage/index.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

// private and org_shared classify library listings. Detail and content stay unauthenticated.
@Controller("artifacts")
export class ArtifactsController {
  constructor(
    @Inject(ArtifactsService) private readonly artifacts: ArtifactsService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        // Busboy emits its limit when the buffered size reaches this ceiling.
        fileSize: MAX_HTML_BYTES + 1,
        files: 2,
        fields: 8,
        fieldSize: 1024,
        parts: 12,
      },
    }),
  )
  async upload(@UploadedFile() file: unknown, @Body() body: unknown): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.upload(file, body);
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  @Get()
  async list(@Query("view") view: unknown): Promise<ArtifactListEnvelope> {
    const records = await this.artifacts.list(parseView(view));
    return { items: records };
  }

  @Get(":id/content")
  async content(
    @Param("id") id: string,
    @Query("format") format: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const requested = parseContentFormat(format);
    const opened = await this.artifacts.openContent(parseArtifactId(id), requested);
    if (opened.format === "markdown") {
      for (const [name, value] of markdownContentHeaders(opened.body.byteLength)) {
        response.setHeader(name, value);
      }
      return new StreamableFile(opened.body);
    }
    for (const [name, value] of htmlContentHeaders(this.config.webOrigin, opened.sizeBytes)) {
      response.setHeader(name, value);
    }
    const file = new StreamableFile(Readable.from(opened.body));
    file.setErrorHandler((error, streamResponse) => {
      if (streamResponse.headersSent) {
        // Keep the socket from idling on a Content-Length the rest of the body will never fill.
        if (!streamResponse.destroyed && "destroy" in streamResponse && typeof streamResponse.destroy === "function") {
          streamResponse.destroy();
        }
        return;
      }
      if (streamResponse.destroyed) {
        return;
      }
      const mapped = contentFailure(error);
      streamResponse.statusCode = mapped.status;
      if ("setHeader" in streamResponse && typeof streamResponse.setHeader === "function") {
        streamResponse.setHeader("Content-Type", "application/json; charset=utf-8");
        streamResponse.setHeader("X-Content-Type-Options", "nosniff");
      }
      streamResponse.send(JSON.stringify({ error: { code: mapped.code, message: mapped.message } }));
    });
    return file;
  }

  @Get(":id")
  async detail(@Param("id") id: string): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.getById(parseArtifactId(id));
    return { artifact };
  }
}

function parseContentFormat(value: unknown): ContentFormat {
  if (value === undefined) {
    return "html";
  }
  const parsed = contentFormatSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "format must be html or markdown.");
  }
  return parsed.data;
}

function parseView(value: unknown): "mine" | "org" {
  if (value === undefined) {
    return "mine";
  }
  const parsed = artifactViewSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "view must be mine or org.");
  }
  return parsed.data;
}

function parseArtifactId(value: string): string {
  const parsed = artifactDtoSchema.shape.id.safeParse(value);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "Artifact id must be a UUID.");
  }
  return parsed.data;
}

function contentFailure(error: unknown): { status: number; code: ApiErrorCode; message: string } {
  if (error instanceof ApiErrorException) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof BlobNotFoundError) {
    return { status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." };
  }
  if (error instanceof BlobStoreUnavailableError) {
    return { status: 503, code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
}
