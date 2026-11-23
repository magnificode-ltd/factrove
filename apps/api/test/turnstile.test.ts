import "reflect-metadata";
import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it } from "vitest";
import { createAuth, type CreateAuthInput } from "../src/auth/create-auth.js";
import { CLIENT_IP_HEADER } from "../src/auth/client-ip.js";
import {
  CAPTCHA_FAILED,
  CAPTCHA_FAILED_MESSAGE,
  CAPTCHA_UNAVAILABLE,
  CAPTCHA_UNAVAILABLE_MESSAGE,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TIMEOUT_MS,
  verifyTurnstileToken,
} from "../src/auth/turnstile.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";

// Cloudflare's published dummy token and test secrets.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const TEST_SECRET_PASS = "1x0000000000000000000000000000000AA";
const TEST_SECRET_FAIL = "2x0000000000000000000000000000000AA";
const TEST_SECRET_SPENT = "3x0000000000000000000000000000000AA";

const WEB_ORIGIN = "http://localhost:3000";
const API_ORIGIN = "http://localhost:3001";

type SiteverifyCall = {
  url: string;
  body: string;
  redirect: RequestRedirect | undefined;
  hasSignal: boolean;
};

const logged: string[] = [];
const originalError = Logger.prototype.error;
const originalWarn = Logger.prototype.warn;

afterEach(() => {
  Logger.prototype.error = originalError;
  Logger.prototype.warn = originalWarn;
  logged.length = 0;
});

