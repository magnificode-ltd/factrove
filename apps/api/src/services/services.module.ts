import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StorageModule } from "../storage/index.js";
import { ArtifactsService } from "./artifacts.service.js";

@Module({
  imports: [StorageModule, AuthModule],
  providers: [ArtifactsService],
  exports: [ArtifactsService],
})
export class ServicesModule {}
