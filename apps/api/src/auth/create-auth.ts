import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { PrismaClient } from "@prisma/client";
import { factroveApiKey } from "./api-key-plugin.js";

export type CreateAuthInput = {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
};

export type FactroveAuth = {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: Headers }) => Promise<{
      user: { id: string; name: string };
      session: unknown;
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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    telemetry: { enabled: false },
    advanced: {
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: input.baseURL.startsWith("https://"),
        httpOnly: true,
        path: "/",
      },
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
