import { Logger } from "@nestjs/common";
import { createTransport as createNodemailerTransport } from "nodemailer";
import type { ApiConfig, SmtpConfig } from "../services/api-config.js";
import { emailPurpose, type EmailSender, type OutboundEmail } from "./email-sender.js";
import { redactSecrets, safeMessageId } from "./redact-secret.js";

const SMTP_TIMEOUT_MS = 10_000;

export type SmtpTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
};

export type SmtpMail = {
  sendMail(message: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ messageId?: string }>;
};

export type SmtpTransportFactory = (options: SmtpTransportOptions) => SmtpMail;

export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly from: Pick<ApiConfig, "emailFromAddress" | "emailFromName">,
    private readonly smtp: SmtpConfig,
    private readonly createTransport: SmtpTransportFactory = openSmtpTransport,
    private readonly log: (message: string) => void = (message) => {
      new Logger(SmtpEmailSender.name).log(message);
    },
  ) {}

  async send(message: OutboundEmail): Promise<void> {
    const transport = this.createTransport({
      host: this.smtp.host,
      port: this.smtp.port,
      secure: this.smtp.secure,
      requireTLS: this.smtp.requireTls,
      ...(this.smtp.user !== null && this.smtp.password !== null
        ? { auth: { user: this.smtp.user, pass: this.smtp.password } }
        : {}),
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    });
    try {
      const result = await transport.sendMail({
        from: { name: this.from.emailFromName, address: this.from.emailFromAddress },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      const messageId = typeof result.messageId === "string"
        ? safeMessageId(result.messageId, [this.smtp.password, this.smtp.user])
        : null;
      const suffix = messageId === null ? "" : ` messageId=${messageId}`;
      this.log(`${emailPurpose(message)} sent to ${message.to}${suffix}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      throw new Error(`SMTP ${emailPurpose(message).toLowerCase()} failed. ${redactSecrets(detail, [this.smtp.password, this.smtp.user])}`);
    }
  }
}

function openSmtpTransport(options: SmtpTransportOptions): SmtpMail {
  // createTransport does not connect. The first network call is sendMail.
  return createNodemailerTransport(options);
}
