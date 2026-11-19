import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { ActorService } from "./actor.service.js";
import { AuthService } from "./auth.service.js";
import { CreateFirstOrganizationService } from "./create-first-organization.js";

@Module({
  imports: [MailModule],
  providers: [AuthService, ActorService, CreateFirstOrganizationService],
  exports: [AuthService, ActorService, CreateFirstOrganizationService],
})
export class AuthModule {}