describe("Turnstile signup check", () => {
  it("keeps a short Siteverify timeout", () => {
    expect(TURNSTILE_TIMEOUT_MS).toBe(5_000);
    expect(TURNSTILE_SITEVERIFY_URL).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  it("skips verification when no secret is set", async () => {
    const siteverify = recordingFetch(jsonResponse({ success: true }));
    const auth = createAuth(authInput(null, siteverify.fetchImpl));
    const created = await auth.handler(signUpRequest("off+signup@example.com", "203.0.113.10"));
    expect(created.status).toBe(200);
    expect(siteverify.calls).toEqual([]);

    const withToken = await auth.handler(signUpRequest("off-token+signup@example.com", "203.0.113.11", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(withToken.status).toBe(200);
    expect(siteverify.calls).toEqual([]);
  });

  it("accepts Cloudflare's passing test secret and dummy token", async () => {
    const siteverify = recordingFetch(jsonResponse({ success: true, "error-codes": [] }));
    const auth = createAuth(authInput(TEST_SECRET_PASS, siteverify.fetchImpl));
    const created = await auth.handler(signUpRequest("pass+signup@example.com", "203.0.113.20", {
      turnstileToken: `  ${DUMMY_TOKEN}  `,
      callbackURL: "/invites/accept?token=invite-token",
    }));
    expect(created.status).toBe(200);
    expect(siteverify.calls).toHaveLength(1);
    expect(siteverify.calls[0]).toMatchObject({
      url: TURNSTILE_SITEVERIFY_URL,
      redirect: "error",
      hasSignal: true,
    });
    expect(siteverify.calls[0]?.body).toBe(
      `secret=${TEST_SECRET_PASS}&response=${DUMMY_TOKEN}&remoteip=203.0.113.20`,
    );
    expect(logged.join("\n")).not.toContain(TEST_SECRET_PASS);

    const signedIn = await auth.handler(signInRequest("pass+signup@example.com", "203.0.113.21"));
    expect(signedIn.status).toBe(200);
    const reset = await auth.handler(jsonRequest("/api/auth/request-password-reset", "203.0.113.22", {
      email: "pass+signup@example.com",
    }));
    expect(reset.status).toBe(200);
    expect(siteverify.calls).toHaveLength(1);
  });

  it("rejects a missing or invalid token", async () => {
    const siteverify = recordingFetch(jsonResponse({
      success: false,
      "error-codes": ["invalid-input-response"],
    }));
    const auth = createAuth(authInput(TEST_SECRET_FAIL, siteverify.fetchImpl));
    const missing = await auth.handler(signUpRequest("missing+signup@example.com", "203.0.113.30"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      message: CAPTCHA_FAILED_MESSAGE,
      code: CAPTCHA_FAILED,
    });
    expect(siteverify.calls).toEqual([]);
    const stillMissing = await auth.handler(signInRequest("missing+signup@example.com", "203.0.113.31"));
    expect(stillMissing.status).toBe(401);

    const blank = await auth.handler(signUpRequest("blank+signup@example.com", "203.0.113.32", {
      turnstileToken: "   ",
    }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).code).toBe(CAPTCHA_FAILED);
    expect(siteverify.calls).toEqual([]);

    const invalid = await auth.handler(signUpRequest("invalid+signup@example.com", "203.0.113.33", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: CAPTCHA_FAILED, message: CAPTCHA_FAILED_MESSAGE });
    expect(siteverify.calls[0]?.body).toContain(`secret=${TEST_SECRET_FAIL}`);
    expect(siteverify.calls[0]?.body).toContain(`response=${DUMMY_TOKEN}`);

    siteverify.fetchImpl = recordingFetch(jsonResponse({
      success: false,
      "error-codes": ["timeout-or-duplicate"],
    })).fetchImpl;
    const spentAuth = createAuth(authInput(TEST_SECRET_SPENT, siteverify.fetchImpl));
    const spent = await spentAuth.handler(signUpRequest("spent+signup@example.com", "203.0.113.34", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(spent.status).toBe(400);
    expect((await spent.json()).code).toBe(CAPTCHA_FAILED);
  });

  it("fails closed when Siteverify errors", async () => {
    captureLogs();
    const secret = `${TEST_SECRET_PASS}-not-logged`;
    const broken = recordingFetch(async () => {
      throw new Error(`connect failed ${secret}`);
    });
    const auth = createAuth(authInput(secret, broken.fetchImpl));
    const failed = await auth.handler(signUpRequest("down+signup@example.com", "203.0.113.40", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(failed.status).toBe(503);
    expect(failed.headers.get("retry-after")).toBe("1");
    const failedBody = await failed.json();
    expect(failedBody).toEqual({
      message: CAPTCHA_UNAVAILABLE_MESSAGE,
      code: CAPTCHA_UNAVAILABLE,
    });
    expect(JSON.stringify(failedBody)).not.toContain(secret);
    expect(logged.join("\n")).toContain("[redacted]");
    expect(logged.join("\n")).not.toContain(secret);
    const notCreated = await auth.handler(signInRequest("down+signup@example.com", "203.0.113.41"));
    expect(notCreated.status).toBe(401);

    const httpError = createAuth(authInput(TEST_SECRET_PASS, recordingFetch(
      async () => new Response("nope", { status: 502 }),
    ).fetchImpl));
    const unavailable = await httpError.handler(signUpRequest("http+signup@example.com", "203.0.113.42", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).code).toBe(CAPTCHA_UNAVAILABLE);

    const notJson = createAuth(authInput(TEST_SECRET_PASS, recordingFetch(
      async () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
    ).fetchImpl));
    const badBody = await notJson.handler(signUpRequest("json+signup@example.com", "203.0.113.43", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(badBody.status).toBe(503);
    expect((await badBody.json()).code).toBe(CAPTCHA_UNAVAILABLE);

    const internal = createAuth(authInput(TEST_SECRET_PASS, recordingFetch(jsonResponse({
      success: false,
      "error-codes": ["internal-error"],
    })).fetchImpl));
    const internalError = await internal.handler(signUpRequest("internal+signup@example.com", "203.0.113.44", {
      turnstileToken: DUMMY_TOKEN,
    }));
    expect(internalError.status).toBe(503);
    expect((await internalError.json()).code).toBe(CAPTCHA_UNAVAILABLE);
    expect(logged.join("\n")).not.toContain(TEST_SECRET_PASS);
  });

  it("times out Siteverify without calling a later hop", async () => {
    captureLogs();
    const verdict = await verifyTurnstileToken({
      secret: TEST_SECRET_PASS,
      token: DUMMY_TOKEN,
      remoteIp: null,
      timeoutMs: 20,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        });
      }),
    });
    expect(verdict).toBe("unavailable");
    expect(logged.join("\n")).toContain("Signup check timed out.");
    expect(logged.join("\n")).not.toContain(TEST_SECRET_PASS);
  });
});

function captureLogs(): void {
  Logger.prototype.error = ((message?: unknown) => {
    logged.push(String(message));
  }) as typeof Logger.prototype.error;
  Logger.prototype.warn = ((message?: unknown) => {
    logged.push(String(message));
  }) as typeof Logger.prototype.warn;
}

function authInput(turnstileSecret: string | null, turnstileFetch: typeof fetch): CreateAuthInput {
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
    sendPasswordResetEmail: async () => {},
    sendVerificationEmail: async () => {},
    turnstileSecret,
    turnstileFetch,
  };
}

function signUpRequest(
  email: string,
  ip: string,
  extra: { turnstileToken?: string; callbackURL?: string } = {},
): Request {
  return jsonRequest("/api/auth/sign-up/email", ip, {
    name: "Turnstile Check",
    email,
    password: "local-invite-check-1",
    ...extra,
  });
}

function signInRequest(email: string, ip: string): Request {
  return jsonRequest("/api/auth/sign-in/email", ip, {
    email,
    password: "local-invite-check-1",
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

function jsonResponse(body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function recordingFetch(handler: typeof fetch): { calls: SiteverifyCall[]; fetchImpl: typeof fetch } {
  const calls: SiteverifyCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : String(init?.body ?? ""),
      redirect: init?.redirect,
      hasSignal: init?.signal instanceof AbortSignal,
    });
    return handler(input, init);
  };
  return { calls, fetchImpl };
}
