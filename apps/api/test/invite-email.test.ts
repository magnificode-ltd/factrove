import "reflect-metadata";
import type { PrismaClient } from "@prisma/client";
import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { createAuth } from "../src/auth/create-auth.js";
import { PrismaService } from "../src/database/index.js";
import {
  BREVO_TRANSACTIONAL_EMAIL_URL,
  createBrevoClient,
  type TransactionalEmail,
} from "../src/mail/brevo-client.js";
import { buildInviteEmail, INVITE_EMAIL_SUBJECT } from "../src/mail/invite-email.js";
import { InviteMailer } from "../src/mail/invite-mailer.js";
import { API_CONFIG, DEFAULT_BREVO_SENDER_EMAIL, DEFAULT_BREVO_SENDER_NAME, readApiConfig, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE } from "../src/storage/blob-store.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

const PLUS_EMAIL = "magnificode+factrove@mail.grokbot.com";
const FAKE_KEY = "xkeysib-test-key-not-real";

describe("Brevo configuration", () => {
  it("defaults the verified sender and leaves the key unset", () => {
    const config = readApiConfig({ BETTER_AUTH_SECRET: TEST_AUTH_SECRET });
    expect(config.brevoApiKey).toBeNull();
    expect(config.brevoSenderEmail).toBe(DEFAULT_BREVO_SENDER_EMAIL);
    expect(config.brevoSenderEmail).toBe("support@factrove.app");
    expect(config.brevoSenderName).toBe(DEFAULT_BREVO_SENDER_NAME);
    expect(config.brevoSenderName).toBe("Factrove");
  });

  it("treats a blank key as unset and keeps a trimmed key", () => {
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_API_KEY: "   ",
    }).brevoApiKey).toBeNull();
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_API_KEY: `  ${FAKE_KEY}  `,
    }).brevoApiKey).toBe(FAKE_KEY);
  });

  it("accepts a plus-address as the sender and rejects a value that is not an email", () => {
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_SENDER_EMAIL: "  support+notify@factrove.app  ",
      BREVO_SENDER_NAME: " Factrove ",
    }).brevoSenderEmail).toBe("support+notify@factrove.app");
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_SENDER_EMAIL: PLUS_EMAIL,
    }).brevoSenderEmail).toBe(PLUS_EMAIL);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_SENDER_EMAIL: "not-an-email",
    })).toThrow(/BREVO_SENDER_EMAIL/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      BREVO_SENDER_NAME: "Factrove\nOps",
    })).toThrow(/BREVO_SENDER_NAME/);
  });
});

describe("invite email", () => {
  it("keeps a plus-address in the text and the HTML", () => {
    const message = buildInviteEmail({
      recipient: { email: `  ${PLUS_EMAIL}  `, name: "Invite Check" },
      sender: { email: "support@factrove.app", name: "Factrove" },
      signInUrl: "http://localhost:3000/login",
    });
    expect(message.subject).toBe(INVITE_EMAIL_SUBJECT);
    expect(message.to).toEqual({ email: PLUS_EMAIL, name: "Invite Check" });
    expect(message.sender).toEqual({ email: "support@factrove.app", name: "Factrove" });
    expect(message.textContent).toContain(PLUS_EMAIL);
    expect(message.textContent).toContain("http://localhost:3000/login");
    expect(message.htmlContent).toContain(PLUS_EMAIL);
    expect(message.htmlContent).not.toContain("<script>");
  });

  it("escapes HTML in the display name", () => {
    const message = buildInviteEmail({
      recipient: { email: PLUS_EMAIL, name: "Ada <script>" },
      sender: { email: "support@factrove.app", name: "Factrove" },
      signInUrl: "http://localhost:3000/login",
    });
    expect(message.htmlContent).toContain("Ada &lt;script&gt;");
    expect(message.htmlContent).not.toContain("<script>");
    expect(message.textContent).toContain("Ada <script>");
  });
});

