import { Logger } from "@nestjs/common";
import type { ApiConfig } from "../services/api-config.js";
import { BrevoEmailSender } from "./brevo-email-sender.js";
import { redactSecrets } from "./redact-secret.js";
import { SmtpEmailSender, type SmtpTransportFactory } from "./smtp-email-sender.js";

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailSender {
  send(message: OutboundEmail): Promise<void>;
}

export type EmailSenderDeps = {
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  createTransport?: SmtpTransportFactory;
};

export function createEmailSender(config: ApiConfig, deps: EmailSenderDeps = {}): EmailSender {
  const log = deps.log ?? ((message: string) => {
    new Logger("EmailSender").log(message);
  });
  if (config.emailTransport === "smtp") {
    if (config.smtp === null) {
      throw new Error("SMTP settings are missing.");
    }
    return new SmtpEmailSender(config, config.smtp, deps.createTransport, log);
  }
  if (config.emailTransport === "brevo") {
    if (config.brevoApiKey === null) {
      throw new Error("BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo.");
    }
    return new BrevoEmailSender(config, config.brevoApiKey, deps.fetchImpl ?? fetch, log);
  }
  return new LogEmailSender(config, log);
}

export class LogEmailSender implements EmailSender {
  constructor(
    private readonly from: Pick<ApiConfig, "emailFromAddress" | "emailFromName">,
    private readonly log: (message: string) => void,
  ) {}

  send(message: OutboundEmail): Promise<void> {
    this.log([
      "EMAIL_TRANSPORT is log. Invite email was not sent.",
      `From: ${this.from.emailFromName} <${this.from.emailFromAddress}>`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      message.text,
    ].join("\n"));
    return Promise.resolve();
  }
}

export { redactSecrets };
