import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PublicViewLimiter } from "../sharing/public-view-limit.js";
import { StorageModule } from "../storage/index.js";
import { ArtifactsService } from "./artifacts.service.js";

@Module({
  imports: [StorageModule, AuthModule],
  providers: [
    {
      provide: PublicViewLimiter,
      useFactory: () => new PublicViewLimiter(),
    },
    ArtifactsService,
  ],
  exports: [ArtifactsService, PublicViewLimiter],
})
export class ServicesModule {}
