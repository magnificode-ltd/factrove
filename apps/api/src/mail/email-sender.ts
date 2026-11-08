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
  // Log prefix. Invite messages omit it and stay "Invite email".
  purpose?: string;
};

export function emailPurpose(message: OutboundEmail): string {
  const purpose = message.purpose?.replace(/[\r\n]+/g, " ").trim() ?? "";
  return purpose.length > 0 ? purpose.slice(0, 80) : "Invite email";
}

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
    private readonly from: Pick<ApiConfig, "emailFromAddress" | "emailFromName" | "emailLogFullLinks">,
    private readonly log: (message: string) => void,
  ) {}

  send(message: OutboundEmail): Promise<void> {
    const text = this.from.emailLogFullLinks ? message.text : redactLoggedEmailText(message.text);
    this.log([
      `EMAIL_TRANSPORT is log. ${emailPurpose(message)} was not sent.`,
      `From: ${this.from.emailFromName} <${this.from.emailFromAddress}>`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      text,
    ].join("\n"));
    return Promise.resolve();
  }
}

// The log transport is the default, including in production. Query strings on
// links can be reset tokens, so they are replaced unless a dev-only flag is set.
export function redactLoggedEmailText(text: string): string {
  return text.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (raw) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      const query = raw.indexOf("?");
      return query === -1 ? raw : `${raw.slice(0, query)}?[redacted]`;
    }
    if (url.search.length === 0 && url.hash.length === 0) {
      return raw;
    }
    url.search = "";
    url.hash = "";
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.origin}${path}?[redacted]`;
  });
}

export { redactSecrets };
