import type { IncomingHttpHeaders } from "node:http";
import { Controller, Get, Inject, Param, Req, Res, StreamableFile } from "@nestjs/common";
import { publicArtifactEnvelopeSchema, type PublicArtifactEnvelope } from "@factrove/contracts";
import { readAssignedClientIp } from "../auth/client-ip.js";
import { htmlContentHeaders } from "../rendering/html-policy.js";
import { ArtifactsService } from "../services/artifacts.service.js";
import { streamHtml } from "./stream-html.js";

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

type HeaderRequest = {
  headers: IncomingHttpHeaders;
};

// Anonymous HTML for an explicit public share. Unknown, unshared, and revoked tokens are the same 404.
@Controller("public/artifacts")
export class PublicArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly artifacts: ArtifactsService) {}

  @Get(":id/:token/content")
  async content(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @Param("token") token: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const opened = await this.artifacts.openPublicContent(id, token, readAssignedClientIp(request.headers));
    for (const [name, value] of htmlContentHeaders(this.artifacts.framingOrigins(), opened.sizeBytes)) {
      response.setHeader(name, value);
    }
    return streamHtml(opened.body);
  }

  @Get(":id/:token")
  async detail(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @Param("token") token: string,
  ): Promise<PublicArtifactEnvelope> {
    const artifact = await this.artifacts.openPublic(id, token, readAssignedClientIp(request.headers));
    return publicArtifactEnvelopeSchema.parse({ artifact });
  }
}
