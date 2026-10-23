import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { ActorService } from "./actor.service.js";
import { AuthService } from "./auth.service.js";

@Module({
  imports: [MailModule],
  providers: [AuthService, ActorService],
  exports: [AuthService, ActorService],
})
export class AuthModule {}
