import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { LogEmailSender } from "../src/mail/email-sender.js";
import { INVITE_QUEUE_LIMIT, InviteMailer } from "../src/mail/invite-mailer.js";
import {
  buildOrganizationInviteEmail,
  ORGANIZATION_INVITE_PURPOSE,
  organizationInviteSubject,
} from "../src/mail/organization-invite-email.js";
import type { ApiConfig } from "../src/services/api-config.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL1";
const ACCEPT_URL = `http://localhost:3000/invites/accept?token=${TOKEN}`;

describe("organization invitation email", () => {
  it("escapes the organization and inviter and keeps the token out of the subject", () => {
    const message = buildOrganizationInviteEmail({
      email: "ada+lab@example.com",
      organizationName: "A<B> & Co",
      inviterName: "Ada <script>",
      expiresAt: new Date("2026-12-01T15:04:00.000Z"),
      acceptUrl: ACCEPT_URL,
      supportEmail: "library@example.com",
      siteUrl: "http://localhost:3000",
      logoUrl: null,
    });
    expect(message.purpose).toBe(ORGANIZATION_INVITE_PURPOSE);
    expect(message.subject).toBe(organizationInviteSubject("A<B> & Co"));
    expect(message.subject).not.toContain(TOKEN);
    expect(message.html).toContain("A&lt;B&gt; &amp; Co");
    expect(message.html).toContain("Ada &lt;script&gt;");
    expect(message.html).not.toContain("A<B>");
    expect(message.html).not.toContain("Ada <script>");
    expect(message.text).toContain(ACCEPT_URL);
    expect(message.text).toContain("1 December 2026, 15:04 UTC");
    expect(message.html).toContain("1 December 2026, 15:04 UTC");
  });

  it("redacts the invite query in the log unless full links are enabled outside production", () => {
    const message = buildOrganizationInviteEmail({
      email: "ada@example.com",
      organizationName: "Ada Lab",
      inviterName: "Ada",
      expiresAt: new Date("2026-12-01T15:04:00.000Z"),
      acceptUrl: ACCEPT_URL,
      supportEmail: "library@example.com",
      siteUrl: "http://localhost:3000",
      logoUrl: null,
    });
    const redacted: string[] = [];
    new LogEmailSender(config(false), (line) => redacted.push(line)).send(message);
    expect(redacted.join("\n")).toContain("Organization invitation was not sent.");
    expect(redacted.join("\n")).toContain("http://localhost:3000/invites/accept?[redacted]");
    expect(redacted.join("\n")).not.toContain(TOKEN);

    const full: string[] = [];
    new LogEmailSender(config(true), (line) => full.push(line)).send(message);
    expect(full.join("\n")).toContain(ACCEPT_URL);
  });

  it("returns false when the queue is full and does not log the token", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => gate,
    }, config(false));
    mailer.concurrency = 1;
    const lines: string[] = [];
    const warn = Logger.prototype.warn;
    Logger.prototype.warn = function (message: unknown) {
      lines.push(String(message));
      return this;
    };
    try {
      for (let index = 0; index < INVITE_QUEUE_LIMIT + 1; index += 1) {
        await mailer.sendInvite({ email: `user${index}@example.com`, name: "Ada" });
      }
      const queued = mailer.trySendOrganizationInvite({
        email: "ada@example.com",
        organizationName: "Ada Lab",
        inviterName: "Ada",
        expiresAt: new Date("2026-12-01T15:04:00.000Z"),
        acceptUrl: ACCEPT_URL,
      });
      expect(queued).toBe(false);
      expect(lines.join("\n")).toContain("Organization invitation skipped for ada@example.com. The send queue is full.");
      expect(lines.join("\n")).not.toContain(TOKEN);
    } finally {
      Logger.prototype.warn = warn;
      release();
    }
  });

  it("redacts the provider error and the invitation token", async () => {
    const mailer = new InviteMailer({
      async send() {
        throw new Error(`smtp rejected ${ACCEPT_URL} token ${TOKEN}`);
      },
    }, config(false));
    const lines: string[] = [];
    const error = Logger.prototype.error;
    Logger.prototype.error = function (message: unknown) {
      lines.push(String(message));
      return this;
    };
    try {
      expect(mailer.trySendOrganizationInvite({
        email: "ada@example.com",
        organizationName: "Ada Lab",
        inviterName: "Ada",
        expiresAt: new Date("2026-12-01T15:04:00.000Z"),
        acceptUrl: ACCEPT_URL,
      })).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const logged = lines.join("\n");
      expect(logged).toContain("Organization invitation failed for ada@example.com.");
      expect(logged).toContain("[redacted]");
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain(ACCEPT_URL);
    } finally {
      Logger.prototype.error = error;
    }
  });
});

function config(emailLogFullLinks: boolean): ApiConfig {
  return {
    host: "127.0.0.1",
    port: 3001,
    webOrigin: "http://localhost:3000",
    apiPublicOrigin: "http://localhost:3001",
    publicBaseUrl: "http://localhost:3000",
    authSecret: TEST_AUTH_SECRET,
    authCookieDomain: null,
    trustedProxies: [],
    shareTokenKey: null,
    turnstileSecret: null,
    emailTransport: "log",
    emailFromAddress: "library@example.com",
    emailFromName: "Factrove",
    emailLogoUrl: null,
    brevoApiKey: null,
    smtp: null,
    emailLogFullLinks,
  };
}
