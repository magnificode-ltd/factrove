import type { IncomingHttpHeaders } from "node:http";
import { Transform } from "node:stream";
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseInterceptors, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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
import { htmlContentHeaders, markdownContentHeaders, MAX_HTML_BYTES, multipartFilenameParameter } from "../rendering/html-policy.js";
import { ApiErrorException } from "../services/api-error.js";
import { ArtifactsService } from "../services/artifacts.service.js";
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

type MultipartRequest = HeaderRequest & {
  pipe: (destination: NodeJS.WritableStream, options?: { end?: boolean }) => NodeJS.WritableStream;
  multipartChunks?: Buffer[];
};

// Records the file part's bytes so the upload can see whether the header used filename*.
@Injectable()
class CaptureMultipartFilename implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<MultipartRequest>();
    const chunks: Buffer[] = [];
    request.multipartChunks = chunks;
    const originalPipe = request.pipe.bind(request);
    request.pipe = (destination, options) => {
      const tee = new Transform({
        transform(chunk: Buffer | string, _encoding, callback) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          callback(null, chunk);
        },
      });
      originalPipe(tee);
      return tee.pipe(destination, options);
    };
    return next.handle();
  }
}

const htmlUpload = FileInterceptor("file", {
  limits: {
    // Busboy emits its limit when the buffered size reaches this ceiling.
    fileSize: MAX_HTML_BYTES + 1,
    files: 2,
    fields: 8,
    fieldSize: 1024,
    parts: 12,
  },
  fileFilter(req, file, callback) {
    const request = req as MultipartRequest;
    const header = request.headers["content-type"];
    const contentType = Array.isArray(header) ? header[0] : header;
    const parameter = multipartFilenameParameter(Buffer.concat(request.multipartChunks ?? []), contentType);
    Object.assign(file, { filenameParameter: parameter });
    callback(null, true);
  },
});

// private artifacts are readable only by their owner. org_shared artifacts are readable by organization members.
// Missing access returns 404 so an id does not reveal that an artifact exists.
@Controller("artifacts")
export class ArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly artifacts: ArtifactsService) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(CaptureMultipartFilename, htmlUpload)
  async upload(@Req() request: HeaderRequest, @UploadedFile() file: unknown, @Body() body: unknown): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.upload(request, file, body);
    return { artifact: artifactDtoSchema.parse(artifact) };
  }

  // Replaces the current HTML. The same share token keeps serving whatever bytes are stored.
  @Put(":id/content")
  @UseInterceptors(CaptureMultipartFilename, htmlUpload)
  async replaceContent(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @UploadedFile() file: unknown,
    @Body() body: unknown,
  ): Promise<ArtifactEnvelope> {
    const artifact = await this.artifacts.replaceContent(request, parseArtifactId(id), file, body);
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
