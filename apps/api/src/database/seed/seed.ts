import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { seedLocalIdentities } from "./seed-local-identities.js";

const inheritedBaseUrl = process.env.BASE_URL;
if (!inheritedBaseUrl?.startsWith("http://") && !inheritedBaseUrl?.startsWith("https://")) {
  delete process.env.BASE_URL;
}
loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));

const baseUrl = process.env.BASE_URL;
if (!baseUrl?.startsWith("http://") && !baseUrl?.startsWith("https://")) {
  throw new Error("BASE_URL is required");
}

const prisma = new PrismaClient();

try {
  await seedLocalIdentities(prisma);
} finally {
  await prisma.$disconnect();
}
