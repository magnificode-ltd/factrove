import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { EMAIL_SENDER, emailPurpose, redactSecrets, type EmailSender, type OutboundEmail } from "./email-sender.js";
import { buildInviteEmail, type InviteRecipient } from "./invite-email.js";
import { buildPasswordResetEmail } from "./password-reset-email.js";
import { buildVerificationEmail } from "./verification-email.js";
import { logWithoutThrowing } from "./safe-log.js";

export const INVITE_SEND_CONCURRENCY = 4;
export const INVITE_QUEUE_LIMIT = 100;
export const INVITE_SHUTDOWN_TIMEOUT_MS = 10_000;

type InviteJob = {
  email: string;
  purpose: string;
  run: () => Promise<void>;
};

export type PasswordResetMessage = {
  email: string;
  name: string;
  resetUrl: string;
};

export type VerificationMessage = {
  email: string;
  name: string;
  verifyUrl: string;
};

@Injectable()
export class InviteMailer implements OnApplicationShutdown {
  private readonly logger = new Logger(InviteMailer.name);
  private readonly waiting: InviteJob[] = [];
  private readonly inFlight = new Map<Promise<void>, string>();
  private active = 0;
  private closed = false;

  // Tests lower the shutdown bound. Operators do not set these.
  concurrency = INVITE_SEND_CONCURRENCY;
  shutdownTimeoutMs = INVITE_SHUTDOWN_TIMEOUT_MS;

  constructor(
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async sendInvite(recipient: InviteRecipient): Promise<void> {
    const email = recipient.email.trim();
    if (email.length === 0) {
      return;
    }
    this.enqueue(buildInviteEmail({
      recipient: { email, name: recipient.name },
      signInUrl: `${this.config.webOrigin}/login`,
      supportEmail: this.config.emailFromAddress,
      logoUrl: this.config.emailLogoUrl,
    }));
  }

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    const email = message.email.trim();
    if (email.length === 0) {
      return;
    }
    this.enqueue(buildPasswordResetEmail({
      recipient: { email, name: message.name },
      resetUrl: message.resetUrl,
      supportEmail: this.config.emailFromAddress,
      logoUrl: this.config.emailLogoUrl,
    }));
  }

  async sendVerification(message: VerificationMessage): Promise<void> {
    const email = message.email.trim();
    if (email.length === 0) {
      return;
    }
    this.enqueue(buildVerificationEmail({
      recipient: { email, name: message.name },
      verifyUrl: message.verifyUrl,
      supportEmail: this.config.emailFromAddress,
      logoUrl: this.config.emailLogoUrl,
    }));
  }

  async onApplicationShutdown(): Promise<void> {
    const deadline = Date.now() + this.shutdownTimeoutMs;
    while (this.waiting.length > 0 || this.inFlight.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      this.pump();
      const current = [...this.inFlight.keys()];
      if (current.length === 0) {
        if (this.waiting.length === 0) {
          break;
        }
        await settle(wait(0));
        continue;
      }
      await settle(wait(remaining), Promise.allSettled(current));
    }
    this.closed = true;
    const unfinished = [
      ...this.waiting.map((job) => job.email),
      ...this.inFlight.values(),
    ];
    if (unfinished.length === 0) {
      return;
    }
    logWithoutThrowing(
      (line) => this.logger.error(line),
      `Auth email shutdown left ${unfinished.length} send(s) unfinished: ${unfinished.join(", ")}.`,
    );
  }

  private pump(): void {
    if (this.closed) {
      return;
    }
    const limit = Math.max(1, this.concurrency);
    while (this.active < limit && this.waiting.length > 0) {
      const job = this.waiting.shift();
      if (!job) {
        return;
      }
      this.active += 1;
      let tracked: Promise<void> = Promise.resolve();
      tracked = Promise.resolve()
        .then(() => job.run())
        .then(() => undefined, (error: unknown) => {
          this.reportFailure(job.email, job.purpose, error);
        })
        .then(() => undefined, () => undefined)
        .finally(() => {
          this.active -= 1;
          this.inFlight.delete(tracked);
          this.pump();
        });
      this.inFlight.set(tracked, job.email);
    }
  }

  private enqueue(message: OutboundEmail): void {
    const email = message.to.trim();
    const purpose = emailPurpose(message);
    if (email.length === 0 || this.closed) {
      return;
    }
    if (this.waiting.length >= INVITE_QUEUE_LIMIT) {
      logWithoutThrowing(
        (line) => this.logger.warn(line),
        `${purpose} skipped for ${email}. The send queue is full.`,
      );
      return;
    }
    // The provider call stays in the background. The request already returned.
    this.waiting.push({
      email,
      purpose,
      run: () => this.email.send(message),
    });
    this.pump();
  }

  private reportFailure(email: string, purpose: string, error: unknown): void {
    let message = `${purpose} failed for ${email}.`;
    try {
      const detail = error instanceof Error ? error.message : "request failed";
      const redacted = redactSecrets(detail, [
        this.config.brevoApiKey,
        this.config.smtp?.password,
        this.config.smtp?.user,
      ]);
      message = `${purpose} failed for ${email}. ${redacted}`;
    } catch {
      message = `${purpose} failed for ${email}.`;
    }
    logWithoutThrowing((line) => this.logger.error(line), message);
  }
}

function wait(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return {
    done,
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

async function settle(
  timer: { done: Promise<void>; cancel: () => void },
  until?: Promise<unknown>,
): Promise<void> {
  try {
    await (until === undefined ? timer.done : Promise.race([until, timer.done]));
  } finally {
    timer.cancel();
  }
}
