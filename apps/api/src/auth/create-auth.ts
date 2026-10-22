import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@factrove/contracts";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@prisma/client";
import { factroveApiKey } from "./api-key-plugin.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";

export type CreateAuthInput = {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  cookieDomain: string | null;
};

export type FactroveAuth = {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      user: { id: string; name: string };
      session: { activeOrganizationId?: string | null };
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
    database: prismaAdapter(input.prisma, {
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
    plugins: [factroveApiKey()],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
