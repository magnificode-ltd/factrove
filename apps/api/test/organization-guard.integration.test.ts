import "reflect-metadata";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { createFirstOrganization, createSessionApiKey, signUp, TEST_AUTH_SECRET } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const artifactId = "00000000-0000-4000-8000-000000000041";

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
  turnstileSecret: null,
  emailTransport: "log",
  emailFromAddress: "support@example.com",
  emailFromName: "Factrove",
  emailLogoUrl: null,
  brevoApiKey: null,
  smtp: null,
  emailLogFullLinks: false,
};

describe("organization guard", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let app: INestApplication;
  let baseUrl = "";
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
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
    app = await createApp(config);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
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

  it("rejects product routes until the user has an organization", async () => {
    const user = await signUp(baseUrl, {
      email: "guard@example.com",
      password: "guard-password-1",
      name: "Guard",
    });
    const setupRequired = {
      code: "ORGANIZATION_SETUP_REQUIRED",
      message: "Create an organization to continue.",
    };
    const routes: Array<{ method: string; path: string; body?: BodyInit; contentType?: string }> = [
      { method: "GET", path: "/api/v1/artifacts" },
      { method: "GET", path: `/api/v1/artifacts/${artifactId}` },
      { method: "POST", path: "/api/v1/artifacts", body: fileBody(), contentType: "" },
      { method: "PUT", path: `/api/v1/artifacts/${artifactId}/content`, body: fileBody(), contentType: "" },
      { method: "PATCH", path: `/api/v1/artifacts/${artifactId}/name`, body: JSON.stringify({ name: "Nope" }), contentType: "application/json" },
      { method: "DELETE", path: `/api/v1/artifacts/${artifactId}` },
      { method: "POST", path: `/api/v1/artifacts/${artifactId}/share`, body: "{}", contentType: "application/json" },
      { method: "GET", path: "/api/v1/context" },
    ];
    for (const route of routes) {
      const response = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        headers: {
          cookie: user.cookie,
          origin: "http://localhost:3000",
          ...(route.contentType ? { "content-type": route.contentType } : {}),
        },
        body: route.body,
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
      expect(await response.json()).toEqual({ error: setupRequired });
    }

    const health = await fetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });

    const session = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie: user.cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: { id: user.userId, name: "Guard" } });

    const key = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: user.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "early" }),
    });
    expect(key.status).toBe(403);
    expect(await key.text()).toContain("ORGANIZATION_SETUP_REQUIRED");

    await createFirstOrganization(baseUrl, user.cookie, "Guard Lab");
    const list = await fetch(`${baseUrl}/api/v1/artifacts`, { headers: { cookie: user.cookie } });
    expect(list.status).toBe(200);
    const created = await fetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { cookie: user.cookie, origin: "http://localhost:3000" },
      body: fileBody(),
    });
    expect(created.status).toBe(201);
    const artifact = (await created.json() as { artifact: { id: string; organizationId: string } }).artifact;
    expect(artifact.organizationId).not.toBe("");
    const share = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
      headers: {
        cookie: user.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(share.status).toBe(200);
    const shareUrl = ((await share.json()) as { share: { shareUrl: string } }).share.shareUrl;
    const token = shareUrl.split("/").at(-1) ?? "";
    const published = await fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}`);
    expect(published.status).toBe(200);

    const createdKey = await createSessionApiKey(baseUrl, user.cookie, "later");
    const keyed = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${createdKey.apiKey}` },
    });
    expect(keyed.status).toBe(200);

    const leaving = await signUp(baseUrl, {
      email: "leave@example.com",
      password: "leave-password-1",
      name: "Leave",
    });
    const signedOut = await fetch(`${baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie: leaving.cookie, origin: "http://localhost:3000" },
    });
    expect(signedOut.status).toBe(200);
    const after = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie: leaving.cookie } });
    expect(await after.json()).toBeNull();
  });

  it("returns 409 when several memberships have no active organization", async () => {
    const user = await signUp(baseUrl, {
      email: "select@example.com",
      password: "select-password-1",
      name: "Select",
    });
    await createFirstOrganization(baseUrl, user.cookie, "Select Lab");
    await prisma.organization.create({
      data: { id: "select-other", name: "Select Other", slug: "select-other", createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: "select-other-member",
        organizationId: "select-other",
        userId: user.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    await prisma.session.updateMany({
      where: { userId: user.userId },
      data: { activeOrganizationId: null },
    });
    const response = await fetch(`${baseUrl}/api/v1/context`, { headers: { cookie: user.cookie } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "ORGANIZATION_SELECTION_REQUIRED",
        message: "Choose an organization to continue.",
      },
    });
  });
});

function fileBody(): FormData {
  const form = new FormData();
  form.append("file", new Blob([new TextEncoder().encode("<p>guard</p>")]), "guard.html");
  return form;
}

async function createApp(appConfig: ApiConfig): Promise<INestApplication> {
  const objects = new Map<string, Uint8Array>();
  const store: BlobStore = {
    async put(input) {
      objects.set(input.objectKey, input.body);
    },
    async get(objectKey) {
      const body = objects.get(objectKey);
      if (!body) {
        throw new Error("missing object");
      }
      return { body: (async function* stream() { yield body; })() };
    },
    async delete(objectKey) {
      objects.delete(objectKey);
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(API_CONFIG)
    .useValue(appConfig)
    .overrideProvider(BLOB_STORE)
    .useValue(store)
    .compile();
  const application = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  configureHttpApp(application);
  await application.init();
  return application;
}
