import { Logger } from "@nestjs/common";

export const BREVO_CLIENT = Symbol("BREVO_CLIENT");

export const BREVO_TRANSACTIONAL_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

const REQUEST_TIMEOUT_MS = 10_000;

export type TransactionalEmail = {
  sender: { email: string; name: string };
  to: { email: string; name: string };
  subject: string;
  textContent: string;
  htmlContent: string;
};

export type SendTransactionalEmailResult = {
  messageId: string | null;
  delivered: boolean;
};

export interface BrevoClient {
  sendTransactionalEmail(email: TransactionalEmail): Promise<SendTransactionalEmailResult>;
}

export type BrevoClientOptions = {
  apiKey: string | null;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
};

export function createBrevoClient(options: BrevoClientOptions): BrevoClient {
  const apiKey = options.apiKey?.trim() ?? "";
  if (apiKey.length === 0) {
    const log = options.log ?? ((message: string) => {
      new Logger("BrevoClient").log(message);
    });
    return new LoggingBrevoClient(log);
  }
  return new HttpBrevoClient(apiKey, options.fetchImpl ?? fetch);
}

export function redactSecret(message: string, secret: string | null): string {
  if (secret === null || secret.length === 0) {
    return message;
  }
  return message.split(secret).join("[redacted]");
}

class LoggingBrevoClient implements BrevoClient {
  constructor(private readonly log: (message: string) => void) {}

  sendTransactionalEmail(email: TransactionalEmail): Promise<SendTransactionalEmailResult> {
    this.log([
      "Brevo API key is unset. Invite email was not sent.",
      `From: ${email.sender.name} <${email.sender.email}>`,
      `To: ${email.to.name} <${email.to.email}>`,
      `Subject: ${email.subject}`,
      email.textContent,
    ].join("\n"));
    return Promise.resolve({ messageId: null, delivered: false });
  }
}

class HttpBrevoClient implements BrevoClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async sendTransactionalEmail(email: TransactionalEmail): Promise<SendTransactionalEmailResult> {
    // The transactional key cannot call GET /v3/account. This client only posts
    // the invite to the SMTP endpoint. Startup does not contact Brevo.
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
          sender: email.sender,
          to: [{ email: email.to.email, name: email.to.name }],
          subject: email.subject,
          textContent: email.textContent,
          htmlContent: email.htmlContent,
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      throw new Error(`Brevo invite email request failed. ${redactSecret(detail, this.apiKey)}`);
    }
    if (!response.ok) {
      const detail = await brevoErrorDetail(response, this.apiKey);
      throw new Error(`Brevo rejected the invite email with status ${response.status}.${detail}`);
    }
    return { messageId: await readMessageId(response), delivered: true };
  }
}

async function brevoErrorDetail(response: Response, apiKey: string): Promise<string> {
  const text = await response.text().catch(() => "");
  const message = redactSecret(readBrevoMessage(text), apiKey);
  return message.length === 0 ? "" : ` ${message}`;
}

function readBrevoMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { message?: unknown };
    if (typeof body.message === "string") {
      return body.message.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
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
