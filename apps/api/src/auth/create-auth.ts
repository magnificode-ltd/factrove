import { Logger } from "@nestjs/common";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@factrove/contracts";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@prisma/client";
import { logWithoutThrowing } from "../mail/safe-log.js";
import { factroveApiKey } from "./api-key-plugin.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import { factroveOrganization, rejectClosedOrganizationAction } from "./organization-plugin.js";

export type CreatedAccount = {
  email: string;
  name: string;
};

export type CreateAuthInput = {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  cookieDomain: string | null;
  onUserCreated: (account: CreatedAccount) => Promise<void>;
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
    // The organization plugin owns session.activeOrganizationId (input: false).
    // Membership is checked when the session is read; a stored id the user does not belong to is ignored.
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: AUTH_PASSWORD_MIN_LENGTH,
      maxPasswordLength: AUTH_PASSWORD_MAX_LENGTH,
    },
    telemetry: { enabled: false },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
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
                let message = `Invite email failed for ${email}.`;
                try {
                  const detail = error instanceof Error ? error.message : "request failed";
                  message = `Invite email failed for ${email}. ${detail}`;
                } catch {
                  message = `Invite email failed for ${email}.`;
                }
                logWithoutThrowing((line) => {
                  new Logger("Auth").error(line);
                }, message);
              });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        rejectClosedOrganizationAction(ctx.path, ctx.body);
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
