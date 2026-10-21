import type { IncomingHttpHeaders } from "node:http";
import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, StreamableFile } from "@nestjs/common";
import {
  publicArtifactEnvelopeSchema,
  publicUnlockEnvelopeSchema,
  SHARE_GRANT_HEADER,
  type PublicArtifactEnvelope,
  type PublicUnlockEnvelope,
} from "@factrove/contracts";
import { readAssignedClientIp } from "../auth/client-ip.js";
import { htmlContentHeaders } from "../rendering/html-policy.js";
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

// Anonymous HTML for an explicit public share. Unknown, unshared, and revoked tokens are the same 404.
// A password-protected share answers a matching token with 401 PASSWORD_REQUIRED until the visitor
// presents an unlock grant in the x-factrove-share-grant header.
@Controller("public/artifacts")
export class PublicArtifactsController {
  constructor(@Inject(ArtifactsService) private readonly artifacts: ArtifactsService) {}

  @Get(":id/:token/content")
  async content(
    @Req() request: HeaderRequest,
    @Param("id") id: string,
    @Param("token") token: string,
    @Query("ticket") ticket: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): Promise<StreamableFile> {
    const opened = await this.artifacts.openPublicContent(id, token, readAssignedClientIp(request.headers), ticket);
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
    const artifact = await this.artifacts.openPublic(
      id,
      token,
      readAssignedClientIp(request.headers),
      request.headers[SHARE_GRANT_HEADER],
    );
    return publicArtifactEnvelopeSchema.parse({ artifact });
  }

  @Post(":id/:token/unlock")
  @HttpCode(200)
  async unlock(
    @Req() request: JsonRequest,
    @Param("id") id: string,
    @Param("token") token: string,
  ): Promise<PublicUnlockEnvelope> {
    const unlocked = await this.artifacts.unlockPublic(
      id,
      token,
      readAssignedClientIp(request.headers),
      () => jsonBody(request),
    );
    return publicUnlockEnvelopeSchema.parse(unlocked);
  }
}
