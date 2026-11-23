import "reflect-metadata";
import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER } from "../src/auth/client-ip.js";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { createSessionApiKey, signUp, TEST_AUTH_SECRET } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

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

describe("create the first organization", () => {
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

  it("creates one owner organization for a session and rejects product routes until then", async () => {
    const first = await signUp(baseUrl, {
      email: "ada@example.com",
      password: "ada-password-1",
      name: "Ada",
    });
    const before = await fetch(`${baseUrl}/api/v1/artifacts`, { headers: { cookie: first.cookie } });
    expect(before.status).toBe(403);
    expect(await before.json()).toEqual({
      error: { code: "ORGANIZATION_SETUP_REQUIRED", message: "Create an organization to continue." },
    });

    const created = await postOrganization(baseUrl, first.cookie, { name: "  Ada Lab  " });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { organization: { id: string; name: string } };
    expect(body.organization.name).toBe("Ada Lab");
    expect(body.organization).not.toHaveProperty("slug");

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: body.organization.id } });
    expect(row.slug).toBe("ada-lab");
    const member = await prisma.member.findFirstOrThrow({ where: { userId: first.userId } });
    expect(member).toMatchObject({ organizationId: row.id, role: "owner" });
    const session = await prisma.session.findFirstOrThrow({ where: { userId: first.userId } });
    expect(session.activeOrganizationId).toBe(row.id);

    const context = await fetch(`${baseUrl}/api/v1/context`, { headers: { cookie: first.cookie } });
    expect(await context.json()).toMatchObject({
      user: { id: first.userId, name: "Ada" },
      organization: { id: row.id, name: "Ada Lab" },
    });

    const again = await postOrganization(baseUrl, first.cookie, { name: "Second" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: { code: "ORGANIZATION_EXISTS", message: "You already belong to an organization." },
    });
    expect(await prisma.member.count({ where: { userId: first.userId } })).toBe(1);

    const key = await createSessionApiKey(baseUrl, first.cookie, "ada");
    const byKey = await fetch(`${baseUrl}/api/v1/onboarding/organization`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: "Key Org" }),
    });
    expect(byKey.status).toBe(401);

    const invalid = await postOrganization(baseUrl, first.cookie, { name: "Ada\nLab", slug: "ada" });
    expect(invalid.status).toBe(400);

    const second = await signUp(baseUrl, {
      email: "bea@example.com",
      password: "bea-password-1",
      name: "Bea",
    });
    const collided = await postOrganization(baseUrl, second.cookie, { name: "Ada Lab" });
    expect(collided.status).toBe(201);
    const secondBody = (await collided.json()) as { organization: { id: string } };
    const secondRow = await prisma.organization.findUniqueOrThrow({ where: { id: secondBody.organization.id } });
    expect(secondRow.slug).not.toBe(row.slug);

    const plugin = await fetch(`${baseUrl}/api/auth/organization/create`, {
      method: "POST",
      headers: {
        cookie: second.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Plugin", slug: "plugin" }),
    });
    expect(plugin.status).toBe(403);
  });

  it("limits organization creates per socket address and ignores a spoofed client IP", async () => {
    const limited = await createApp(config);
    await limited.listen(0, "127.0.0.1");
    try {
      const port = Number(new URL(await limited.getUrl()).port);
      const firstPeer: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        firstPeer.push(await postOrganizationFrom(port, "127.0.0.1"));
      }
      expect(firstPeer).toEqual(Array.from({ length: 10 }, () => 401));

      const spoofed = await postOrganizationFrom(port, "127.0.0.1");
      expect(spoofed).toBe(429);

      const absoluteForm = await postOrganizationAbsolute(port, "127.0.0.1");
      expect(absoluteForm).toBe(429);

      const secondPeer = await postOrganizationFrom(port, "127.0.0.2");
      expect(secondPeer).toBe(401);

      const absoluteOtherPeer = await postOrganizationAbsolute(port, "127.0.0.2");
      expect(absoluteOtherPeer).toBe(401);
    } finally {
      await limited.close();
    }
  });
});

function postOrganizationFrom(port: number, localAddress: string): Promise<number> {
  const body = JSON.stringify({ name: "Nope" });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        localAddress,
        method: "POST",
        path: "/api/v1/onboarding/organization",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "content-length": Buffer.byteLength(body),
          "x-forwarded-for": "203.0.113.9",
          [CLIENT_IP_HEADER]: "198.51.100.9",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

function postOrganizationAbsolute(port: number, localAddress: string): Promise<number> {
  const body = JSON.stringify({ name: "Nope" });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        localAddress,
        method: "POST",
        path: `http://127.0.0.1:${port}/api/v1/onboarding/organization`,
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "content-length": Buffer.byteLength(body),
          "x-forwarded-for": "203.0.113.9",
          [CLIENT_IP_HEADER]: "198.51.100.50",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function postOrganization(baseUrl: string, cookie: string | undefined, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/onboarding/organization`, {
    method: "POST",
    headers: {
      ...(cookie ? { cookie } : {}),
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function createApp(appConfig: ApiConfig): Promise<INestApplication> {
  const store: BlobStore = {
    async put() {},
    async get() {
      throw new Error("unused");
    },
    async delete() {},
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
