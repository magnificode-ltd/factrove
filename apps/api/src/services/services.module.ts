import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/index.js";
import { API_CONFIG, readApiConfig } from "./api-config.js";
import { ArtifactsService } from "./artifacts.service.js";
import { LocalActorService } from "./local-actor.service.js";

@Module({
  imports: [StorageModule],
  providers: [
    {
      provide: API_CONFIG,
      useFactory: () => readApiConfig(),
    },
    LocalActorService,
    ArtifactsService,
  ],
  exports: [API_CONFIG, LocalActorService, ArtifactsService],
})
export class ServicesModule {}
