import "reflect-metadata";
import type { PrismaClient } from "@prisma/client";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/auth/create-auth.js";
import { CLIENT_IP_HEADER } from "../src/auth/client-ip.js";
import {
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  EMAIL_VERIFICATION_REQUEST_MAX,
  emailVerificationUrl,
} from "../src/mail/password-reset-link.js";
import { buildVerificationEmail, VERIFICATION_EMAIL_SUBJECT } from "../src/mail/verification-email.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:3001";
const PLUS_EMAIL = "magnificode+verify@mail.grokbot.com";

describe("verification email", () => {
  it("welcomes the person and links to the web app", () => {
    const verifyUrl = emailVerificationUrl(WEB_ORIGIN, "header.payload.sig");
    expect(new URL(verifyUrl ?? "http://invalid").searchParams.get("token")).toBe("header.payload.sig");
    expect(EMAIL_VERIFICATION_EXPIRES_IN_SECONDS).toBe(3600);
    const message = buildVerificationEmail({
      recipient: { email: `  ${PLUS_EMAIL}  `, name: " Ada <script> " },
      verifyUrl: verifyUrl ?? "",
      supportEmail: "support@factrove.app",
    });
    expect(message.subject).toBe(VERIFICATION_EMAIL_SUBJECT);
    expect(message.purpose).toBe("Verification email");
    expect(message.text).toContain(`Your Factrove account for ${PLUS_EMAIL} is ready.`);
    expect(message.text).toContain("You can keep using Factrove either way.");
    expect(message.text).toContain("one hour");
    expect(message.html).toContain("Hi Ada &lt;script&gt;,");
    expect(message.html).toContain("Confirm email");
    expect(message.html).toContain(`href="${verifyUrl}"`);
    expect(message.html).toContain("#858bee");
    expect(message.html).toContain("fac<b");
    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain(API_ORIGIN);
  });

  it("sends one verification email on signup, signs the person in, and does not send again on sign-in", async () => {
    const sent: Array<{ email: string; name: string; verifyUrl: string }> = [];
    const createdHooks: string[] = [];
    const auth = createAuth(authInput({
      onUserCreated: async (account) => {
        createdHooks.push(account.email);
      },
      sendVerificationEmail: async (message) => {
        sent.push(message);
      },
    }));
    const created = await auth.handler(signUpRequest(PLUS_EMAIL, "203.0.113.50"));
    expect(created.status).toBe(200);
    expect(cookieHeader(created).length).toBeGreaterThan(0);
    await flush();
    expect(createdHooks).toEqual([PLUS_EMAIL]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.verifyUrl.startsWith(`${WEB_ORIGIN}/verify-email?token=`)).toBe(true);
    expect(sent[0]?.name).toBe("Verify Check");

    const before = await auth.handler(sessionRequest(cookieHeader(created)));
    expect(before.status).toBe(200);
    expect((await before.json()).user.emailVerified).toBe(false);

    const signedIn = await auth.handler(signInRequest(PLUS_EMAIL, "203.0.113.51"));
    expect(signedIn.status).toBe(200);
    await flush();
    expect(sent).toHaveLength(1);

    const token = new URL(sent[0]?.verifyUrl ?? "").searchParams.get("token") ?? "";
    const verified = await auth.handler(verifyRequest(token));
    expect(verified.status).toBe(200);
    const after = await auth.handler(sessionRequest(cookieHeader(created)));
    expect((await after.json()).user.emailVerified).toBe(true);

    const expired = await auth.handler(verifyRequest("not-a-token"));
    expect(expired.ok).toBe(false);
  });

  it("answers signup before the verification email finishes", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const auth = createAuth(authInput({
      sendVerificationEmail: () => gate,
    }));
    const created = await Promise.race([
      auth.handler(signUpRequest("pending+verify@mail.grokbot.com", "203.0.113.60")),
      new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("sign-up waited on the verification email")), 200);
      }),
    ]);
    try {
      expect(created.status).toBe(200);
    } finally {
      release();
    }
  });

  it("limits verification resends", async () => {
    const auth = createAuth(authInput({}));
    const ip = "203.0.113.70";
    const statuses: number[] = [];
    for (let index = 0; index < EMAIL_VERIFICATION_REQUEST_MAX + 1; index += 1) {
      const response = await auth.handler(resendRequest(`nobody-${index}+verify@mail.grokbot.com`, ip));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, EMAIL_VERIFICATION_REQUEST_MAX).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});

function authInput(handlers: {
  onUserCreated?: (account: { email: string; name: string }) => Promise<void>;
  sendVerificationEmail?: (message: { email: string; name: string; verifyUrl: string }) => Promise<void>;
}) {
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
    onUserCreated: handlers.onUserCreated ?? (async () => {}),
    sendPasswordResetEmail: async () => {},
    sendVerificationEmail: handlers.sendVerificationEmail ?? (async () => {}),
  };
}

function signUpRequest(email: string, ip: string): Request {
  return jsonRequest("/api/auth/sign-up/email", ip, {
    name: "Verify Check",
    email,
    password: "local-invite-check-1",
  });
}

function signInRequest(email: string, ip: string): Request {
  return jsonRequest("/api/auth/sign-in/email", ip, {
    email,
    password: "local-invite-check-1",
  });
}

function resendRequest(email: string, ip: string): Request {
  return jsonRequest("/api/auth/send-verification-email", ip, { email });
}

function verifyRequest(token: string): Request {
  const url = new URL("/api/auth/verify-email", API_ORIGIN);
  url.searchParams.set("token", token);
  return new Request(url, { headers: { origin: WEB_ORIGIN } });
}

function sessionRequest(cookie: string): Request {
  return new Request(`${API_ORIGIN}/api/auth/get-session`, {
    headers: {
      origin: WEB_ORIGIN,
      cookie,
    },
  });
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

function cookieHeader(response: Response): string {
  const cookies = response.headers.getSetCookie?.() ?? [];
  return cookies.map((cookie) => cookie.split(";")[0] ?? "").filter((cookie) => cookie.length > 0).join("; ");
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
