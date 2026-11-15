import "reflect-metadata";
import type { PrismaClient } from "@prisma/client";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/create-auth.js";
import { CLIENT_IP_HEADER } from "../src/auth/client-ip.js";
import { LogEmailSender } from "../src/mail/email-sender.js";
import { buildPasswordResetEmail, PASSWORD_RESET_EMAIL_SUBJECT } from "../src/mail/password-reset-email.js";
import {
  PASSWORD_RESET_EXPIRES_IN_SECONDS,
  PASSWORD_RESET_EXPIRES_LABEL,
  PASSWORD_RESET_REQUEST_MAX,
  passwordResetUrl,
} from "../src/mail/password-reset-link.js";
import { readApiConfig } from "../src/services/api-config.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:3001";
const PLUS_EMAIL = "magnificode+reset@mail.grokbot.com";
const STORED_EMAIL = "magnificode+reset@mail.grokbot.com";

describe("password reset email", () => {
  it("uses the welcome layout, the web origin, and a one-hour expiry", () => {
    const token = "token_with.dots-and_tilde";
    const resetUrl = passwordResetUrl(WEB_ORIGIN, token);
    expect(new URL(resetUrl ?? "http://invalid").searchParams.get("token")).toBe(token);
    expect(resetUrl?.startsWith(`${WEB_ORIGIN}/reset-password?token=`)).toBe(true);
    expect(passwordResetUrl(WEB_ORIGIN, "bad token")).toBeNull();
    expect(passwordResetUrl(WEB_ORIGIN, "")).toBeNull();
    expect(PASSWORD_RESET_EXPIRES_IN_SECONDS).toBe(3600);
    expect(PASSWORD_RESET_EXPIRES_LABEL).toBe("one hour");

    const message = buildPasswordResetEmail({
      recipient: { email: `  ${PLUS_EMAIL}  `, name: " Ada <script> " },
      resetUrl: resetUrl ?? "",
      supportEmail: "library@example.com",
      siteUrl: WEB_ORIGIN,
    });
    expect(message.to).toBe(PLUS_EMAIL);
    expect(message.subject).toBe(PASSWORD_RESET_EMAIL_SUBJECT);
    expect(message.purpose).toBe("Password reset email");
    expect(message.text).toContain("Hi Ada <script>,");
    expect(message.text).toContain(`reset the password for ${PLUS_EMAIL}`);
    expect(message.text).toContain("one hour");
    expect(message.text).toContain(resetUrl);
    expect(message.text).not.toContain(API_ORIGIN);
    expect(message.html).toContain("Hi Ada &lt;script&gt;,");
    expect(message.html).toContain("Reset your password");
    expect(message.html).toContain(`href="${resetUrl}"`);
    expect(message.html).toContain('width="600"');
    expect(message.html).toContain("fac<b");
    expect(message.html).toContain("#858bee");
    expect(message.html).toContain("#5e64d6");
    expect(message.html).toContain("prefers-color-scheme: dark");
    expect(message.html).toContain('class="link" href="mailto:library@example.com"');
    expect(message.html).toContain(`href="${WEB_ORIGIN}" style="color:#5e64d6; word-break:break-word; overflow-wrap:anywhere;">Factrove</a>`);
    expect(message.text).toContain(`Factrove: ${WEB_ORIGIN}`);
    expect(message.html).not.toContain("https://factrove.app");
    expect(message.text).not.toContain("https://factrove.app");
    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain(API_ORIGIN);
    expect(message.html).not.toContain("<img");
  });

  it("redacts the reset token in the log transport unless the dev-only flag is set", async () => {
    const token = "reset-token-must-not-be-logged";
    const resetUrl = passwordResetUrl(WEB_ORIGIN, token) ?? "";
    const message = buildPasswordResetEmail({
      recipient: { email: PLUS_EMAIL, name: "Ada Lovelace" },
      resetUrl,
      supportEmail: "library@example.com",
      siteUrl: WEB_ORIGIN,
    });
    const redacted: string[] = [];
    await new LogEmailSender({
      emailFromAddress: "library@example.com",
      emailFromName: "Factrove",
      emailLogFullLinks: false,
    }, (line) => redacted.push(line)).send(message);
    const logged = redacted.join("\n");
    expect(logged).toContain(`To: ${PLUS_EMAIL}`);
    expect(logged).toContain("Password reset email was not sent.");
    expect(logged).toContain(`${WEB_ORIGIN}/reset-password?[redacted]`);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("token=");

    const revealed: string[] = [];
    await new LogEmailSender({
      emailFromAddress: "library@example.com",
      emailFromName: "Factrove",
      emailLogFullLinks: true,
    }, (line) => revealed.push(line)).send(message);
    expect(revealed.join("\n")).toContain(token);

    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      NODE_ENV: "development",
      EMAIL_LOG_LINKS: "full",
    }).emailLogFullLinks).toBe(true);
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      NODE_ENV: "production",
    }).emailLogFullLinks).toBe(false);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      NODE_ENV: "production",
      EMAIL_LOG_LINKS: "full",
    })).toThrow(/only allowed when NODE_ENV is not production/);
  });

  it("sends one branded link for a known address and the same reply for an unknown one", async () => {
    const sent: Array<{ email: string; name: string; resetUrl: string }> = [];
    const auth = createAuth(authInput(async (message) => {
      sent.push(message);
    }));
    const created = await auth.handler(signUpRequest(PLUS_EMAIL, "203.0.113.10"));
    expect(created.status).toBe(200);

    const known = await auth.handler(requestReset("Magnificode+Reset@Mail.Grokbot.com", "203.0.113.11"));
    const unknown = await auth.handler(requestReset("missing+reset@mail.grokbot.com", "203.0.113.12"));
    await flush();

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(await known.json()).toEqual(await unknown.json());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.email).toBe(STORED_EMAIL);
    expect(sent[0]?.name).toBe("Reset Check");
    expect(sent[0]?.resetUrl.startsWith(`${WEB_ORIGIN}/reset-password?token=`)).toBe(true);
    expect(sent[0]?.resetUrl).not.toContain(API_ORIGIN);
  });

  it("answers before the reset email finishes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const auth = createAuth(authInput(() => gate));
    const created = await auth.handler(signUpRequest("pending+reset@mail.grokbot.com", "203.0.113.20"));
    expect(created.status).toBe(200);
    const response = await Promise.race([
      auth.handler(requestReset("pending+reset@mail.grokbot.com", "203.0.113.21")),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("password reset waited on the email")), 200);
      }),
    ]);
    try {
      expect(response.status).toBe(200);
    } finally {
      release();
    }
  });

  it("rejects a common password without using up the token, then accepts a new one", async () => {
    const sent: Array<{ resetUrl: string }> = [];
    const auth = createAuth(authInput(async (message) => {
      sent.push(message);
    }));
    expect((await auth.handler(signUpRequest("common+reset@mail.grokbot.com", "203.0.113.30"))).status).toBe(200);
    expect((await auth.handler(requestReset("common+reset@mail.grokbot.com", "203.0.113.31"))).status).toBe(200);
    await flush();
    const token = new URL(sent[0]?.resetUrl ?? "").searchParams.get("token");
    expect(token).toBeTruthy();

    const common = await auth.handler(submitReset(token ?? "", "password123", "203.0.113.32"));
    expect(common.status).toBe(400);
    expect(await common.json()).toMatchObject({ message: "Choose a less common password." });

    const short = await auth.handler(submitReset(token ?? "", "short", "203.0.113.33"));
    expect(short.status).toBe(400);

    const updated = await auth.handler(submitReset(token ?? "", "canyon-lantern-48", "203.0.113.34"));
    expect(updated.status).toBe(200);

    const again = await auth.handler(submitReset(token ?? "", "canyon-lantern-49", "203.0.113.35"));
    expect(again.status).toBe(400);
    expect((await again.json()).message).toMatch(/token/i);

    const signedIn = await auth.handler(signInRequest("common+reset@mail.grokbot.com", "canyon-lantern-48", "203.0.113.36"));
    expect(signedIn.status).toBe(200);
    const oldPassword = await auth.handler(signInRequest("common+reset@mail.grokbot.com", "local-invite-check-1", "203.0.113.37"));
    expect(oldPassword.ok).toBe(false);
  });

  it("limits reset requests", async () => {
    const auth = createAuth(authInput(async () => {}));
    const ip = "203.0.113.40";
    const statuses: number[] = [];
    for (let index = 0; index < PASSWORD_RESET_REQUEST_MAX + 1; index += 1) {
      const response = await auth.handler(requestReset(`nobody-${index}+reset@mail.grokbot.com`, ip));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, PASSWORD_RESET_REQUEST_MAX).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("signs out every session that existed before the reset", async () => {
    const sent: Array<{ resetUrl: string }> = [];
    const auth = createAuth(authInput(async (message) => {
      sent.push(message);
    }));
    const created = await auth.handler(signUpRequest("sessions+reset@mail.grokbot.com", "203.0.113.80"));
    const signupCookie = cookieHeader(created);
    const again = await auth.handler(signInRequest("sessions+reset@mail.grokbot.com", "local-invite-check-1", "203.0.113.81"));
    const signInCookie = cookieHeader(again);
    expect(await sessionUser(auth, signupCookie)).toBeTruthy();
    expect(await sessionUser(auth, signInCookie)).toBeTruthy();

    expect((await auth.handler(requestReset("sessions+reset@mail.grokbot.com", "203.0.113.82"))).status).toBe(200);
    await flush();
    const token = new URL(sent[0]?.resetUrl ?? "").searchParams.get("token") ?? "";
    expect((await auth.handler(submitReset(token, "canyon-lantern-48", "203.0.113.83"))).status).toBe(200);

    expect(await sessionUser(auth, signupCookie)).toBeNull();
    expect(await sessionUser(auth, signInCookie)).toBeNull();
    const fresh = await auth.handler(signInRequest("sessions+reset@mail.grokbot.com", "canyon-lantern-48", "203.0.113.84"));
    expect(fresh.status).toBe(200);
    expect(await sessionUser(auth, cookieHeader(fresh))).toBeTruthy();
  });
});

