import "reflect-metadata";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { createAuth } from "../src/auth/create-auth.js";
import { PrismaService } from "../src/database/index.js";
import { BrevoEmailSender, BREVO_TRANSACTIONAL_EMAIL_URL } from "../src/mail/brevo-email-sender.js";
import {
  createEmailSender,
  EMAIL_SENDER,
  LogEmailSender,
  type OutboundEmail,
} from "../src/mail/email-sender.js";
import { buildInviteEmail, INVITE_EMAIL_SUBJECT } from "../src/mail/invite-email.js";
import { INVITE_QUEUE_LIMIT, InviteMailer } from "../src/mail/invite-mailer.js";
import { SmtpEmailSender, type SmtpMail, type SmtpTransportOptions } from "../src/mail/smtp-email-sender.js";
import {
  API_CONFIG,
  DEFAULT_EMAIL_FROM_ADDRESS,
  DEFAULT_EMAIL_FROM_NAME,
  readApiConfig,
  type ApiConfig,
} from "../src/services/api-config.js";
import { BLOB_STORE } from "../src/storage/blob-store.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

const PLUS_EMAIL = "magnificode+factrove@mail.grokbot.com";
const FAKE_KEY = "xkeysib-test-key-not-real";
const SMTP_PASSWORD = "smtp-secret-not-real";

describe("email configuration", () => {
  it("defaults to the log transport and ignores leftover provider secrets", () => {
    const config = readApiConfig(authEnv({
      BREVO_API_KEY: FAKE_KEY,
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "mailer",
      SMTP_PASSWORD,
    }));
    expect(config.emailTransport).toBe("log");
    expect(config.emailFromAddress).toBe(DEFAULT_EMAIL_FROM_ADDRESS);
    expect(config.emailFromAddress).toBe("support@factrove.app");
    expect(config.emailFromName).toBe(DEFAULT_EMAIL_FROM_NAME);
    expect(config.emailFromName).toBe("Factrove");
    expect(config.emailLogoUrl).toBeNull();
    expect(config.brevoApiKey).toBeNull();
    expect(config.smtp).toBeNull();
    expect(JSON.stringify(config)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(config)).not.toContain(SMTP_PASSWORD);
  });

  it("treats blank, empty, and log as the log transport", () => {
    for (const transport of [undefined, "", "   ", "log", "LOG", " Log "]) {
      expect(readApiConfig(authEnv({ EMAIL_TRANSPORT: transport })).emailTransport).toBe("log");
    }
  });

  it("requires a Brevo key only for the brevo transport and does not keep SMTP settings", () => {
    expect(() => readApiConfig(authEnv({ EMAIL_TRANSPORT: "brevo" }))).toThrow(
      "BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo.",
    );
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "Brevo",
      BREVO_API_KEY: "   ",
    }))).toThrow("BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo.");
    const config = readApiConfig(authEnv({
      EMAIL_TRANSPORT: "brevo",
      BREVO_API_KEY: `  ${FAKE_KEY}  `,
      SMTP_PASSWORD,
    }));
    expect(config.emailTransport).toBe("brevo");
    expect(config.brevoApiKey).toBe(FAKE_KEY);
    expect(config.smtp).toBeNull();
    expect(JSON.stringify(config)).not.toContain(SMTP_PASSWORD);
  });

  it("accepts a plus-address as the from address and rejects a bad from name", () => {
    expect(readApiConfig(authEnv({
      EMAIL_FROM_ADDRESS: "  support+notify@factrove.app  ",
      EMAIL_FROM_NAME: " Factrove ",
    })).emailFromAddress).toBe("support+notify@factrove.app");
    expect(readApiConfig(authEnv({
      EMAIL_FROM_ADDRESS: PLUS_EMAIL,
    })).emailFromAddress).toBe(PLUS_EMAIL);
    expect(() => readApiConfig(authEnv({
      EMAIL_FROM_ADDRESS: "not-an-email",
    }))).toThrow("EMAIL_FROM_ADDRESS must be an email address.");
    expect(() => readApiConfig(authEnv({
      EMAIL_FROM_NAME: "Factrove\nOps",
    }))).toThrow("EMAIL_FROM_NAME must be one line of 1 to 70 characters.");
    expect(readApiConfig(authEnv({
      EMAIL_FROM_NAME: "F".repeat(70),
    })).emailFromName).toHaveLength(70);
    expect(() => readApiConfig(authEnv({
      EMAIL_FROM_NAME: "F".repeat(71),
    }))).toThrow("EMAIL_FROM_NAME must be one line of 1 to 70 characters.");
  });

  it("rejects an unknown transport before listen", () => {
    expect(() => readApiConfig(authEnv({ EMAIL_TRANSPORT: "sendgrid" }))).toThrow(
      "EMAIL_TRANSPORT must be log, smtp, or brevo.",
    );
  });

  it("keeps a logo URL only when it is an absolute http(s) address", () => {
    expect(readApiConfig(authEnv({ EMAIL_LOGO_URL: "  " })).emailLogoUrl).toBeNull();
    expect(readApiConfig(authEnv({
      EMAIL_LOGO_URL: " https://cdn.example.com/factrove.png ",
    })).emailLogoUrl).toBe("https://cdn.example.com/factrove.png");
    expect(() => readApiConfig(authEnv({ EMAIL_LOGO_URL: "not-a-url" }))).toThrow(
      "EMAIL_LOGO_URL must be an absolute HTTP(S) URL.",
    );
    expect(() => readApiConfig(authEnv({
      EMAIL_LOGO_URL: "https://user:secret@cdn.example.com/logo.png",
    }))).toThrow("EMAIL_LOGO_URL must not include credentials.");
  });

  it("requires host, port, and secure for smtp and keeps auth as a pair", () => {
    expect(() => readApiConfig(authEnv({ EMAIL_TRANSPORT: "smtp" }))).toThrow(
      "Set SMTP_HOST, SMTP_PORT, SMTP_SECURE when EMAIL_TRANSPORT is smtp.",
    );
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
    }))).toThrow("Set SMTP_SECURE when EMAIL_TRANSPORT is smtp.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "SMTP",
      SMTP_HOST: "mail example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
    }))).toThrow("SMTP_HOST must be a hostname or IP address.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com/path",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
    }))).toThrow("SMTP_HOST must be a hostname or IP address.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "yes",
    }))).toThrow("SMTP_SECURE must be true or false.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "0",
      SMTP_SECURE: "false",
    }))).toThrow("SMTP_PORT must be an integer from 1 to 65535.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "mailer",
    }))).toThrow("Set SMTP_USER and SMTP_PASSWORD together when EMAIL_TRANSPORT is smtp.");
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_PASSWORD,
    }))).toThrow("Set SMTP_USER and SMTP_PASSWORD together when EMAIL_TRANSPORT is smtp.");

    const open = readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: " mail.example.com ",
      SMTP_PORT: "587",
      SMTP_SECURE: "FALSE",
      BREVO_API_KEY: FAKE_KEY,
    }));
    expect(open.emailTransport).toBe("smtp");
    expect(open.brevoApiKey).toBeNull();
    expect(open.smtp).toEqual({
      host: "mail.example.com",
      port: 587,
      secure: false,
      requireTls: true,
      user: null,
      password: null,
    });
    expect(JSON.stringify(open)).not.toContain(FAKE_KEY);

    const authed = readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp-relay.brevo.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "True",
      SMTP_USER: "  login  ",
      SMTP_PASSWORD: `  ${SMTP_PASSWORD}  `,
    }));
    expect(authed.smtp).toEqual({
      host: "smtp-relay.brevo.com",
      port: 465,
      secure: true,
      requireTls: false,
      user: "login",
      password: `  ${SMTP_PASSWORD}  `,
    });
    expect(readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false",
    })).smtp?.requireTls).toBe(false);
    expect(() => readApiConfig(authEnv({
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "mail.example.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "yes",
    }))).toThrow("SMTP_REQUIRE_TLS must be true or false.");
  });
});

