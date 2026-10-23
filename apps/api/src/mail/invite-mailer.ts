import { Inject, Injectable, Logger } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { EMAIL_SENDER, redactSecrets, type EmailSender } from "./email-sender.js";
import { buildInviteEmail, type InviteRecipient } from "./invite-email.js";

@Injectable()
export class InviteMailer {
  private readonly logger = new Logger(InviteMailer.name);

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async sendInvite(recipient: InviteRecipient): Promise<void> {
    const email = recipient.email.trim();
    if (email.length === 0) {
      return;
    }
    const message = buildInviteEmail({
      recipient: { email, name: recipient.name },
      signInUrl: `${this.config.webOrigin}/login`,
      supportEmail: this.config.emailFromAddress,
      logoUrl: this.config.emailLogoUrl,
    });
    try {
      await this.email.send(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      const redacted = redactSecrets(detail, [this.config.brevoApiKey, this.config.smtp?.password]);
      this.logger.error(`Invite email failed for ${email}. ${redacted}`);
    }
  }
}
