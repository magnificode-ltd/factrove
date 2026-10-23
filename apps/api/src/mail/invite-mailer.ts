import { Inject, Injectable, Logger } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { BREVO_CLIENT, redactSecret, type BrevoClient } from "./brevo-client.js";
import { buildInviteEmail, type InviteRecipient } from "./invite-email.js";

@Injectable()
export class InviteMailer {
  private readonly logger = new Logger(InviteMailer.name);

  constructor(
    @Inject(BREVO_CLIENT) private readonly brevo: BrevoClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async sendInvite(recipient: InviteRecipient): Promise<void> {
    const email = recipient.email.trim();
    if (email.length === 0) {
      return;
    }
    const message = buildInviteEmail({
      recipient: { email, name: recipient.name },
      sender: {
        email: this.config.brevoSenderEmail,
        name: this.config.brevoSenderName,
      },
      signInUrl: `${this.config.webOrigin}/login`,
    });
    try {
      const result = await this.brevo.sendTransactionalEmail(message);
      if (result.delivered) {
        const messageId = result.messageId ?? "none";
        this.logger.log(`Invite email sent to ${email} messageId=${messageId}`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      this.logger.error(`Invite email failed for ${email}. ${redactSecret(detail, this.config.brevoApiKey)}`);
    }
  }
}
