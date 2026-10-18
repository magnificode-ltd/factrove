import { Controller, Get, Inject } from "@nestjs/common";
import { contextEnvelopeSchema, healthEnvelopeSchema, type ContextEnvelope, type HealthEnvelope } from "@factrove/contracts";
import { LocalActorService } from "../services/local-actor.service.js";

@Controller()
export class ContextController {
  constructor(@Inject(LocalActorService) private readonly actor: LocalActorService) {}

  @Get("health")
  health(): HealthEnvelope {
    return healthEnvelopeSchema.parse({ status: "ok" });
  }

  @Get("context")
  context(): ContextEnvelope {
    return contextEnvelopeSchema.parse(this.actor.current());
  }
}
