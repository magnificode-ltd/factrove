import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ServicesModule } from "../services/services.module.js";
import { ArtifactsController } from "./artifacts.controller.js";
import { ContextController } from "./context.controller.js";

@Module({
  imports: [ServicesModule, AuthModule],
  controllers: [ContextController, ArtifactsController],
  exports: [ServicesModule],
})
export class ApiModule {}
