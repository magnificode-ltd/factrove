import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ServicesModule } from "../services/services.module.js";
import { ArtifactsController } from "./artifacts.controller.js";
import { ContextController } from "./context.controller.js";
import { OnboardingController } from "./onboarding.controller.js";
import { PublicArtifactsController } from "./public-artifacts.controller.js";

@Module({
  imports: [ServicesModule, AuthModule],
  controllers: [ContextController, ArtifactsController, OnboardingController, PublicArtifactsController],
  exports: [ServicesModule],
})
export class ApiModule {}
