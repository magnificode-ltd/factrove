import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { PrismaClient } from "@prisma/client";

function requiredBaseUrl(): string {
  const current = process.env.BASE_URL;
  if (current?.startsWith("http://") || current?.startsWith("https://")) {
    return current;
  }
  delete process.env.BASE_URL;
  try {
    loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
  } catch {
    // The variable can also be supplied by the process environment.
  }
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl?.startsWith("http://") && !baseUrl?.startsWith("https://")) {
    throw new Error("BASE_URL is required");
  }
  return baseUrl;
}

const prisma = new PrismaClient();
const baseURL = requiredBaseUrl();

/**
 * Backend-local Better Auth configuration used only to generate the Prisma
 * identity schema. It is not mounted as an auth server.
 */
export const auth = betterAuth({
  baseURL,
  secret: "factrove-schema-generation-only-not-a-runtime-secret",
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  plugins: [organization()],
});
