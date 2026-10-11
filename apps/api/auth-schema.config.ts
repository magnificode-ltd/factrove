import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Backend-local Better Auth configuration used only to generate the Prisma
 * identity schema. It is not mounted as an auth server.
 */
export const auth = betterAuth({
  baseURL: "http://127.0.0.1:3001",
  secret: "factrove-schema-generation-only-not-a-runtime-secret",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [organization()],
});