describe("Brevo client", () => {
  it("logs the invite and does not call the network when the key is unset", async () => {
    const lines: string[] = [];
    let calls = 0;
    const client = createBrevoClient({
      apiKey: null,
      log: (message) => lines.push(message),
      fetchImpl: async () => {
        calls += 1;
        throw new Error("network");
      },
    });
    const result = await client.sendTransactionalEmail(sampleEmail());
    expect(result).toEqual({ messageId: null, delivered: false });
    expect(calls).toBe(0);
    const logged = lines.join("\n");
    expect(logged).toContain("Brevo API key is unset. Invite email was not sent.");
    expect(logged).toContain(`To: Invite Check <${PLUS_EMAIL}>`);
    expect(logged).toContain("From: Factrove <support@factrove.app>");
    expect(logged).toContain(`Subject: ${INVITE_EMAIL_SUBJECT}`);
    expect(logged).toContain(PLUS_EMAIL);
    expect(logged).not.toContain(FAKE_KEY);
    expect(logged).not.toContain("api.brevo.com");
  });

  it("posts the transactional email and does not call the account endpoint", async () => {
    const urls: string[] = [];
    const client = createBrevoClient({
      apiKey: FAKE_KEY,
      fetchImpl: async (input, init) => {
        urls.push(requestUrl(input));
        const headers = new Headers(init?.headers);
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        expect(headers.get("api-key")).toBe(FAKE_KEY);
        expect(headers.get("content-type")).toBe("application/json");
        expect(JSON.parse(String(init?.body))).toEqual({
          sender: { name: "Factrove", email: "support@factrove.app" },
          to: [{ email: PLUS_EMAIL, name: "Invite Check" }],
          subject: INVITE_EMAIL_SUBJECT,
          textContent: expect.stringContaining(PLUS_EMAIL),
          htmlContent: expect.stringContaining(PLUS_EMAIL),
        });
        return new Response(JSON.stringify({ messageId: "<invite@smtp.brevo>" }), { status: 201 });
      },
    });
    const result = await client.sendTransactionalEmail(sampleEmail());
    expect(result).toEqual({ messageId: "<invite@smtp.brevo>", delivered: true });
    expect(urls).toEqual([BREVO_TRANSACTIONAL_EMAIL_URL]);
    expect(urls.some((url) => url.includes("/account"))).toBe(false);
  });

  it("omits the key from a rejected response and a transport error", async () => {
    const rejected = createBrevoClient({
      apiKey: FAKE_KEY,
      fetchImpl: async () => new Response(JSON.stringify({
        message: `Key ${FAKE_KEY} was rejected`,
        code: "unauthorized",
      }), { status: 401 }),
    });
    await expect(rejected.sendTransactionalEmail(sampleEmail())).rejects.toThrow(
      /Brevo rejected the invite email with status 401/,
    );
    await expect(rejected.sendTransactionalEmail(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    try {
      await rejected.sendTransactionalEmail(sampleEmail());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(FAKE_KEY);
    }

    const failed = createBrevoClient({
      apiKey: FAKE_KEY,
      fetchImpl: async () => {
        throw new Error(`connect ${FAKE_KEY}`);
      },
    });
    await expect(failed.sendTransactionalEmail(sampleEmail())).rejects.toThrow(/\[redacted\]/);
    try {
      await failed.sendTransactionalEmail(sampleEmail());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(FAKE_KEY);
    }
  });
});

describe("invite mailer", () => {
  it("sends one invite for a plus-address and logs the Brevo message id", async () => {
    const sent: TransactionalEmail[] = [];
    const mailer = new InviteMailer({
      async sendTransactionalEmail(email) {
        sent.push(email);
        return { messageId: "<invite@smtp.brevo>", delivered: true };
      },
    }, apiConfig({ brevoApiKey: FAKE_KEY }));
    const lines = await captureLogs(() => mailer.sendInvite({
      email: PLUS_EMAIL,
      name: "Invite Check",
    }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to.email).toBe(PLUS_EMAIL);
    expect(sent[0]?.textContent).toContain("http://localhost:3000/login");
    expect(lines).toEqual([`Invite email sent to ${PLUS_EMAIL} messageId=<invite@smtp.brevo>`]);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
  });

  it("logs a failure without the key and still resolves", async () => {
    const mailer = new InviteMailer({
      async sendTransactionalEmail() {
        throw new Error(`Brevo rejected the invite email with status 401. Key ${FAKE_KEY} was rejected`);
      },
    }, apiConfig({ brevoApiKey: FAKE_KEY }));
    const lines = await captureLogs(() => mailer.sendInvite({ email: PLUS_EMAIL, name: "Invite Check" }));
    expect(lines).toEqual([
      `Invite email failed for ${PLUS_EMAIL}. Brevo rejected the invite email with status 401. Key [redacted] was rejected`,
    ]);
    expect(lines.join("\n")).not.toContain(FAKE_KEY);
  });
});

describe("API module", () => {
  it("constructs the invite mailer without a Brevo key", async () => {
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

function sampleEmail(): TransactionalEmail {
  return buildInviteEmail({
    recipient: { email: PLUS_EMAIL, name: "Invite Check" },
    sender: { email: "support@factrove.app", name: "Factrove" },
    signInUrl: "http://localhost:3000/login",
  });
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
    brevoApiKey: null,
    brevoSenderEmail: "support@factrove.app",
    brevoSenderName: "Factrove",
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
