import "reflect-metadata";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { createFirstOrganization, signUp, TEST_AUTH_SECRET } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = fileURLToPath(new URL("../prisma/migrations/20261115200000_org_owned_api_keys/migration.sql", import.meta.url));
const migrationSql = readFileSync(migrationPath, "utf8");

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
  emailFromAddress: "support@example.com",
  emailFromName: "Factrove",
  emailLogoUrl: null,
  brevoApiKey: null,
  smtp: null,
  emailLogFullLinks: false,
};

describe("organization API key migration", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let prisma: PrismaClient;

  beforeAll(async () => {
    isolated = await createIsolatedDatabase();
    process.env.DATABASE_URL = isolated.databaseUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl },
    });
    prisma = new PrismaClient({ datasources: { db: { url: isolated.databaseUrl } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (isolated) {
      await dropIsolatedDatabase(isolated);
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  it("deletes every existing key, then requires referenceId to be an organization", async () => {
    expect(await prisma.apikey.count()).toBe(0);
    const artifact = migrationSql.indexOf("LOCK TABLE artifact IN ACCESS EXCLUSIVE MODE");
    const users = migrationSql.indexOf("FOR UPDATE;");
    const organization = migrationSql.indexOf("LOCK TABLE organization IN SHARE ROW EXCLUSIVE MODE");
    const apikey = migrationSql.indexOf("LOCK TABLE apikey IN ACCESS EXCLUSIVE MODE");
    const deleted = migrationSql.indexOf("DELETE FROM apikey");
    expect(artifact).toBeGreaterThan(-1);
    expect(artifact).toBeLessThan(users);
    expect(users).toBeLessThan(organization);
    expect(organization).toBeLessThan(apikey);
    expect(apikey).toBeLessThan(deleted);

    await expectForeignKey();
    await prisma.$executeRaw`ALTER TABLE apikey DROP CONSTRAINT "apikey_referenceId_fkey"`;
    const now = new Date();
    await prisma.organization.create({
      data: { id: "kept-org", name: "Kept", slug: "kept-org", createdAt: now },
    });
    await prisma.apikey.create({
      data: {
        id: "legacy-user-key",
        referenceId: "legacy-user",
        key: "legacy-hash",
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.apikey.create({
      data: {
        id: "kept-org-key",
        referenceId: "kept-org",
        key: "kept-hash",
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(await prisma.apikey.count()).toBe(2);

    await runMigration();
    expect(await prisma.apikey.count()).toBe(0);
    await expectForeignKey();
    expect(await functionExists()).toBe(false);

    await prisma.apikey.create({
      data: {
        id: "after-first-run",
        referenceId: "kept-org",
        key: "after-hash",
        createdAt: now,
        updatedAt: now,
      },
    });
    await runMigration();
    expect(await prisma.apikey.count()).toBe(0);
    await expectForeignKey();
    await expect(prisma.apikey.create({
      data: {
        id: "not-an-org",
        referenceId: "not-an-org",
        key: "bad-hash",
        createdAt: now,
        updatedAt: now,
      },
    })).rejects.toThrow(/apikey_referenceId_fkey/);
  });
});

describe("organization-owned API keys", () => {
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

  it("creates, lists, and deletes keys in the active organization", async () => {
    const ada = await signUp(baseUrl, {
      email: "ada-keys@example.com",
      password: "ada-keys-password",
      name: "Ada",
    });
    const adaOrg = await createFirstOrganization(baseUrl, ada.cookie, "Ada Lab");
    const bea = await signUp(baseUrl, {
      email: "bea-keys@example.com",
      password: "bea-keys-password",
      name: "Bea",
    });
    const beaOrg = await createFirstOrganization(baseUrl, bea.cookie, "Bea Lab");

    const created = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "cli",
        organizationId: beaOrg.id,
        userId: bea.userId,
        metadata: { createdByUserId: bea.userId, note: "no" },
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json() as { id?: string; key?: string; metadata?: { createdByUserId?: string; note?: string } };
    expect(createdBody.key).toBeTruthy();
    expect(createdBody.metadata).toEqual({ createdByUserId: ada.userId });
    const stored = await prisma.apikey.findUniqueOrThrow({ where: { id: createdBody.id } });
    expect(stored.referenceId).toBe(adaOrg.id);
    expect(readCreatedBy(stored.metadata)).toBe(ada.userId);

    const adaList = await listKeys(baseUrl, ada.cookie, beaOrg.id);
    expect(adaList.apiKeys.map((item) => item.id)).toEqual([createdBody.id]);
    const beaList = await listKeys(baseUrl, bea.cookie, adaOrg.id);
    expect(beaList.apiKeys).toEqual([]);

    const member = await signUp(baseUrl, {
      email: "member-keys@example.com",
      password: "member-keys-password",
      name: "Member",
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: adaOrg.id,
        userId: member.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    await prisma.session.updateMany({
      where: { userId: member.userId },
      data: { activeOrganizationId: adaOrg.id },
    });
    const memberSeen = await listKeys(baseUrl, member.cookie, beaOrg.id);
    expect(memberSeen.apiKeys.map((item) => item.id)).toEqual([createdBody.id]);
    const memberCreated = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: member.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "member-cli", organizationId: beaOrg.id }),
    });
    expect(memberCreated.status).toBe(200);
    const memberBody = await memberCreated.json() as { id: string };
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: memberBody.id } })).referenceId).toBe(adaOrg.id);

    const foreignDelete = await deleteKey(baseUrl, bea.cookie, createdBody.id ?? "");
    expect(foreignDelete.status).toBe(404);
    expect(await prisma.apikey.findUnique({ where: { id: createdBody.id } })).not.toBeNull();
    const memberDelete = await deleteKey(baseUrl, member.cookie, createdBody.id ?? "");
    expect(memberDelete.status).toBe(200);
    expect(await prisma.apikey.findUnique({ where: { id: createdBody.id } })).toBeNull();

    const adaKey = createdBody.key ?? "";
    const uploaded = await uploadHtml(baseUrl, adaKey, "<p>ada</p>");
    expect(uploaded.status).toBe(401);

    const replacement = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "upload" }),
    });
    expect(replacement.status).toBe(200);
    const replacementBody = await replacement.json() as { key: string };
    const adaUpload = await uploadHtml(baseUrl, replacementBody.key, "<p>ada</p>");
    expect(adaUpload.status).toBe(201);
    const adaArtifact = (await adaUpload.json() as { artifact: { id: string; organizationId: string; creatorUserId: string } }).artifact;
    expect(adaArtifact.organizationId).toBe(adaOrg.id);
    expect(adaArtifact.creatorUserId).toBe(ada.userId);

    const beaKeyResponse = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: bea.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "bea" }),
    });
    const beaKey = ((await beaKeyResponse.json()) as { key: string }).key;
    const beaUpload = await uploadHtml(baseUrl, beaKey, "<p>bea</p>");
    expect(beaUpload.status).toBe(201);
    const beaArtifact = (await beaUpload.json() as { artifact: { id: string; organizationId: string } }).artifact;
    expect(beaArtifact.organizationId).toBe(beaOrg.id);

    const hidden = await fetch(`${baseUrl}/api/v1/artifacts/${beaArtifact.id}`, {
      headers: { authorization: `Bearer ${replacementBody.key}` },
    });
    expect(hidden.status).toBe(404);
    const adaOrgList = await fetch(`${baseUrl}/api/v1/artifacts?view=org`, {
      headers: { authorization: `Bearer ${replacementBody.key}` },
    });
    expect(adaOrgList.status).toBe(200);
    expect(JSON.stringify(await adaOrgList.json())).not.toContain(beaArtifact.id);

    const shared = await fetch(`${baseUrl}/api/v1/artifacts/${beaArtifact.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${beaKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ accessType: "org_shared", organizationId: beaOrg.id }),
    });
    expect(shared.status).toBe(200);
    const stillHidden = await fetch(`${baseUrl}/api/v1/artifacts?view=org`, {
      headers: { authorization: `Bearer ${replacementBody.key}` },
    });
    expect(JSON.stringify(await stillHidden.json())).not.toContain(beaArtifact.id);
    const beaOrgList = await fetch(`${baseUrl}/api/v1/artifacts?view=org`, {
      headers: { authorization: `Bearer ${beaKey}` },
    });
    expect(JSON.stringify(await beaOrgList.json())).toContain(beaArtifact.id);

    const extraOrgId = "ada-extra-org";
    await prisma.organization.create({
      data: { id: extraOrgId, name: "Ada Extra", slug: "ada-extra", createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: extraOrgId,
        userId: ada.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const context = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${replacementBody.key}` },
    });
    expect(context.status).toBe(200);
    expect(await context.json()).toEqual({
      user: { id: ada.userId, name: "Ada" },
      organization: { id: adaOrg.id, name: "Ada Lab" },
    });
    const wrongOrg = await fetch(`${baseUrl}/api/v1/artifacts/${adaArtifact.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${replacementBody.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ accessType: "org_shared", organizationId: extraOrgId }),
    });
    expect(wrongOrg.status).toBe(409);
    expect((await wrongOrg.json() as { error: { code: string } }).error.code).toBe("ORGANIZATION_CHANGED");
    const rightOrg = await fetch(`${baseUrl}/api/v1/artifacts/${adaArtifact.id}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${replacementBody.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ accessType: "org_shared", organizationId: adaOrg.id }),
    });
    expect(rightOrg.status).toBe(200);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: adaArtifact.id } })).organizationId).toBe(adaOrg.id);

    await prisma.session.updateMany({
      where: { userId: ada.userId },
      data: { activeOrganizationId: extraOrgId },
    });
    const switchedList = await listKeys(baseUrl, ada.cookie, adaOrg.id);
    expect(switchedList.apiKeys.map((item) => item.id)).not.toContain(memberBody.id);
    const switchedCreate = await fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        cookie: ada.cookie,
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "extra", organizationId: adaOrg.id }),
    });
    expect(switchedCreate.status).toBe(200);
    const switchedBody = await switchedCreate.json() as { id: string; key: string };
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: switchedBody.id } })).referenceId).toBe(extraOrgId);
    const switchedDelete = await deleteKey(baseUrl, ada.cookie, memberBody.id);
    expect(switchedDelete.status).toBe(404);

    const extraUpload = await uploadHtml(baseUrl, switchedBody.key, "<p>extra</p>");
    expect(extraUpload.status).toBe(201);
    expect((await extraUpload.json() as { artifact: { organizationId: string; creatorUserId: string } }).artifact).toMatchObject({
      organizationId: extraOrgId,
      creatorUserId: ada.userId,
    });

    await prisma.member.deleteMany({ where: { userId: ada.userId, organizationId: adaOrg.id } });
    const revoked = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${replacementBody.key}` },
    });
    expect(revoked.status).toBe(401);
    const revokedUpload = await uploadHtml(baseUrl, replacementBody.key, "<p>no</p>");
    expect(revokedUpload.status).toBe(401);
  });
});

async function runMigration(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(migrationSql);
  } finally {
    await client.end();
  }
}

async function functionExists(): Promise<boolean> {
  const client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const rows = await client.$queryRaw<Array<{ name: string }>>`
      SELECT proname AS name FROM pg_proc WHERE proname = 'factrove_delete_api_keys'
    `;
    return rows.length > 0;
  } finally {
    await client.$disconnect();
  }
}

async function expectForeignKey(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    const rows = await prisma.$queryRaw<Array<{ delete_rule: string }>>`
      SELECT rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'apikey'
        AND tc.constraint_name = 'apikey_referenceId_fkey'
        AND kcu.column_name = 'referenceId'
        AND ccu.table_name = 'organization'
    `;
    expect(rows).toEqual([{ delete_rule: "RESTRICT" }]);
  } finally {
    await prisma.$disconnect();
  }
}

function readCreatedBy(metadata: string | null): string | null {
  if (!metadata) {
    return null;
  }
  const parsed = JSON.parse(metadata) as { createdByUserId?: unknown };
  return typeof parsed.createdByUserId === "string" ? parsed.createdByUserId : null;
}

async function listKeys(baseUrl: string, cookie: string, organizationId: string): Promise<{ apiKeys: Array<{ id: string }> }> {
  const response = await fetch(`${baseUrl}/api/auth/api-key/list?organizationId=${encodeURIComponent(organizationId)}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return await response.json() as { apiKeys: Array<{ id: string }> };
}

async function deleteKey(baseUrl: string, cookie: string, keyId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/api-key/delete`, {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ keyId }),
  });
}

async function uploadHtml(baseUrl: string, apiKey: string, html: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([new TextEncoder().encode(html)]), "keyed.html");
  return fetch(`${baseUrl}/api/v1/artifacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
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
