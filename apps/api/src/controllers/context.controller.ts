import type { IncomingHttpHeaders } from "node:http";
import { Controller, Get, Inject, Req } from "@nestjs/common";
import { contextEnvelopeSchema, healthEnvelopeSchema, type ContextEnvelope, type HealthEnvelope } from "@factrove/contracts";
import { ActorService } from "../auth/actor.service.js";

type HeaderRequest = {
  headers: IncomingHttpHeaders;
};

@Controller()
export class ContextController {
  constructor(@Inject(ActorService) private readonly actors: ActorService) {}

  @Get("health")
  health(): HealthEnvelope {
    return healthEnvelopeSchema.parse({ status: "ok" });
  }

  @Get("context")
  async context(@Req() request: HeaderRequest): Promise<ContextEnvelope> {
    const actor = await this.actors.requireCurrentOrganization(request);
    return contextEnvelopeSchema.parse({ user: actor.user, organization: actor.organization });
  }
}