describe("invite email", () => {
  const signInUrl = "http://localhost:3000/login";

  it("keeps a plus-address in the text and the HTML", () => {
    const message = buildInviteEmail({
      recipient: { email: `  ${PLUS_EMAIL}  `, name: " Ada Lovelace " },
      signInUrl,
      supportEmail: "support@factrove.app",
    });
    expect(message).toMatchObject({
      to: PLUS_EMAIL,
      subject: INVITE_EMAIL_SUBJECT,
    });
    expect(message.subject).toBe("Welcome to Factrove");
    expect(message.text).toContain("Welcome to Factrove");
    expect(message.text).toContain(`Hi Ada Lovelace,\nYour Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.html).toContain(`Hi Ada Lovelace,<br>Your Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.text).toContain("Sign in to Factrove:");
    expect(message.text).toContain(signInUrl);
    expect(message.text).toContain("Contact support@factrove.app if you need help.");
    expect(message.text).toContain("Factrove: https://factrove.app");
    expect(message.text).not.toContain("invited");
    expect(message.text).not.toContain("?");
    expect(message.html).toContain(PLUS_EMAIL);
    expect(message.html).toContain("Welcome to Factrove");
    expect(message.html).toContain("Sign in to Factrove");
    expect(message.html).toContain(`href="${signInUrl}"`);
    expect(message.html).toContain('width="600"');
    expect(message.html).toContain("max-width:600px");
    expect(message.html).toContain('role="presentation"');
    expect(message.html).toContain("fac<b");
    expect(message.html).toContain(">t</b>rove");
    expect(message.html).toContain("#858bee");
    expect(message.html).toContain("#5e64d6");
    expect(message.html).toContain("prefers-color-scheme: dark");
    expect(wrapsLongText(cellByClass(message.html, "welcome"))).toBe(true);
    expect(wrapsLongText(cellByClass(message.html, "fallback"))).toBe(true);
    expect(wrapsLongText(cellByClass(message.html, "footer"))).toBe(true);
    const dark = darkModeBlock(message.html);
    expect(dark).toContain(".link { color: #858bee !important;");
    expect(message.html).toContain(`<a class="link" href="${signInUrl}"`);
    expect(message.html).toContain('class="link" href="mailto:support@factrove.app"');
    expect(message.html).toContain('class="link" href="https://factrove.app"');
    expect(message.html).toContain("mailto:support@factrove.app");
    expect(message.html).toContain('href="https://factrove.app"');
    expect(message.html).not.toContain("<img");
    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("?");
    expect(message.html).not.toContain("utm_");
  });

  it("escapes HTML in the display name and uses a logo when one is configured", () => {
    const message = buildInviteEmail({
      recipient: { email: PLUS_EMAIL, name: "Ada <script>" },
      signInUrl,
      supportEmail: "support+help@factrove.app",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(message.html).toContain("Hi Ada &lt;script&gt;,");
    expect(message.html).toContain(`Your Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(message.html).toContain('alt="Factrove"');
    expect(message.html).not.toContain("fac<b");
    expect(message.html).not.toContain("?");
    expect(message.text).toContain(`Hi Ada <script>,\nYour Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.html).toContain("mailto:support+help@factrove.app");
    expect(message.text).not.toContain("invited");
  });

  it("omits the name when the account has none", () => {
    const message = buildInviteEmail({
      recipient: { email: PLUS_EMAIL, name: "  " },
      signInUrl,
      supportEmail: "support@factrove.app",
    });
    expect(message.text).toContain(`Hi,\nYour Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.text).not.toContain("Hi ,");
    expect(message.html).toContain(`Hi,<br>Your Factrove account for ${PLUS_EMAIL} is ready.`);
  });
});

describe("email transport selection", () => {
  it("logs the invite and does not open a transport when EMAIL_TRANSPORT is log", async () => {
    const lines: string[] = [];
    let fetches = 0;
    let transports = 0;
    const sender = createEmailSender(apiConfig({}), {
      log: (message) => lines.push(message),
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("network");
      },
      createTransport: () => {
        transports += 1;
        throw new Error("network");
      },
    });
    expect(sender).toBeInstanceOf(LogEmailSender);
    await sender.send(sampleEmail());
    expect(fetches).toBe(0);
    expect(transports).toBe(0);
    const logged = lines.join("\n");
    expect(logged).toContain("EMAIL_TRANSPORT is log. Invite email was not sent.");
    expect(logged).toContain("From: Factrove <support@factrove.app>");
    expect(logged).toContain(`To: ${PLUS_EMAIL}`);
    expect(logged).toContain(`Subject: ${INVITE_EMAIL_SUBJECT}`);
    expect(logged).toContain(PLUS_EMAIL);
    expect(logged).not.toContain("Invite email sent");
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("api.brevo.com");
  });

  it("selects Brevo only when the transport is brevo", () => {
    const sender = createEmailSender(apiConfig({
      emailTransport: "brevo",
      brevoApiKey: FAKE_KEY,
    }), {
      fetchImpl: async () => new Response("{}", { status: 201 }),
    });
    expect(sender).toBeInstanceOf(BrevoEmailSender);
    expect(() => createEmailSender(apiConfig({ emailTransport: "brevo", brevoApiKey: null }))).toThrow(
      "BREVO_API_KEY is required when EMAIL_TRANSPORT is brevo.",
    );
  });

  it("selects SMTP only when the transport is smtp and does not connect at startup", () => {
    let transports = 0;
    const sender = createEmailSender(apiConfig({
      emailTransport: "smtp",
      smtp: { host: "mail.example.com", port: 587, secure: false, requireTls: true, user: null, password: null },
    }), {
      createTransport: () => {
        transports += 1;
        return { async sendMail() { return { messageId: "<id>" }; } };
      },
    });
    expect(sender).toBeInstanceOf(SmtpEmailSender);
    expect(transports).toBe(0);
    expect(() => createEmailSender(apiConfig({ emailTransport: "smtp", smtp: null }))).toThrow(
      "SMTP settings are missing.",
    );
  });
});

describe("Brevo email sender", () => {
  it("posts the transactional email and does not call the account endpoint", async () => {
    const urls: string[] = [];
    const lines: string[] = [];
    const sender = new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      FAKE_KEY,
      async (input, init) => {
        urls.push(requestUrl(input));
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(headers.get("api-key")).toBe(FAKE_KEY);
        expect(headers.get("content-type")).toBe("application/json");
        expect(JSON.parse(String(init?.body))).toEqual({
          sender: { name: "Factrove", email: "support@factrove.app" },
          to: [{ email: PLUS_EMAIL }],
          subject: INVITE_EMAIL_SUBJECT,
          textContent: expect.stringContaining(PLUS_EMAIL),
          htmlContent: expect.stringContaining(PLUS_EMAIL),
        });
        return new Response(JSON.stringify({ messageId: "<invite@smtp.brevo>" }), { status: 201 });
      },
      (message) => lines.push(message),
    );
    await sender.send(sampleEmail());
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL} messageId=<invite@smtp.brevo>`]);
    expect(urls).toEqual([BREVO_TRANSACTIONAL_EMAIL_URL]);
    expect(urls.some((url) => url.includes("/account"))).toBe(false);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
  });

  it("drops a 201 message id that echoes the API key", async () => {
    const lines: string[] = [];
    const sender = new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      FAKE_KEY,
      async () => new Response(JSON.stringify({ messageId: FAKE_KEY }), { status: 201 }),
      (message) => lines.push(message),
    );
    await sender.send(sampleEmail());
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL}`]);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
    expect(lines.join("\n")).not.toContain("xkeysib-");
  });

  it("omits the key from a rejected response and a transport error", async () => {
    const rejected = new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      FAKE_KEY,
      async () => new Response(JSON.stringify({
        message: `Key ${FAKE_KEY} was rejected`,
        code: "unauthorized",
      }), { status: 401 }),
    );
    await expect(rejected.send(sampleEmail())).rejects.toThrow(
      /Brevo rejected the invite email with status 401/,
    );
    await expect(rejected.send(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    await expect(rejected.send(sampleEmail())).rejects.not.toThrow(new RegExp(FAKE_KEY));

    const failed = new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      FAKE_KEY,
      async () => {
        throw new Error(`connect ${FAKE_KEY}`);
      },
    );
    await expect(failed.send(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    await expect(failed.send(sampleEmail())).rejects.not.toThrow(new RegExp(FAKE_KEY));
  });

  it("redacts a key that crosses the logged error length", async () => {
    const key = `xkeysib-${"k".repeat(40)}`;
    const message = `${"a".repeat(190)}${key} tail`;
    // A 200-character cut through this body keeps the start of the key.
    const leakedPrefix = message.slice(0, 200).slice(190);
    const sender = new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      key,
      async () => new Response(JSON.stringify({ message }), { status: 401 }),
    );
    let detail = "";
    try {
      await sender.send(sampleEmail());
    } catch (error) {
      detail = error instanceof Error ? error.message : "";
    }
    expect(detail).toContain("[redacted]");
    expect(detail).not.toContain(key);
    expect(detail).not.toContain(leakedPrefix);
    expect(leakedPrefix.startsWith("xkeysib-")).toBe(true);
  });
});

describe("SMTP email sender", () => {
  it("sends through nodemailer options and does not call verify", async () => {
    const seen: SmtpTransportOptions[] = [];
    const lines: string[] = [];
    let verified = 0;
    const sender = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "smtp-relay.brevo.com", port: 587, secure: false, requireTls: true, user: "login", password: SMTP_PASSWORD },
      (options) => {
        seen.push(options);
        return {
          verify() {
            verified += 1;
          },
          async sendMail(message) {
            expect(message).toMatchObject({
              from: { name: "Factrove", address: "support@factrove.app" },
              to: PLUS_EMAIL,
              subject: INVITE_EMAIL_SUBJECT,
            });
            expect(message.text).toContain(PLUS_EMAIL);
            expect(message.html).toContain(PLUS_EMAIL);
            return { messageId: "<invite@smtp>" };
          },
        } as SmtpMail;
      },
      (message) => lines.push(message),
    );
    await sender.send(sampleEmail());
    expect(verified).toBe(0);
    expect(seen).toEqual([{
      host: "smtp-relay.brevo.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "login", pass: SMTP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    }]);
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL} messageId=<invite@smtp>`]);
    expect(JSON.stringify(seen)).toContain(SMTP_PASSWORD);
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
  });

  it("omits AUTH when the server has no credentials and redacts the user and password from errors", async () => {
    const open = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 25, secure: false, requireTls: true, user: null, password: null },
      (options) => {
        expect(options.auth).toBeUndefined();
        expect(options.requireTLS).toBe(true);
        return { async sendMail() { return {}; } };
      },
      () => {},
    );
    await open.send(sampleEmail());

    const failed = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: true, requireTls: false, user: "smtp-user-not-real", password: SMTP_PASSWORD },
      (options) => {
        expect(options.requireTLS).toBe(false);
        return {
          async sendMail() {
            throw new Error(`535 auth smtp-user-not-real ${SMTP_PASSWORD}`);
          },
        };
      },
    );
    await expect(failed.send(sampleEmail())).rejects.toThrow(/SMTP invite email failed/);
    await expect(failed.send(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    await expect(failed.send(sampleEmail())).rejects.not.toThrow(/smtp-user-not-real/);
    await expect(failed.send(sampleEmail())).rejects.not.toThrow(new RegExp(SMTP_PASSWORD));
  });

  it("drops a message id that echoes the password", async () => {
    const lines: string[] = [];
    const sender = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: false, requireTls: true, user: "login", password: SMTP_PASSWORD },
      () => ({
        async sendMail() {
          return { messageId: SMTP_PASSWORD };
        },
      }),
      (message) => lines.push(message),
    );
    await sender.send(sampleEmail());
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL}`]);
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
  });

  it("drops a message id that echoes a password with surrounding spaces", async () => {
    const password = `  ${SMTP_PASSWORD}  `;
    const lines: string[] = [];
    const sender = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: false, requireTls: true, user: "login", password },
      () => ({
        async sendMail() {
          return { messageId: password };
        },
      }),
      (message) => lines.push(message),
    );
    await sender.send(sampleEmail());
    const trimmedOnly = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: false, requireTls: true, user: "login", password },
      () => ({
        async sendMail() {
          return { messageId: SMTP_PASSWORD };
        },
      }),
      (message) => lines.push(message),
    );
    await trimmedOnly.send(sampleEmail());
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
    expect(lines.join("\n")).not.toContain("messageId=");
  });
});

describe("invite mailer", () => {
  it("sends one invite for a plus-address and leaves success logging to the transport", async () => {
    const sent: OutboundEmail[] = [];
    const mailer = new InviteMailer({
      async send(message) {
        sent.push(message);
      },
    }, apiConfig({}));
    const lines = await captureLogs(() => mailer.sendInvite({
      email: PLUS_EMAIL,
      name: "Invite Check",
    }));
    expect(sent).toEqual([expect.objectContaining({
      to: PLUS_EMAIL,
      subject: INVITE_EMAIL_SUBJECT,
    })]);
    expect(sent[0]?.text).toContain("http://localhost:3000/login");
    expect(sent[0]?.text).not.toContain("?");
    expect(lines).toEqual([]);
  });

  it("logs a failure without secrets and still resolves", async () => {
    const mailer = new InviteMailer({
      async send() {
        throw new Error(`rejected key ${FAKE_KEY} password ${SMTP_PASSWORD} user smtp-user-not-real`);
      },
    }, apiConfig({
      emailTransport: "smtp",
      brevoApiKey: FAKE_KEY,
      smtp: {
        host: "mail.example.com",
        port: 587,
        secure: false,
        requireTls: true,
        user: "smtp-user-not-real",
        password: SMTP_PASSWORD,
      },
    }));
    const lines = await captureLogs(async () => {
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Invite Check" });
      await new Promise((resolve) => setImmediate(resolve));
    });
    expect(lines).toEqual([
      `Invite email failed for ${PLUS_EMAIL}. rejected key [redacted] password [redacted] user [redacted]`,
    ]);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
    expect(lines.join("\n")).not.toContain("smtp-user-not-real");
  });

  it("strips a reset link from an SMTP failure log", async () => {
    const token = "smtp-reset-token-must-stay-out";
    const resetUrl = `http://localhost:3000/reset-password?token=${token}`;
    const mailer = new InviteMailer(new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: false, requireTls: true, user: null, password: null },
      () => ({
        async sendMail(mail) {
          throw new Error(`550 rejected ${mail.text}`);
        },
      }),
    ), apiConfig({}));
    const lines = await captureLogs(async () => {
      await mailer.sendPasswordReset({ email: PLUS_EMAIL, name: "Ada Lovelace", resetUrl });
      await flush();
    });
    const logged = lines.join("\n");
    expect(logged).toContain(`Password reset email failed for ${PLUS_EMAIL}`);
    expect(logged).toContain("[url]");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(resetUrl);
    expect(logged).not.toMatch(/https?:\/\//);
  });

  it("strips a reset link from a Brevo API failure log", async () => {
    const token = "brevo-reset-token-must-stay-out";
    const resetUrl = `http://localhost:3000/reset-password?token=${token}`;
    const mailer = new InviteMailer(new BrevoEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      FAKE_KEY,
      async () => new Response(JSON.stringify({ message: `blocked ${resetUrl}` }), { status: 400 }),
    ), apiConfig({
      emailTransport: "brevo",
      brevoApiKey: FAKE_KEY,
    }));
    const lines = await captureLogs(async () => {
      await mailer.sendPasswordReset({ email: PLUS_EMAIL, name: "Ada Lovelace", resetUrl });
      await flush();
    });
    const logged = lines.join("\n");
    expect(logged).toContain(`Password reset email failed for ${PLUS_EMAIL}`);
    expect(logged).toContain("[url]");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(resetUrl);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toMatch(/https?:\/\//);
  });

  it("returns while the provider send is still pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => gate,
    }, apiConfig({}));
    try {
      const result = await Promise.race([
        mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" }).then(() => "done"),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("waited"), 200);
        }),
      ]);
      expect(result).toBe("done");
    } finally {
      release();
    }
  });

  it("falls back to console.error when the failure logger throws", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const error = Logger.prototype.error;
    const consoleError = console.error;
    const fallback: string[] = [];
    Logger.prototype.error = () => {
      throw new Error("logger exploded");
    };
    console.error = (...args: unknown[]) => {
      fallback.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const mailer = new InviteMailer({
        async send() {
          throw new Error(`rejected key ${FAKE_KEY}`);
        },
      }, apiConfig({ brevoApiKey: FAKE_KEY }));
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" });
      await flush();
      expect(unhandled).toEqual([]);
      const logged = fallback.join("\n");
      expect(logged).toContain(`Invite email failed for ${PLUS_EMAIL}`);
      expect(logged).toContain("[redacted]");
      expect(logged).toContain("Logger failed");
      expect(logged).not.toContain(FAKE_KEY);
      expect(logged).not.toContain("logger exploded");
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      Logger.prototype.error = error;
      console.error = consoleError;
    }
  });

  it("does not print the logger error when its message cannot be read", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const error = Logger.prototype.error;
    const consoleError = console.error;
    const fallback: string[] = [];
    Logger.prototype.error = () => {
      const failure = new Error("unused");
      Object.defineProperty(failure, "message", {
        get() {
          throw new Error(`getter ${FAKE_KEY}`);
        },
      });
      throw failure;
    };
    console.error = (...args: unknown[]) => {
      fallback.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const mailer = new InviteMailer({
        async send() {
          throw new Error("provider down");
        },
      }, apiConfig({ brevoApiKey: FAKE_KEY }));
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" });
      await flush();
      expect(unhandled).toEqual([]);
      const logged = fallback.join("\n");
      expect(logged).toContain(`Invite email failed for ${PLUS_EMAIL}. provider down`);
      expect(logged).toContain("Logger failed.");
      expect(logged).not.toContain(FAKE_KEY);
      expect(logged).not.toContain("getter");
      expect(logged).not.toContain("unused");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      Logger.prototype.error = error;
      console.error = consoleError;
    }
  });

  it("sends at most four invites at once", async () => {
    let started = 0;
    const releases: Array<() => void> = [];
    const mailer = new InviteMailer({
      send: () => {
        started += 1;
        return new Promise((resolve) => {
          releases.push(resolve);
        });
      },
    }, apiConfig({}));
    mailer.concurrency = 4;
    try {
      for (let index = 0; index < 6; index += 1) {
        await mailer.sendInvite({
          email: `user${index}+factrove@mail.grokbot.com`,
          name: "Ada Lovelace",
        });
      }
      await flush();
      expect(started).toBe(4);
      const releaseOne = releases[0];
      expect(releaseOne).toBeTypeOf("function");
      releaseOne?.();
      await flush();
      expect(started).toBe(5);
    } finally {
      for (const release of releases) {
        release();
      }
    }
  });

  it("skips an invite when 100 are already waiting", async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => {
        started += 1;
        return gate;
      },
    }, apiConfig({}));
    mailer.concurrency = 1;
    const skipped = "overflow+factrove@mail.grokbot.com";
    const warn = Logger.prototype.warn;
    const lines: string[] = [];
    Logger.prototype.warn = function (message: unknown) {
      lines.push(String(message));
      return this;
    };
    try {
      for (let index = 0; index < INVITE_QUEUE_LIMIT + 1; index += 1) {
        await mailer.sendInvite({
          email: `user${index}+factrove@mail.grokbot.com`,
          name: "Ada Lovelace",
        });
      }
      await mailer.sendInvite({ email: skipped, name: "Ada Lovelace" });
      expect(started).toBe(1);
      expect(lines).toEqual([`Invite email skipped for ${skipped}. The send queue is full.`]);
    } finally {
      Logger.prototype.warn = warn;
      release();
    }
  });

  it("clears the drain timer when sends finish early", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => gate,
    }, apiConfig({}));
    mailer.shutdownTimeoutMs = 10_000;
    try {
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" });
      await flush();
      const before = timeoutCount();
      const shutdown = mailer.onApplicationShutdown();
      expect(timeoutCount()).toBeGreaterThan(before);
      release();
      const started = Date.now();
      await shutdown;
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(timeoutCount()).toBe(before);
    } finally {
      release();
    }
  });

  it("finishes queued invites during shutdown", async () => {
    const releases: Array<() => void> = [];
    const mailer = new InviteMailer({
      send: () => new Promise((resolve) => {
        releases.push(resolve);
      }),
    }, apiConfig({}));
    mailer.concurrency = 1;
    mailer.shutdownTimeoutMs = 1_000;
    await mailer.sendInvite({ email: "one+factrove@mail.grokbot.com", name: "Ada Lovelace" });
    await mailer.sendInvite({ email: "two+factrove@mail.grokbot.com", name: "Ada Lovelace" });
    await flush();
    expect(releases).toHaveLength(1);
    const lines: string[] = [];
    const error = Logger.prototype.error;
    Logger.prototype.error = function (message: unknown) {
      lines.push(String(message));
      return this;
    };
    try {
      const shutdown = mailer.onApplicationShutdown();
      const releaseFirst = releases[0];
      expect(releaseFirst).toBeTypeOf("function");
      releaseFirst?.();
      await flush();
      expect(releases).toHaveLength(2);
      releases[1]?.();
      await shutdown;
      expect(lines).toEqual([]);
    } finally {
      Logger.prototype.error = error;
      for (const release of releases) {
        release();
      }
    }
  });

  it("logs invites that are still pending when shutdown times out", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => gate,
    }, apiConfig({}));
    mailer.concurrency = 4;
    mailer.shutdownTimeoutMs = 40;
    try {
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" });
      await mailer.sendInvite({ email: "other+factrove@mail.grokbot.com", name: "Ada Lovelace" });
      const lines = await captureLogs(() => mailer.onApplicationShutdown());
      expect(lines).toEqual([
        `Auth email shutdown left 2 send(s) unfinished: ${PLUS_EMAIL}, other+factrove@mail.grokbot.com.`,
      ]);
    } finally {
      release();
    }
  });

  it("counts queued invites that shutdown does not reach", async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mailer = new InviteMailer({
      send: () => {
        started += 1;
        return gate;
      },
    }, apiConfig({}));
    mailer.concurrency = 4;
    mailer.shutdownTimeoutMs = 40;
    try {
      for (let index = 0; index < 6; index += 1) {
        await mailer.sendInvite({
          email: `user${index}+factrove@mail.grokbot.com`,
          name: "Ada Lovelace",
        });
      }
      await flush();
      expect(started).toBe(4);
      const lines = await captureLogs(() => mailer.onApplicationShutdown());
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("left 6 send(s) unfinished");
      expect(lines[0]).toContain("user4+factrove@mail.grokbot.com");
      expect(lines[0]).toContain("user5+factrove@mail.grokbot.com");
      expect(started).toBe(4);
    } finally {
      release();
    }
  });

  it("drains when the Nest module closes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: EMAIL_SENDER, useValue: { send: () => gate } },
        { provide: API_CONFIG, useValue: apiConfig({}) },
        InviteMailer,
      ],
    }).compile();
    const mailer = moduleRef.get(InviteMailer);
    mailer.shutdownTimeoutMs = 40;
    try {
      await mailer.sendInvite({ email: PLUS_EMAIL, name: "Ada Lovelace" });
      const lines = await captureLogs(() => moduleRef.close());
      expect(lines.join("\n")).toContain(`Auth email shutdown left 1 send(s) unfinished: ${PLUS_EMAIL}.`);
    } finally {
      release();
    }
  });

  it("skips a blank address", async () => {
    let calls = 0;
    const mailer = new InviteMailer({
      async send() {
        calls += 1;
      },
    }, apiConfig({}));
    await mailer.sendInvite({ email: "   ", name: "Invite Check" });
    expect(calls).toBe(0);
  });
});

