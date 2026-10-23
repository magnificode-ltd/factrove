import { Module } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { createEmailSender, EMAIL_SENDER } from "./email-sender.js";
import { InviteMailer } from "./invite-mailer.js";

@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      useFactory: (config: ApiConfig) => createEmailSender(config),
      inject: [API_CONFIG],
    },
    InviteMailer,
  ],
  exports: [InviteMailer],
})
export class MailModule {}
