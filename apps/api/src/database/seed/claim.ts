import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { ClaimLocalArtifactsError, claimLocalArtifacts } from "./claim-local-artifacts.js";

const inheritedBaseUrl = process.env.BASE_URL;
if (!inheritedBaseUrl?.startsWith("http://") && !inheritedBaseUrl?.startsWith("https://")) {
  delete process.env.BASE_URL;
}
loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));

const baseUrl = process.env.BASE_URL;
if (!baseUrl?.startsWith("http://") && !baseUrl?.startsWith("https://")) {
  throw new Error("BASE_URL is required");
}

function readEmail(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email") {
      return argv[index + 1] ?? "";
    }
    if (arg?.startsWith("--email=")) {
      return arg.slice("--email=".length);
    }
  }
  return "";
}

const prisma = new PrismaClient();

try {
  const result = await claimLocalArtifacts(prisma, readEmail(process.argv.slice(2)));
  process.stdout.write(`Claimed ${result.artifactsClaimed} artifact(s) for ${result.email}.\n`);
} catch (error) {
  if (error instanceof ClaimLocalArtifactsError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
