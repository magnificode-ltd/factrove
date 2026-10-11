import "reflect-metadata";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { artifactEnvelopeSchema } from "@factrove/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { localOrganizationFixture, localUserFixture, seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { contentSecurityPolicy } from "../src/rendering/html-policy.js";

const execFileAsync = promisify(execFile);
const enabled = process.env.S3_INTEGRATION === "1";
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));
const testDatabaseName = "factrove_test";

describe.skipIf(!enabled)("S3 content round trip", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let app: INestApplication | undefined;
  let baseUrl = "";
  let uploadedId: string | undefined;

  beforeAll(async () => {
    applyEnv(["S3_BUCKET", "S3_REGION", "AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]);
    const adminUrl = requiredFileEnv("DATABASE_URL");
    const testUrl = withDatabase(adminUrl, testDatabaseName);
    const admin = new Client({ connectionString: withDatabase(adminUrl, "postgres") });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${testDatabaseName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${testDatabaseName}`);
    } finally {
      await admin.end();
    }

    process.env.DATABASE_URL = testUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: testUrl },
    });
    const seeder = new PrismaClient();
    await seeder.$connect();
    try {
      await seedLocalIdentities(seeder);
    } finally {
      await seeder.$disconnect();
    }

    const config: ApiConfig = {
      host: "127.0.0.1",
      port: 3001,
      webOrigin: "http://localhost:3000",
      apiPublicOrigin: "http://localhost:3001",
      localUserId: localUserFixture.id,
      localOrganizationId: localOrganizationFixture.id,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app);
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app && uploadedId) {
      const blobs = app.get<BlobStore>(BLOB_STORE);
      await blobs.delete(`${uploadedId}.html`);
    }
    if (app) {
      await app.close();
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("uploads fixture html and reads the same bytes back", async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const form = new FormData();
    form.append("file", new Blob([bytes]), "hello.html");
    const response = await fetch(`${baseUrl}/api/v1/artifacts`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    const artifact = artifactEnvelopeSchema.parse(await response.json()).artifact;
    uploadedId = artifact.id;

    const content = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
    expect(content.headers.get("content-security-policy")).toBe(contentSecurityPolicy("http://localhost:3000"));
  });
});

function applyEnv(names: string[]): void {
  for (const name of names) {
    const value = fileEnv(name);
    if (value && !process.env[name]) {
      process.env[name] = value;
    }
  }
}

function requiredFileEnv(name: string): string {
  const value = fileEnv(name);
  if (!value) {
    throw new Error(`${name} is required in apps/api/.env`);
  }
  return value;
}

function fileEnv(name: string): string | undefined {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1 || trimmed.slice(0, separator) !== name) {
      continue;
    }
    return trimmed.slice(separator + 1).trim().replaceAll(/^["']|["']$/g, "");
  }
  return undefined;
}

function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.href;
}
