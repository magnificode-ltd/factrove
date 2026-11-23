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
import { scopeOrganizationApiKeyRequest } from "./api-key-scope.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import {
  ORGANIZATION_SELECTION_REQUIRED_MESSAGE,
  ORGANIZATION_SETUP_REQUIRED_MESSAGE,
  resolveCurrentOrganization,
} from "./current-organization.js";
import { factroveOrganization, rejectClosedOrganizationAction } from "./organization-plugin.js";

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
      key: { id: string; referenceId: string; metadata?: unknown } | null;
    }>;
  };
};

export function createAuth(input: CreateAuthInput): FactroveAuth {
  const gate: { api?: FactroveAuth["api"] } = {};
  const auth = betterAuth({
    baseURL: input.baseURL,
    secret: input.secret,
    trustedOrigins: input.trustedOrigins,
    database: input.database ?? prismaAdapter(input.prisma, {
      provider: "postgresql",
    }),
    // The organization plugin owns session.activeOrganizationId (input: false).
    // Membership is checked when the session is read; a stored id the user does not belong to is ignored.
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
    // Hash verification identifiers (reset-password:<token> and the rest)
    // before they are written. Better Auth 1.7.7 otherwise stores that
    // string in verification.identifier. Lookup still uses the raw token.
    verification: {
      storeIdentifier: "hashed",
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
    plugins: [factroveOrganization(), factroveApiKey()],
    // Account creation sends the welcome email. It is not an organization invite.
    // The address is stored in lower case and a plus tag is kept (name+tag@host).
    databaseHooks: {
      session: {
        create: {
          // A user with exactly one membership signs in to that organization.
          // Several memberships stay unset. The client cannot send this field.
          before: async (session) => {
            const userId = session.userId;
            if (!userId || activeOrganizationIdFrom(session.activeOrganizationId) || !canReadMemberships(input.prisma)) {
              return;
            }
            const resolved = await resolveCurrentOrganization(input.prisma, userId, null);
            if (resolved.status !== "ready") {
              return;
            }
            return { data: { ...session, activeOrganizationId: resolved.organization.id } };
          },
        },
      },
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
        rejectClosedOrganizationAction(ctx.path);
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
        const api = gate.api;
        if (!api) {
          return;
        }
        const session = await api.getSession({ headers: ctx.headers ?? new Headers() });
        if (!session?.user) {
          return;
        }
        if (!canReadMemberships(input.prisma)) {
          return;
        }
        const resolved = await resolveCurrentOrganization(
          input.prisma,
          session.user.id,
          activeOrganizationIdFrom(session.session.activeOrganizationId),
        );
        if (resolved.status === "setup-required") {
          throw new APIError("FORBIDDEN", {
            message: ORGANIZATION_SETUP_REQUIRED_MESSAGE,
            code: "ORGANIZATION_SETUP_REQUIRED",
          });
        }
        if (resolved.status === "selection-required") {
          throw new APIError("CONFLICT", {
            message: ORGANIZATION_SELECTION_REQUIRED_MESSAGE,
            code: "ORGANIZATION_SELECTION_REQUIRED",
          });
        }
        const scoped = await scopeOrganizationApiKeyRequest(ctx, {
          prisma: input.prisma,
          userId: session.user.id,
          organizationId: resolved.organization.id,
        });
        if (scoped) {
          return { context: scoped };
        }
      }),
    },
  }) as unknown as FactroveAuth;
  gate.api = auth.api;
  return auth;
}

function activeOrganizationIdFrom(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function canReadMemberships(prisma: PrismaClient): boolean {
  const member = prisma.member as { findMany?: unknown; findFirst?: unknown } | undefined;
  return typeof member?.findMany === "function" && typeof member.findFirst === "function";
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
