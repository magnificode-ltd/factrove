import { Module } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { createBrevoClient, BREVO_CLIENT } from "./brevo-client.js";
import { InviteMailer } from "./invite-mailer.js";

@Module({
  providers: [
    {
      provide: BREVO_CLIENT,
      useFactory: (config: ApiConfig) => createBrevoClient({ apiKey: config.brevoApiKey }),
      inject: [API_CONFIG],
    },
    InviteMailer,
  ],
  exports: [InviteMailer],
})
export class MailModule {}
