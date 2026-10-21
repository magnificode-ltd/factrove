import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PasswordAttemptLimiter } from "../sharing/password-attempt-limit.js";
import { PublicViewLimiter } from "../sharing/public-view-limit.js";
import { ShareTicketLedger } from "../sharing/share-grant.js";
import { StorageModule } from "../storage/index.js";
import { ArtifactsService } from "./artifacts.service.js";

@Module({
  imports: [StorageModule, AuthModule],
  providers: [
    {
      provide: PublicViewLimiter,
      useFactory: () => new PublicViewLimiter(),
    },
    {
      provide: PasswordAttemptLimiter,
      useFactory: () => new PasswordAttemptLimiter(),
    },
    {
      provide: ShareTicketLedger,
      useFactory: () => new ShareTicketLedger(),
    },
    ArtifactsService,
  ],
  exports: [ArtifactsService, PublicViewLimiter, PasswordAttemptLimiter, ShareTicketLedger],
})
export class ServicesModule {}
