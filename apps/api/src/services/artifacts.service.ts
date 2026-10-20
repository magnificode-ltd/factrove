import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  accessTypeSchema,
  artifactDtoSchema,
  type AccessType,
  type ArtifactDto,
  type ArtifactView,
  type ContentFormat,
} from "@factrove/contracts";
import { ArtifactsRepository, PrismaService, type ArtifactRecord } from "../database/index.js";
import { convertHtmlToMarkdown } from "../rendering/convert-html-to-markdown.js";
import { HtmlConversionError, readBoundedHtml } from "../rendering/html-to-markdown.js";
import { ActorService, type Actor, type HeaderSource } from "../auth/actor.service.js";
import { artifactContentUrl, contentGrantAllows, grantedContentUrl } from "../auth/content-grant.js";
import { artifactObjectKey, rejectHtmlUpload } from "../rendering/html-policy.js";
import { BLOB_STORE, BlobNotFoundError, BlobStoreUnavailableError, type BlobStore } from "../storage/index.js";
import { API_CONFIG, type ApiConfig } from "./api-config.js";
import { ApiErrorException } from "./api-error.js";

const IDENTITY_FIELDS = [
  "creatorUserId",
  "creator_user_id",
  "organizationId",
  "organization_id",
  "userId",
  "user_id",
] as const;

@Injectable()
export class ArtifactsService {
  private readonly logger = new Logger(ArtifactsService.name);

  constructor(
    @Inject(ArtifactsRepository) private readonly artifacts: ArtifactsRepository,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(ActorService) private readonly actors: ActorService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async upload(request: HeaderSource, file: unknown, body: unknown): Promise<ArtifactDto> {
    const actor = await this.actors.requireActor(request);
    const fields = formFields(body);
    assertNoIdentityFields(fields);
    const accessType = readAccessType(fields);
    const upload = readUpload(file);
    if (!upload) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "Send exactly one file.");
    }

    if (accessType === "org_shared" && actor.organization === null) {
      throw new ApiErrorException(
        400,
        "ORGANIZATION_REQUIRED",
        "Organization sharing requires membership in an organization.",
      );
    }

    const violation = rejectHtmlUpload(upload.filename, upload.bytes);
    if (violation) {
      throw new ApiErrorException(violation.status, violation.code, violation.message);
    }

    const id = randomUUID();
    const objectKey = artifactObjectKey(id);
    await this.blobs.put({
      objectKey,
      body: upload.bytes,
      contentType: "text/html",
    });

