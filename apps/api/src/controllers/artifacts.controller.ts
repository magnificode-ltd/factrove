import type { IncomingHttpHeaders } from "node:http";
import { Body, CanActivate, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import {
  artifactDtoSchema,
  artifactViewSchema,
  contentFormatSchema,
  shareEnvelopeSchema,
  type ArtifactEnvelope,
  type ArtifactListEnvelope,
  type ContentFormat,
  type ShareEnvelope,
} from "@factrove/contracts";
import { ActorService } from "../auth/actor.service.js";
import { htmlContentHeaders, markdownContentHeaders } from "../rendering/html-policy.js";
import { ApiErrorException } from "../services/api-error.js";
import { ArtifactsService } from "../services/artifacts.service.js";
import { parseHtmlUpload } from "./html-upload.js";
import { jsonBody } from "./json-body.js";
import { streamHtml } from "./stream-html.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

type HeaderRequest = {
  headers: IncomingHttpHeaders;
};

type JsonRequest = HeaderRequest & {
  body?: unknown;
};

// Runs before the multipart parser, so a missing login never buffers the body.
@Injectable()
class RequireActorGuard implements CanActivate {
  constructor(@Inject(ActorService) private readonly actors: ActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.actors.requireCurrentOrganization(context.switchToHttp().getRequest<HeaderRequest>());
    return true;
  }
}

const htmlUpload: NestInterceptor = {
  async intercept(context, next) {
    await parseHtmlUpload(context.switchToHttp().getRequest());
    return next.handle();
  },
};

// private artifacts are readable only by their owner. org_shared artifacts are readable by organization members.
// Missing access returns 404 so an id does not reveal that an artifact exists.
@Controller("artifacts")
export class ArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly artifacts: ArtifactsService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(RequireActorGuard)
  @UseInterceptors(htmlUpload)
  async upload(@Req() request: HeaderRequest, @UploadedFile() file: unknown, @Body() body: unknown): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.upload(request, file, body);
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  // Replaces the current HTML. The same share token keeps serving whatever bytes are stored.
  @Put(":id/content")
  @UseGuards(RequireActorGuard)
  @UseInterceptors(htmlUpload)
  async replaceContent(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @UploadedFile() file: unknown,
    @Body() body: unknown,
  ): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.replaceContent(request, parseArtifactId(id), file, body);
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  // Owner only. Changes the library name. Content, access, and share columns stay put.
  @Patch(":id/name")
  async rename(@Req() request: JsonRequest, @Param("id") id: string): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.rename(request, parseArtifactId(id), () => jsonBody(request));
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  // Owner only. Removes the row and the current HTML object. A missing object still removes the row.
  @Delete(":id")
  @HttpCode(204)
  async remove(@Req() request: HeaderRequest, @Param("id") id: string): Promise<void> {
    await this.artifacts.deleteArtifact(request, parseArtifactId(id));
  }

  // Owner only. private -> org_shared in the caller's current organization. Share columns stay put.
  @Patch(":id")
  async shareWithOrganization(@Req() request: JsonRequest, @Param("id") id: string): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.shareWithOrganization(request, parseArtifactId(id), () => jsonBody(request));
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  @Get()
  async list(@Req() request: HeaderRequest, @Query("view") view: unknown): Promise<ArtifactListEnvelope> {
    const records = await this.artifacts.list(request, parseView(view));
    return { items: records };
  }

  @Get(":id/content")
  async content(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @Query("format") format: unknown,
    @Query("access") access: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const requested = parseContentFormat(format);
    const opened = await this.artifacts.openContent(request, parseArtifactId(id), requested, access);
    if (opened.format === "markdown") {
      for (const [name, value] of markdownContentHeaders(opened.body.byteLength)) {
        response.setHeader(name, value);
      }
      return new StreamableFile(opened.body);
    }
    for (const [name, value] of htmlContentHeaders(this.artifacts.framingOrigins(), opened.sizeBytes)) {
      response.setHeader(name, value);
    }
    return streamHtml(opened.body);
  }

  @Get(":id/share")
  async shareState(@Req() request: HeaderRequest, @Param("id") id: string): Promise<ShareEnvelope> {
    const share = await this.artifacts.shareState(request, parseArtifactId(id));
    return shareEnvelopeSchema.parse({ share });
  }

  // An optional JSON body { password } sets or replaces the link password.
  @Post(":id/share")
  @HttpCode(200)
  async createShare(@Req() request: JsonRequest, @Param("id") id: string): Promise<ShareEnvelope> {
    const share = await this.artifacts.createShare(request, parseArtifactId(id), () => jsonBody(request));
    return shareEnvelopeSchema.parse({ share });
  }

  @Delete(":id/share/password")
  async removeSharePassword(@Req() request: HeaderRequest, @Param("id") id: string): Promise<ShareEnvelope> {
    const share = await this.artifacts.removeSharePassword(request, parseArtifactId(id));
    return shareEnvelopeSchema.parse({ share });
  }

  @Delete(":id/share")
  async revokeShare(@Req() request: HeaderRequest, @Param("id") id: string): Promise<ShareEnvelope> {
    const share = await this.artifacts.revokeShare(request, parseArtifactId(id));
    return shareEnvelopeSchema.parse({ share });
  }

  @Get(":id")
  async detail(@Req() request: HeaderRequest, @Param("id") id: string): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.getById(request, parseArtifactId(id));
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
