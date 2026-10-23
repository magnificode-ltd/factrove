import "reflect-metadata";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { artifactEnvelopeSchema } from "@factrove/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { signUpWithApiKey, TEST_AUTH_SECRET } from "./auth-session.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { contentSecurityPolicy } from "../src/rendering/html-policy.js";
import { createIsolatedDatabase, dropIsolatedDatabase, readOptionalEnvValue, type IsolatedDatabase } from "./isolated-database.js";
import { useLocalGarage } from "./local-garage.js";

const execFileAsync = promisify(execFile);
const enabled = process.env.S3_INTEGRATION === "1";
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));

describe.skipIf(!enabled)("S3 content round trip", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let app: INestApplication | undefined;
  let baseUrl = "";
  let uploadedId: string | undefined;
  let apiKey = "";

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
    applyEnv([
      "S3_BUCKET",
      "S3_REGION",
      "S3_ENDPOINT",
      "S3_FORCE_PATH_STYLE",
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
    ]);
    useLocalGarage();
    isolated = await createIsolatedDatabase();
    process.env.DATABASE_URL = isolated.databaseUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl },
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
      publicBaseUrl: "http://localhost:3000",
      authSecret: TEST_AUTH_SECRET,
      authCookieDomain: null,
      trustedProxies: [],
      shareTokenKey: null,
      emailTransport: "log",
      emailFromAddress: "support@factrove.app",
      emailFromName: "Factrove",
      brevoApiKey: null,
      smtp: null,
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .compile();
    app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
    configureHttpApp(app);
    await app.init();
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    apiKey = (await signUpWithApiKey(baseUrl, {
      email: "s3-owner@example.invalid",
      password: "s3-owner-password-1",
      name: "S3 Owner",
      keyName: "s3",
    })).apiKey;
  });

  afterAll(async () => {
    if (uploadedId) {
      const lookup = new PrismaClient();
      try {
        const row = await lookup.artifact.findUnique({
          where: { id: uploadedId },
          select: { objectKey: true },
        });
        if (app && row) {
          const blobs = app.get<BlobStore>(BLOB_STORE);
          await blobs.delete(row.objectKey);
        }
      } finally {
        await lookup.$disconnect();
      }
    }
    if (app) {
      await app.close();
    }
    if (isolated) {
      await dropIsolatedDatabase(isolated);
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
    const response = await fetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      body: form,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(response.status).toBe(201);
    const artifact = artifactEnvelopeSchema.parse(await response.json()).artifact;
    uploadedId = artifact.id;

    const contentUrl = new URL(artifact.contentUrl);
    expect(contentUrl.origin).toBe("http://localhost:3001");
    expect(contentUrl.search).toBe("");
    const content = await fetch(new URL(contentUrl.pathname, baseUrl), {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
    expect(content.headers.get("content-security-policy")).toBe(contentSecurityPolicy(["http://localhost:3000"]));
  });
});

function applyEnv(names: string[]): void {
  for (const name of names) {
    if (process.env[name]) {
      continue;
    }
    const value = readOptionalEnvValue(name);
    if (value) {
      process.env[name] = value;
    }
  }
}