    try {
      const record = await this.artifacts.create({
        id,
        creatorUserId: actor.user.id,
        organizationId: actor.organization?.id ?? null,
        accessType,
        mimeType: "text/html",
        sizeBytes: upload.bytes.byteLength,
        uploadedAt: new Date(),
      });
      return this.toDto(record, false);
    } catch (error) {
      await this.deleteOrphan(id, objectKey);
      throw error;
    }
  }

  async list(request: HeaderSource, view: ArtifactView): Promise<ArtifactDto[]> {
    const actor = await this.actors.requireActor(request);
    const records = await this.artifacts.list({
      view,
      userId: actor.user.id,
      organizationId: actor.organization?.id ?? null,
    });
    return records.map((record) => this.toDto(record, false));
  }

  async getById(request: HeaderSource, id: string): Promise<ArtifactDto> {
    const record = await this.requireReadable(request, id, undefined, "html");
    return this.toDto(record, !this.actors.hasCredentialHeader(request));
  }

  async openContent(request: HeaderSource, id: string, format: ContentFormat, accessToken: unknown): Promise<OpenedArtifactContent> {
    const record = await this.requireReadable(request, id, accessToken, format);
    let stored: { body: AsyncIterable<Uint8Array> };
    try {
      stored = await this.blobs.get(artifactObjectKey(record.id));
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw new ApiErrorException(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.");
      }
      throw error;
    }
    if (format === "html") {
      return { format: "html", sizeBytes: record.sizeBytes, body: stored.body };
    }

    try {
      const bytes = await readBoundedHtml(stored.body);
      const markdown = await convertHtmlToMarkdown(decodeUtf8(bytes));
      return { format: "markdown", body: Buffer.from(markdown, "utf8") };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw new ApiErrorException(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.");
      }
      if (error instanceof BlobStoreUnavailableError || error instanceof ApiErrorException) {
        throw error;
      }
      const conversion = markdownConversionError(error);
      if (conversion) {
        throw conversion;
      }
      this.logger.error("Could not convert artifact HTML to Markdown");
      this.logger.error(error instanceof Error ? error.message : "Unknown conversion error");
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
  }

  private async requireReadable(
    request: HeaderSource,
    id: string,
    accessToken: unknown,
    format: ContentFormat,
  ): Promise<ArtifactRecord> {
    const record = await this.artifacts.findById(id);
    if (!record) {
      throw new ApiErrorException(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.");
    }
    if (this.grantCanRead(request, accessToken, record.id, format)) {
      return record;
    }
    const actor = await this.actors.resolve(request);
    if (!actor || !(await this.canRead(actor, record))) {
      throw new ApiErrorException(404, "ARTIFACT_NOT_FOUND", "Artifact was not found.");
    }
    return record;
  }

  private grantCanRead(request: HeaderSource, accessToken: unknown, artifactId: string, format: ContentFormat): boolean {
    if (format !== "html" || this.actors.hasCredentialHeader(request)) {
      return false;
    }
    return this.grantAllows(accessToken, artifactId);
  }

  private grantAllows(accessToken: unknown, artifactId: string): boolean {
    return typeof accessToken === "string" && accessToken.length > 0 && contentGrantAllows(accessToken, artifactId, this.config.authSecret);
  }

  private async canRead(actor: Actor, record: ArtifactRecord): Promise<boolean> {
    if (actor.user.id === record.creatorUserId) {
      return true;
    }
    if (record.accessType !== "org_shared" || record.organizationId === null) {
      return false;
    }
    const membership = await this.prisma.member.findFirst({
      where: { userId: actor.user.id, organizationId: record.organizationId },
      select: { id: true },
    });
    return membership !== null;
  }

  private toDto(record: ArtifactRecord, includeGrant: boolean): ArtifactDto {
    if (record.uploadedAt === null || record.mimeType !== "text/html") {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
    if (record.accessType !== "private" && record.accessType !== "org_shared") {
      throw new ApiErrorException(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }

    return artifactDtoSchema.parse({
      id: record.id,
      creatorUserId: record.creatorUserId,
      organizationId: record.organizationId,
      accessType: record.accessType,
      // Original upload names are not stored. The DTO filename is the derived object name.
      filename: artifactObjectKey(record.id),
      mimeType: "text/html",
      sizeBytes: record.sizeBytes,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      uploadedAt: record.uploadedAt.toISOString(),
      viewerUrl: `${this.config.webOrigin}/artifacts/${record.id}`,
      contentUrl: includeGrant
        ? grantedContentUrl(this.config.apiPublicOrigin, record.id, this.config.authSecret)
        : artifactContentUrl(this.config.apiPublicOrigin, record.id),
    });
  }

  private async deleteOrphan(id: string, objectKey: string): Promise<void> {
    try {
      const existing = await this.artifacts.findById(id);
      if (existing) {
        return;
      }
    } catch (error) {
      this.logger.error("Could not confirm whether a failed upload inserted an artifact row");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
      return;
    }

    try {
      await this.blobs.delete(objectKey);
    } catch (error) {
      this.logger.error("Could not remove an object after a failed upload");
      this.logger.error(error instanceof Error ? error.message : "Unknown error");
    }
  }
}

export type OpenedArtifactContent =
  | { format: "html"; sizeBytes: number; body: AsyncIterable<Uint8Array> }
  | { format: "markdown"; body: Buffer };

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiErrorException(400, "INVALID_REQUEST", "Artifact HTML is not valid UTF-8.");
  }
}

function markdownConversionError(error: unknown): ApiErrorException | undefined {
  if (!(error instanceof HtmlConversionError) || error.limit === undefined) {
    return undefined;
  }
  if (error.limit === "input") {
    return new ApiErrorException(413, "CONTENT_TOO_LARGE", "HTML exceeds the Markdown conversion limit.");
  }
  if (error.limit === "time") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML took too long to convert to Markdown.");
  }
  if (error.limit === "memory") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML used too much memory to convert to Markdown.");
  }
  if (error.limit === "output") {
    return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "Markdown output exceeds the conversion limit.");
  }
  if (error.limit === "busy") {
    return new ApiErrorException(503, "CONVERSION_UNAVAILABLE", "Markdown conversion is busy. Try again.");
  }
  return new ApiErrorException(422, "CONTENT_TOO_COMPLEX", "HTML is too complex to convert to Markdown.");
}

function formFields(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

function assertNoIdentityFields(body: Record<string, unknown>): void {
  for (const field of IDENTITY_FIELDS) {
    if (Object.hasOwn(body, field)) {
      throw new ApiErrorException(400, "INVALID_REQUEST", "Creator and organization are assigned by the server.");
    }
  }
}

function readAccessType(body: Record<string, unknown>): AccessType {
  if (!Object.hasOwn(body, "accessType")) {
    return "private";
  }
  const parsed = accessTypeSchema.safeParse(body.accessType);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "accessType must be private or org_shared.");
  }
  return parsed.data;
}

function readUpload(file: unknown): { filename: string; bytes: Uint8Array } | undefined {
  if (typeof file !== "object" || file === null) {
    return undefined;
  }
  const record = file as { originalname?: unknown; buffer?: unknown };
  if (typeof record.originalname !== "string" || !Buffer.isBuffer(record.buffer)) {
    return undefined;
  }
  return {
    filename: record.originalname,
    bytes: Uint8Array.from(record.buffer),
  };
}
