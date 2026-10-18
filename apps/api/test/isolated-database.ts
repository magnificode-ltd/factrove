import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const defaultEnvPath = fileURLToPath(new URL("../.env", import.meta.url));
const databaseNamePattern = /^factrove_test_\d+_[a-f0-9]+$/;

export type IsolatedDatabase = {
  databaseName: string;
  databaseUrl: string;
  adminUrl: string;
};

export function resolveBaseDatabaseUrl(options?: {
  env?: NodeJS.ProcessEnv;
  envFilePath?: string;
}): string {
  const env = options?.env ?? process.env;
  const supplied = env.DATABASE_URL?.trim();
  if (supplied) {
    return supplied;
  }
  const fromFile = readOptionalEnvValue("DATABASE_URL", options?.envFilePath ?? defaultEnvPath);
  if (fromFile) {
    return fromFile;
  }
  throw new Error("DATABASE_URL is required. Set it in the environment or apps/api/.env.");
}

export function readOptionalEnvValue(name: string, envFilePath = defaultEnvPath): string | undefined {
  const value = readOptionalEnvFile(envFilePath)[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function createIsolatedDatabase(): Promise<IsolatedDatabase> {
  const databaseName = uniqueDatabaseName();
  const baseUrl = resolveBaseDatabaseUrl();
  const adminUrl = withDatabase(baseUrl, "postgres");
  const databaseUrl = withDatabase(baseUrl, databaseName);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  } finally {
    await admin.end();
  }
  return { databaseName, databaseUrl, adminUrl };
}

export async function dropIsolatedDatabase(database: IsolatedDatabase): Promise<void> {
  const admin = new Client({ connectionString: database.adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database.databaseName)} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

function uniqueDatabaseName(): string {
  const name = `factrove_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  assertDatabaseName(name);
  return name;
}

function quoteIdentifier(name: string): string {
  assertDatabaseName(name);
  return `"${name}"`;
}

function assertDatabaseName(name: string): void {
  if (!databaseNamePattern.test(name) || name.length > 63) {
    throw new Error("Refusing to manage a database outside this test run.");
  }
}

function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.href;
}

function readOptionalEnvFile(envFilePath: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(envFilePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }
    throw error;
  }
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = trimmed.slice(0, separator);
    if (values[name] !== undefined) {
      continue;
    }
    values[name] = trimmed.slice(separator + 1).trim().replaceAll(/^["']|["']$/g, "");
  }
  return values;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
