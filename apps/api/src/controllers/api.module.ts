import { Module } from "@nestjs/common";
import { ServicesModule } from "../services/services.module.js";
import { ArtifactsController } from "./artifacts.controller.js";
import { ContextController } from "./context.controller.js";

@Module({
  imports: [ServicesModule],
  controllers: [ContextController, ArtifactsController],
  exports: [ServicesModule],
})
export class ApiModule {}