function authInput(sendPasswordResetEmail: (message: { email: string; name: string; resetUrl: string }) => Promise<void>) {
  return {
    prisma: {} as PrismaClient,
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      apikey: [],
    }),
    baseURL: API_ORIGIN,
    secret: TEST_AUTH_SECRET,
    trustedOrigins: [WEB_ORIGIN],
    cookieDomain: null,
    webOrigin: WEB_ORIGIN,
    onUserCreated: async () => {},
    sendPasswordResetEmail,
    sendVerificationEmail: async () => {},
  };
}

function signUpRequest(email: string, ip: string): Request {
  return jsonRequest("/api/auth/sign-up/email", ip, {
    name: "Reset Check",
    email,
    password: "local-invite-check-1",
  });
}

function requestReset(email: string, ip: string): Request {
  return jsonRequest("/api/auth/request-password-reset", ip, { email });
}

function submitReset(token: string, newPassword: string, ip: string): Request {
  return jsonRequest("/api/auth/reset-password", ip, { token, newPassword });
}

function signInRequest(email: string, password: string, ip: string): Request {
  return jsonRequest("/api/auth/sign-in/email", ip, { email, password });
}

function cookieHeader(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map((cookie) => cookie.split(";")[0] ?? "").filter((cookie) => cookie.length > 0).join("; ");
}

async function sessionUser(auth: ReturnType<typeof createAuth>, cookie: string): Promise<{ id: string } | null> {
  const response = await auth.handler(new Request(`${API_ORIGIN}/api/auth/get-session`, {
    headers: { origin: WEB_ORIGIN, cookie },
  }));
  const body = await response.json() as { user?: { id: string } | null } | null;
  return body?.user ?? null;
}

function jsonRequest(path: string, ip: string, body: unknown): Request {
  return new Request(`${API_ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: WEB_ORIGIN,
      [CLIENT_IP_HEADER]: ip,
    },
    body: JSON.stringify(body),
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
