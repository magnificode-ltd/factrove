import type { IncomingHttpHeaders } from "node:http";
import { Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { createOrganizationResponseSchema, type CreateOrganizationResponse } from "@factrove/contracts";
import { CreateFirstOrganizationService } from "../auth/create-first-organization.js";
import { jsonBody } from "./json-body.js";

type JsonRequest = {
  headers: IncomingHttpHeaders;
  body?: unknown;
};

@Controller("onboarding")
export class OnboardingController {
  constructor(@Inject(CreateFirstOrganizationService) private readonly organizations: CreateFirstOrganizationService) {}

  @Post("organization")
  @HttpCode(201)
  async create(@Req() request: JsonRequest): Promise<CreateOrganizationResponse> {
    const created = await this.organizations.create(request, () => jsonBody(request));
    return createOrganizationResponseSchema.parse(created);
  }
}
