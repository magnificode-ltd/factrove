import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { EMAIL_SENDER, redactSecrets, type EmailSender } from "./email-sender.js";
import { buildInviteEmail, type InviteRecipient } from "./invite-email.js";
import { logWithoutThrowing } from "./safe-log.js";

export const INVITE_SEND_CONCURRENCY = 4;
export const INVITE_SHUTDOWN_TIMEOUT_MS = 10_000;

type InviteJob = {
  email: string;
  run: () => Promise<void>;
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
    if (email.length === 0 || this.closed) {
      return;
    }
    const message = buildInviteEmail({
      recipient: { email, name: recipient.name },
      signInUrl: `${this.config.webOrigin}/login`,
      supportEmail: this.config.emailFromAddress,
      logoUrl: this.config.emailLogoUrl,
    });
    // The provider call stays in the background. Sign-up already returned.
    this.waiting.push({
      email,
      run: () => this.email.send(message),
    });
    this.pump();
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
        await wait(0);
        continue;
      }
      await Promise.race([
        Promise.allSettled(current),
        wait(remaining),
      ]);
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
      `Invite email shutdown left ${unfinished.length} send(s) unfinished: ${unfinished.join(", ")}.`,
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
          this.reportFailure(job.email, error);
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

  private reportFailure(email: string, error: unknown): void {
    let message = `Invite email failed for ${email}.`;
    try {
      const detail = error instanceof Error ? error.message : "request failed";
      const redacted = redactSecrets(detail, [
        this.config.brevoApiKey,
        this.config.smtp?.password,
        this.config.smtp?.user,
      ]);
      message = `Invite email failed for ${email}. ${redacted}`;
    } catch {
      message = `Invite email failed for ${email}.`;
    }
    logWithoutThrowing((line) => this.logger.error(line), message);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
