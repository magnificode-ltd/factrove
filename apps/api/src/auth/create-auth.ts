import { Logger } from "@nestjs/common";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, isCommonSharePassword } from "@factrove/contracts";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@prisma/client";
import {
  PASSWORD_RESET_EXPIRES_IN_SECONDS,
  PASSWORD_RESET_REQUEST_MAX,
  PASSWORD_RESET_REQUEST_WINDOW_SECONDS,
  PASSWORD_RESET_SUBMIT_MAX,
  PASSWORD_RESET_SUBMIT_WINDOW_SECONDS,
  EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  EMAIL_VERIFICATION_REQUEST_MAX,
  EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS,
  emailVerificationUrl,
  passwordResetUrl,
} from "../mail/password-reset-link.js";
import { logWithoutThrowing } from "../mail/safe-log.js";
import { factroveApiKey } from "./api-key-plugin.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";

export type CreatedAccount = {
  email: string;
  name: string;
};

export type PasswordResetEmail = {
  email: string;
  name: string;
  resetUrl: string;
};

export type VerificationEmail = {
  email: string;
  name: string;
  verifyUrl: string;
};

export type CreateAuthInput = {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  cookieDomain: string | null;
  webOrigin: string;
  onUserCreated: (account: CreatedAccount) => Promise<void>;
  sendPasswordResetEmail: (message: PasswordResetEmail) => Promise<void>;
  sendVerificationEmail: (message: VerificationEmail) => Promise<void>;
  // Runtime auth uses Prisma. Tests pass the memory adapter.
  database?: BetterAuthOptions["database"];
};

export type FactroveAuth = {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      user: { id: string; name: string };
      session: { id: string; activeOrganizationId?: string | null };
    } | null>;
    verifyApiKey: (input: { body: { key: string } }) => Promise<{
      valid: boolean;
      key: { referenceId: string } | null;
    }>;
  };
};

export function createAuth(input: CreateAuthInput): FactroveAuth {
  return betterAuth({
    baseURL: input.baseURL,
    secret: input.secret,
    trustedOrigins: input.trustedOrigins,
    database: input.database ?? prismaAdapter(input.prisma, {
      provider: "postgresql",
    }),
    // Organization HTTP routes stay unmounted. This is the same session column the
    // organization plugin writes. input: false keeps it server-controlled. Membership
    // is checked when the session is read; a stored id the user does not belong to is ignored.
    session: {
      additionalFields: {
        activeOrganizationId: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_EXPIRES_IN_SECONDS,
      // A reset link must not leave an older browser signed in.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const resetUrl = passwordResetUrl(input.webOrigin, token);
        const email = user.email.trim();
        if (resetUrl === null || email.length === 0) {
          return;
        }
        // Do not await the sender. A slow provider must not change the response
        // time between an address that exists and one that does not.
        void Promise.resolve()
          .then(() => input.sendPasswordResetEmail({
            email,
            name: user.name.trim(),
            resetUrl,
          }))
          .catch((error: unknown) => {
            logAuthFailure("Password reset email failed", email, error);
          });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
      sendVerificationEmail: async ({ user, token }) => {
        const verifyUrl = emailVerificationUrl(input.webOrigin, token);
        const email = user.email.trim();
        if (verifyUrl === null || email.length === 0) {
          return;
        }
        // Signup already signs the person in. Do not wait on the provider.
        void Promise.resolve()
          .then(() => input.sendVerificationEmail({
            email,
            name: user.name.trim(),
            verifyUrl,
          }))
          .catch((error: unknown) => {
            logAuthFailure("Verification email failed", email, error);
          });
      },
    },
    telemetry: { enabled: false },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
        "/request-password-reset": {
          window: PASSWORD_RESET_REQUEST_WINDOW_SECONDS,
          max: PASSWORD_RESET_REQUEST_MAX,
        },
        "/reset-password": {
          window: PASSWORD_RESET_SUBMIT_WINDOW_SECONDS,
          max: PASSWORD_RESET_SUBMIT_MAX,
        },
        "/send-verification-email": {
          window: EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS,
          max: EMAIL_VERIFICATION_REQUEST_MAX,
        },
      },
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: [CLIENT_IP_HEADER],
      },
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: input.baseURL.startsWith("https://"),
        httpOnly: true,
        path: "/",
      },
      ...(input.cookieDomain
        ? { crossSubDomainCookies: { enabled: true, domain: input.cookieDomain } }
        : {}),
    },
    plugins: [factroveApiKey()],
    // Account creation is the invite path. Organization routes stay unmounted,
    // so there is no separate member-invite request. The address is stored in
    // lower case and a plus tag is kept (name+tag@host).
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const email = user.email.trim();
            if (email.length === 0) {
              return;
            }
            // Sign-up must not wait on the mail provider. The .then also catches
            // a synchronous throw. The logger call cannot throw out of this chain.
            void Promise.resolve()
              .then(() => input.onUserCreated({
                email,
                name: user.name.trim(),
              }))
              .catch((error: unknown) => {
                logAuthFailure("Invite email failed", email, error);
              });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (isPasswordReset(ctx.path)) {
          const password = readNewPassword(ctx.body);
          if (password !== null && isCommonSharePassword(password)) {
            throw new APIError("BAD_REQUEST", {
              message: "Choose a less common password.",
            });
          }
        }
        if (!ctx.path?.includes("/api-key")) {
          return;
        }
        const authorization = ctx.headers?.get("authorization");
        if (authorization) {
          throw new APIError("UNAUTHORIZED", {
            message: "API key management requires a browser session.",
          });
        }
      }),
    },
  }) as unknown as FactroveAuth;
}

function isPasswordReset(path: string | undefined): boolean {
  return path === "/reset-password";
}

function readNewPassword(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("newPassword" in body)) {
    return null;
  }
  const value = body.newPassword;
  return typeof value === "string" ? value : null;
}

function logAuthFailure(label: string, email: string, error: unknown): void {
  let message = `${label} for ${email}.`;
  try {
    const detail = error instanceof Error ? error.message : "request failed";
    message = `${label} for ${email}. ${detail}`;
  } catch {
    message = `${label} for ${email}.`;
  }
  logWithoutThrowing((line) => {
    new Logger("Auth").error(line);
  }, message);
}