describe("API module", () => {
  it("constructs the log sender without a provider key", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(apiConfig({}))
      .overrideProvider(PrismaService)
      .useValue({ $connect: async () => {}, $disconnect: async () => {} })
      .overrideProvider(BLOB_STORE)
      .useValue({
        async put() {},
        async get() {
          throw new Error("unused");
        },
        async delete() {},
      })
      .compile();
    try {
      await moduleRef.init();
      expect(moduleRef.get(InviteMailer)).toBeInstanceOf(InviteMailer);
      expect(moduleRef.get(EMAIL_SENDER)).toBeInstanceOf(LogEmailSender);
    } finally {
      await moduleRef.close();
    }
  });
});

describe("sign-up invite", () => {
  it("sends the invite for a plus-address and skips a duplicate sign-up", async () => {
    const invited: Array<{ email: string; name: string }> = [];
    const auth = createAuth({
      prisma: {} as PrismaClient,
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        apikey: [],
      }),
      baseURL: "http://localhost:3001",
      secret: TEST_AUTH_SECRET,
      trustedOrigins: ["http://localhost:3000"],
      cookieDomain: null,
      webOrigin: "http://localhost:3000",
      onUserCreated: async (account) => {
        invited.push(account);
      },
      sendPasswordResetEmail: async () => {},
      sendVerificationEmail: async () => {},
    });
    const created = await auth.handler(signUpRequest("Magnificode+Factrove@Mail.Grokbot.com"));
    expect(created.status).toBe(200);
    expect(invited).toEqual([{ email: PLUS_EMAIL, name: "Invite Check" }]);

    const duplicate = await auth.handler(signUpRequest(PLUS_EMAIL));
    expect(duplicate.ok).toBe(false);
    expect(invited).toHaveLength(1);
  });

  it("responds while the invite send is still pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const auth = createAuth({
      prisma: {} as PrismaClient,
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        apikey: [],
      }),
      baseURL: "http://localhost:3001",
      secret: TEST_AUTH_SECRET,
      trustedOrigins: ["http://localhost:3000"],
      cookieDomain: null,
      webOrigin: "http://localhost:3000",
      onUserCreated: () => gate,
      sendPasswordResetEmail: async () => {},
      sendVerificationEmail: async () => {},
    });
    const created = await Promise.race([
      auth.handler(signUpRequest("pending+factrove@mail.grokbot.com")),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("sign-up waited on the invite")), 200);
      }),
    ]);
    try {
      expect(created.status).toBe(200);
    } finally {
      release();
    }
  });

  it("stays up when invite failure logging throws", async () => {
    const require = createRequire(import.meta.url);
    const vitestEntry = require.resolve("vitest/vitest.mjs");
    const apiRoot = fileURLToPath(new URL("..", import.meta.url));
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("VITEST")) {
        delete env[key];
      }
    }
    const child = spawn(process.execPath, [
      vitestEntry,
      "run",
      "test/invite-failure-worker.test.ts",
      "--reporter=verbose",
    ], {
      cwd: apiRoot,
      env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("invite failure subprocess timed out"));
      }, 45_000);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    const output = `${Buffer.concat(stdout).toString()}\n${Buffer.concat(stderr).toString()}`;
    expect(code, output).toBe(0);
    expect(output).toContain("invite-failure-process-ok");
  });
});

