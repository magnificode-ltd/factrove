import "reflect-metadata";
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
import { InviteMailer } from "../src/mail/invite-mailer.js";
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
      user: "login",
      password: `  ${SMTP_PASSWORD}  `,
    });
  });
});

describe("invite email", () => {
  const signInUrl = "http://localhost:3000/login";

  it("keeps a plus-address in the text and the HTML", () => {
    const message = buildInviteEmail({
      recipient: { email: `  ${PLUS_EMAIL}  `, name: "Invite Check" },
      signInUrl,
      supportEmail: "support@factrove.app",
    });
    expect(message).toMatchObject({
      to: PLUS_EMAIL,
      subject: INVITE_EMAIL_SUBJECT,
    });
    expect(message.subject).toBe("Welcome to Factrove");
    expect(message.text).toContain("Welcome to Factrove");
    expect(message.text).toContain(`Invite Check, your account for ${PLUS_EMAIL} is ready.`);
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
    expect(message.html).toContain("Ada &lt;script&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain('src="https://cdn.example.com/logo.png"');
    expect(message.html).toContain('alt="Factrove"');
    expect(message.html).not.toContain("fac<b");
    expect(message.html).not.toContain("?");
    expect(message.text).toContain("Ada <script>, your account");
    expect(message.html).toContain("mailto:support+help@factrove.app");
    expect(message.text).not.toContain("invited");
  });

  it("omits the name when the account has none", () => {
    const message = buildInviteEmail({
      recipient: { email: PLUS_EMAIL, name: "  " },
      signInUrl,
      supportEmail: "support@factrove.app",
    });
    expect(message.text).toContain(`Your account for ${PLUS_EMAIL} is ready.`);
    expect(message.text).not.toContain(", your account");
    expect(message.html).toContain(`Your account for ${PLUS_EMAIL} is ready.`);
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
      smtp: { host: "mail.example.com", port: 587, secure: false, user: null, password: null },
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
});

describe("SMTP email sender", () => {
  it("sends through nodemailer options and does not call verify", async () => {
    const seen: SmtpTransportOptions[] = [];
    const lines: string[] = [];
    let verified = 0;
    const sender = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "smtp-relay.brevo.com", port: 587, secure: false, user: "login", password: SMTP_PASSWORD },
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
      auth: { user: "login", pass: SMTP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    }]);
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL} messageId=<invite@smtp>`]);
    expect(JSON.stringify(seen)).toContain(SMTP_PASSWORD);
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
  });

  it("omits AUTH when the server has no credentials and redacts the password from errors", async () => {
    const open = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 25, secure: false, user: null, password: null },
      (options) => {
        expect(options.auth).toBeUndefined();
        return { async sendMail() { return {}; } };
      },
      () => {},
    );
    await open.send(sampleEmail());

    const failed = new SmtpEmailSender(
      { emailFromAddress: "support@factrove.app", emailFromName: "Factrove" },
      { host: "mail.example.com", port: 587, secure: true, user: "mailer", password: SMTP_PASSWORD },
      () => ({
        async sendMail() {
          throw new Error(`535 auth ${SMTP_PASSWORD}`);
        },
      }),
    );
    await expect(failed.send(sampleEmail())).rejects.toThrow(/SMTP invite email failed/);
    await expect(failed.send(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    await expect(failed.send(sampleEmail())).rejects.not.toThrow(new RegExp(SMTP_PASSWORD));
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
        throw new Error(`rejected key ${FAKE_KEY} password ${SMTP_PASSWORD}`);
      },
    }, apiConfig({
      emailTransport: "smtp",
      brevoApiKey: FAKE_KEY,
      smtp: {
        host: "mail.example.com",
        port: 587,
        secure: false,
        user: "mailer",
        password: SMTP_PASSWORD,
      },
    }));
    const lines = await captureLogs(() => mailer.sendInvite({ email: PLUS_EMAIL, name: "Invite Check" }));
    expect(lines).toEqual([
      `Invite email failed for ${PLUS_EMAIL}. rejected key [redacted] password [redacted]`,
    ]);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
    expect(lines.join("\n")).not.toContain(SMTP_PASSWORD);
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
      onUserCreated: async (account) => {
        invited.push(account);
      },
    });
    const created = await auth.handler(signUpRequest("Magnificode+Factrove@Mail.Grokbot.com"));
    expect(created.status).toBe(200);
    expect(invited).toEqual([{ email: PLUS_EMAIL, name: "Invite Check" }]);

    const duplicate = await auth.handler(signUpRequest(PLUS_EMAIL));
    expect(duplicate.ok).toBe(false);
    expect(invited).toHaveLength(1);
  });
});

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
