import type { IncomingHttpHeaders } from "node:http";
import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req } from "@nestjs/common";
import {
  createOrganizationResponseSchema,
  invitationEnvelopeSchema,
  invitationListSchema,
  invitationPreviewSchema,
  type CreateOrganizationResponse,
  type InvitationEnvelope,
  type InvitationList,
  type InvitationPreview,
} from "@factrove/contracts";
import { OrganizationMembershipService } from "../services/organization-membership.service.js";
import { jsonBody } from "./json-body.js";

type JsonRequest = {
  headers: IncomingHttpHeaders;
  body?: unknown;
};

@Controller()
export class OrganizationController {
  constructor(@Inject(OrganizationMembershipService) private readonly membership: OrganizationMembershipService) {}

  @Get("organization/invitations")
  async list(
    @Req() request: JsonRequest,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ): Promise<InvitationList> {
    const page = await this.membership.list(request, { limit, cursor });
    return invitationListSchema.parse(page);
  }

  @Post("organization/invitations")
  @HttpCode(201)
  async create(@Req() request: JsonRequest): Promise<InvitationEnvelope> {
    const created = await this.membership.create(request, jsonBody(request));
    return invitationEnvelopeSchema.parse(created);
  }

  @Post("organization/invitations/:id/resend")
  @HttpCode(200)
  async resend(@Req() request: JsonRequest, @Param("id") id: string): Promise<InvitationEnvelope> {
    const resent = await this.membership.resend(request, id);
    return invitationEnvelopeSchema.parse(resent);
  }

  @Delete("organization/invitations/:id")
  @HttpCode(204)
  async revoke(@Req() request: JsonRequest, @Param("id") id: string): Promise<void> {
    await this.membership.revoke(request, id);
  }

  @Post("invitations/preview")
  @HttpCode(200)
  async preview(@Req() request: JsonRequest): Promise<InvitationPreview> {
    const preview = await this.membership.preview(request, jsonBody(request));
    return invitationPreviewSchema.parse(preview);
  }

  @Post("invitations/accept")
  @HttpCode(200)
  async accept(@Req() request: JsonRequest): Promise<CreateOrganizationResponse> {
    const accepted = await this.membership.accept(request, jsonBody(request));
    return createOrganizationResponseSchema.parse(accepted);
  }
}
