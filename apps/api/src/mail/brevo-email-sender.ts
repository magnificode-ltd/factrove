import { Logger } from "@nestjs/common";
import type { ApiConfig } from "../services/api-config.js";
import type { EmailSender, OutboundEmail } from "./email-sender.js";
import { redactSecrets, safeMessageId } from "./redact-secret.js";

export const BREVO_TRANSACTIONAL_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

const REQUEST_TIMEOUT_MS = 10_000;

export class BrevoEmailSender implements EmailSender {
  constructor(
    private readonly from: Pick<ApiConfig, "emailFromAddress" | "emailFromName">,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly log: (message: string) => void = (message) => {
      new Logger(BrevoEmailSender.name).log(message);
    },
  ) {}

  async send(message: OutboundEmail): Promise<void> {
    // The transactional key cannot call GET /v3/account. This sender only posts
    // the invite. Startup does not contact Brevo.
    let response: Response;
    try {
      response = await this.fetchImpl(BREVO_TRANSACTIONAL_EMAIL_URL, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
          sender: {
            email: this.from.emailFromAddress,
            name: this.from.emailFromName,
          },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      throw new Error(`Brevo invite email request failed. ${redactSecrets(detail, [this.apiKey])}`);
    }
    if (!response.ok) {
      const detail = await brevoErrorDetail(response, this.apiKey);
      throw new Error(`Brevo rejected the invite email with status ${response.status}.${detail}`);
    }
    const messageId = safeMessageId(await readMessageId(response) ?? "", [this.apiKey]);
    const suffix = messageId === null ? "" : ` messageId=${messageId}`;
    this.log(`Invite email sent to ${message.to}${suffix}`);
  }
}

async function brevoErrorDetail(response: Response, apiKey: string): Promise<string> {
  const text = await response.text().catch(() => "");
  const message = readBrevoMessage(text, apiKey);
  return message.length === 0 ? "" : ` ${message}`;
}

function readBrevoMessage(text: string, apiKey: string): string {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") {
      const flat = body.message.replace(/[\r\n]+/g, " ").trim();
      // Redact before the length cap. A cut through the key would leave a prefix
      // that no longer matches the secret.
      return redactSecrets(flat, [apiKey]).slice(0, 200);
    }
  } catch {
    return "";
  }
  return "";
}

async function readMessageId(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { messageId?: unknown };
    return typeof body.messageId === "string" && body.messageId.length > 0 ? body.messageId : null;
  } catch {
    return null;
  }
}