function cellByClass(html: string, className: string): string {
  const start = html.indexOf(`class="pad muted ${className}"`);
  return html.slice(start, html.indexOf("</td>", start));
}

function wrapsLongText(cell: string): boolean {
  return cell.includes("word-break:break-word") && cell.includes("overflow-wrap:anywhere");
}

function darkModeBlock(html: string): string {
  const start = html.indexOf("@media (prefers-color-scheme: dark)");
  const rule = html.indexOf(".link {", start);
  return html.slice(start, html.indexOf("}", rule));
}

function sampleEmail(): OutboundEmail {
  return buildInviteEmail({
    recipient: { email: PLUS_EMAIL, name: "Invite Check" },
    signInUrl: "http://localhost:3000/login",
    supportEmail: "support@factrove.app",
  });
}

function authEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { BETTER_AUTH_SECRET: TEST_AUTH_SECRET, ...extra };
}

function apiConfig(overrides: Partial<ApiConfig>): ApiConfig {
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
    emailTransport: "log",
    emailFromAddress: "support@factrove.app",
    emailFromName: "Factrove",
    emailLogoUrl: null,
    emailLogFullLinks: false,
    brevoApiKey: null,
    smtp: null,
    ...overrides,
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function signUpRequest(email: string): Request {
  return new Request("http://localhost:3001/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      name: "Invite Check",
      email,
      password: "local-invite-check-1",
    }),
  });
}

function timeoutCount(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function captureLogs(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const log = Logger.prototype.log;
  const error = Logger.prototype.error;
  Logger.prototype.log = function (message: unknown) {
    lines.push(String(message));
    return this;
  };
  Logger.prototype.error = function (message: unknown) {
    lines.push(String(message));
    return this;
  };
  try {
    await run();
    return lines;
  } finally {
    Logger.prototype.log = log;
    Logger.prototype.error = error;
  }
}
