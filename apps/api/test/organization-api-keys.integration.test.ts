import "reflect-metadata";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
let beforeBlobDelete: (() => Promise<void>) | undefined;
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
        metadata: { createdByUserId: bea.userId, createdByMemberId: "forged-member", note: "no" },
      }),
    });
    expect(created.status).toBe(200);
    const adaMember = await prisma.member.findFirstOrThrow({
      where: { userId: ada.userId, organizationId: adaOrg.id },
    });
    const createdBody = await created.json() as {
      id?: string;
      key?: string;
      metadata?: { createdByUserId?: string; createdByMemberId?: string; note?: string };
    };
    expect(createdBody.key).toBeTruthy();
    expect(createdBody.metadata).toEqual({
      createdByUserId: ada.userId,
      createdByMemberId: adaMember.id,
    });
    const stored = await prisma.apikey.findUniqueOrThrow({ where: { id: createdBody.id } });
    expect(stored.referenceId).toBe(adaOrg.id);
    expect(readKeyMetadata(stored.metadata)).toEqual({
      createdByUserId: ada.userId,
      createdByMemberId: adaMember.id,
    });

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

  it("ignores an update that tries to change createdByUserId", async () => {
    const owner = await signUp(baseUrl, {
      email: "owner-meta@example.com",
      password: "owner-meta-password",
      name: "Owner Meta",
    });
    const org = await createFirstOrganization(baseUrl, owner.cookie, "Meta Lab");
    const ownerKey = await createKey(baseUrl, owner.cookie, "owner");
    const uploaded = await uploadHtml(baseUrl, ownerKey.key, "<p>owner-private</p>");
    expect(uploaded.status).toBe(201);
    const artifactId = ((await uploaded.json()) as { artifact: { id: string } }).artifact.id;

    const member = await signUp(baseUrl, {
      email: "member-meta@example.com",
      password: "member-meta-password",
      name: "Member Meta",
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: org.id,
        userId: member.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    await prisma.session.updateMany({
      where: { userId: member.userId },
      data: { activeOrganizationId: org.id },
    });
    const memberKey = await createKey(baseUrl, member.cookie, "member");
    const memberRow = await prisma.member.findFirstOrThrow({
      where: { userId: member.userId, organizationId: org.id },
    });
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: memberKey.id } })).metadata)).toEqual({
      createdByUserId: member.userId,
      createdByMemberId: memberRow.id,
    });

    const forged = await updateKey(baseUrl, member.cookie, {
      keyId: memberKey.id,
      metadata: { createdByUserId: owner.userId, createdByMemberId: "forged-member" },
    });
    expect(forged.status).not.toBe(200);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: memberKey.id } })).metadata)).toEqual({
      createdByUserId: member.userId,
      createdByMemberId: memberRow.id,
    });

    const renamed = await updateKey(baseUrl, member.cookie, {
      keyId: memberKey.id,
      name: "renamed",
      metadata: { createdByUserId: owner.userId, createdByMemberId: "forged-member", note: "no" },
    });
    expect(renamed.status).toBe(200);
    const stored = await prisma.apikey.findUniqueOrThrow({ where: { id: memberKey.id } });
    expect(stored.name).toBe("renamed");
    expect(readKeyMetadata(stored.metadata)).toEqual({
      createdByUserId: member.userId,
      createdByMemberId: memberRow.id,
    });

    const context = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${memberKey.key}` },
    });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      user: { id: member.userId, name: "Member Meta" },
      organization: { id: org.id },
    });
    const hidden = await fetch(`${baseUrl}/api/v1/artifacts/${artifactId}`, {
      headers: { authorization: `Bearer ${memberKey.key}` },
    });
    expect(hidden.status).toBe(404);
  });

  it("does not revive a key when the creator rejoins with a new membership", async () => {
    const owner = await signUp(baseUrl, {
      email: "rejoin-keys@example.com",
      password: "rejoin-keys-password",
      name: "Rejoin",
    });
    const org = await createFirstOrganization(baseUrl, owner.cookie, "Rejoin Lab");
    const created = await createKey(baseUrl, owner.cookie, "rejoin");
    const original = await prisma.member.findFirstOrThrow({
      where: { userId: owner.userId, organizationId: org.id },
    });
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: created.id } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: original.id,
    });
    const before = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(before.status).toBe(200);

    await prisma.member.delete({ where: { id: original.id } });
    const departed = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(departed.status).toBe(401);

    const rejoinedId = randomUUID();
    await prisma.member.create({
      data: {
        id: rejoinedId,
        organizationId: org.id,
        userId: owner.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    await prisma.session.updateMany({
      where: { userId: owner.userId },
      data: { activeOrganizationId: org.id },
    });
    const revived = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${created.key}` },
    });
    expect(revived.status).toBe(401);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: created.id } })).metadata).createdByMemberId).toBe(original.id);

    const fresh = await createKey(baseUrl, owner.cookie, "rejoin-new");
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: fresh.id } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: rejoinedId,
    });
    const after = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${fresh.key}` },
    });
    expect(after.status).toBe(200);
  });

  it("binds a rollout key that has no membership id and does not rebind it after the creator rejoins", async () => {
    const owner = await signUp(baseUrl, {
      email: "rollout-keys@example.com",
      password: "rollout-keys-password",
      name: "Rollout",
    });
    const org = await createFirstOrganization(baseUrl, owner.cookie, "Rollout Lab");
    const member = await prisma.member.findFirstOrThrow({
      where: { userId: owner.userId, organizationId: org.id },
    });
    const secret = await insertRolloutKey(prisma, {
      id: "rollout-key",
      organizationId: org.id,
      userId: owner.userId,
    });
    const [first, second] = await Promise.all([
      fetch(`${baseUrl}/api/v1/context`, { headers: { authorization: `Bearer ${secret}` } }),
      fetch(`${baseUrl}/api/v1/context`, { headers: { authorization: `Bearer ${secret}` } }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: "rollout-key" } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: member.id,
    });
    const again = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(again.status).toBe(200);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: "rollout-key" } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: member.id,
    });

    await prisma.member.delete({ where: { id: member.id } });
    const rejoinedId = randomUUID();
    await prisma.member.create({
      data: {
        id: rejoinedId,
        organizationId: org.id,
        userId: owner.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    const revived = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(revived.status).toBe(401);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: "rollout-key" } })).metadata).createdByMemberId).toBe(member.id);

    const unbound = await insertRolloutKey(prisma, {
      id: "rollout-unbound",
      organizationId: org.id,
      userId: owner.userId,
    });
    await prisma.member.delete({ where: { id: rejoinedId } });
    const rejected = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${unbound}` },
    });
    expect(rejected.status).toBe(401);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: "rollout-unbound" } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: null,
    });

    const otherOrg = randomUUID();
    await prisma.organization.create({
      data: { id: otherOrg, name: "Other Lab", slug: otherOrg, createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: otherOrg,
        userId: owner.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    const elsewhere = await fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${unbound}` },
    });
    expect(elsewhere.status).toBe(401);
    expect(readKeyMetadata((await prisma.apikey.findUniqueOrThrow({ where: { id: "rollout-unbound" } })).metadata)).toEqual({
      createdByUserId: owner.userId,
      createdByMemberId: null,
    });
  });

  it("keeps a key inside its own organization when the creator also belongs to another", async () => {
    const user = await signUp(baseUrl, {
      email: "two-orgs@example.com",
      password: "two-orgs-password",
      name: "Two Orgs",
    });
    const orgA = await createFirstOrganization(baseUrl, user.cookie, "Org A");
    const keyA = await createKey(baseUrl, user.cookie, "org-a");
    const orgB = "same-creator-org-b";
    await prisma.organization.create({
      data: { id: orgB, name: "Org B", slug: "same-creator-org-b", createdAt: new Date() },
    });
    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: orgB,
        userId: user.userId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await prisma.session.updateMany({
      where: { userId: user.userId },
      data: { activeOrganizationId: orgB },
    });
    const keyB = await createKey(baseUrl, user.cookie, "org-b");
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: keyB.id } })).referenceId).toBe(orgB);

    const uploaded = await uploadHtml(baseUrl, keyB.key, "<p>org-b</p>");
    expect(uploaded.status).toBe(201);
    const artifact = ((await uploaded.json()) as { artifact: { id: string; name: string | null; organizationId: string } }).artifact;
    expect(artifact.organizationId).toBe(orgB);
    const keyAHeaders = { authorization: `Bearer ${keyA.key}` };

    const detail = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, { headers: keyAHeaders });
    const content = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`, { headers: keyAHeaders });
    const mine = await fetch(`${baseUrl}/api/v1/artifacts?view=mine`, { headers: keyAHeaders });
    const rename = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/name`, {
      method: "PATCH",
      headers: { ...keyAHeaders, "content-type": "application/json" },
      body: JSON.stringify({ name: "Stolen" }),
    });
    const replaced = await putHtml(baseUrl, keyA.key, artifact.id, "<p>stolen</p>");
    const shared = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
      headers: keyAHeaders,
    });
    const rehome = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, {
      method: "PATCH",
      headers: { ...keyAHeaders, "content-type": "application/json" },
      body: JSON.stringify({ accessType: "org_shared", organizationId: orgA.id }),
    });
    const removed = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, {
      method: "DELETE",
      headers: keyAHeaders,
    });

    for (const response of [detail, content, rename, replaced, shared, rehome, removed]) {
      expect(response.status).toBe(404);
    }
    expect(JSON.stringify(await mine.json())).not.toContain(artifact.id);
    const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(row.organizationId).toBe(orgB);
    expect(row.name).toBe(artifact.name);
    expect(row.accessType).toBe("private");
    expect(row.shareTokenHash).toBeNull();

    const visible = await fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, {
      headers: { authorization: `Bearer ${keyB.key}` },
    });
    expect(visible.status).toBe(200);
    const listed = await fetch(`${baseUrl}/api/v1/artifacts?view=mine`, {
      headers: { authorization: `Bearer ${keyB.key}` },
    });
    expect(JSON.stringify(await listed.json())).toContain(artifact.id);
  });

  it("does not delete a key's artifact after it moves to another organization", async () => {
    const user = await signUp(baseUrl, {
      email: "delete-race@example.com",
      password: "delete-race-password",
      name: "Delete Race",
    });
    const orgA = await createFirstOrganization(baseUrl, user.cookie, "Delete Org A");
    const keyA = await createKey(baseUrl, user.cookie, "delete-a");
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: keyA.id } })).referenceId).toBe(orgA.id);
    const uploaded = await uploadHtml(baseUrl, keyA.key, "<p>stay</p>");
    expect(uploaded.status).toBe(201);
    const artifactId = ((await uploaded.json()) as { artifact: { id: string } }).artifact.id;
    const orgB = "delete-race-org-b";
    await prisma.organization.create({
      data: { id: orgB, name: "Delete Org B", slug: orgB, createdAt: new Date() },
    });
    beforeBlobDelete = async () => {
      await prisma.artifact.update({ where: { id: artifactId }, data: { organizationId: orgB } });
    };
    try {
      const removed = await fetch(`${baseUrl}/api/v1/artifacts/${artifactId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${keyA.key}` },
      });
      expect(removed.status).toBe(404);
      const row = await prisma.artifact.findUnique({ where: { id: artifactId } });
      expect(row?.organizationId).toBe(orgB);
      expect(row?.creatorUserId).toBe(user.userId);
    } finally {
      beforeBlobDelete = undefined;
    }
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

async function insertRolloutKey(
  prisma: PrismaService,
  input: { id: string; organizationId: string; userId: string },
): Promise<string> {
  const secret = `ftrv_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  await prisma.apikey.create({
    data: {
      id: input.id,
      name: input.id,
      start: secret.slice(0, 12),
      prefix: "ftrv_",
      referenceId: input.organizationId,
      metadata: JSON.stringify({ createdByUserId: input.userId }),
      key: createHash("sha256").update(secret).digest("base64url"),
      enabled: true,
      rateLimitEnabled: false,
      createdAt: now,
      updatedAt: now,
    },
  });
  return secret;
}

function readKeyMetadata(metadata: string | null): { createdByUserId: string | null; createdByMemberId: string | null } {
  if (!metadata) {
    return { createdByUserId: null, createdByMemberId: null };
  }
  const parsed = JSON.parse(metadata) as { createdByUserId?: unknown; createdByMemberId?: unknown };
  return {
    createdByUserId: typeof parsed.createdByUserId === "string" ? parsed.createdByUserId : null,
    createdByMemberId: typeof parsed.createdByMemberId === "string" ? parsed.createdByMemberId : null,
  };
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

async function createKey(baseUrl: string, cookie: string, name: string): Promise<{ id: string; key: string }> {
  const response = await fetch(`${baseUrl}/api/auth/api-key/create`, {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { id?: string; key?: string };
  if (!body.id || !body.key) {
    throw new Error("api key create did not return a key");
  }
  return { id: body.id, key: body.key };
}

async function updateKey(baseUrl: string, cookie: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/auth/api-key/update`, {
    method: "POST",
    headers: {
      cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

async function putHtml(baseUrl: string, apiKey: string, id: string, html: string): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([new TextEncoder().encode(html)]), "keyed.html");
  return fetch(`${baseUrl}/api/v1/artifacts/${id}/content`, {
    method: "PUT",
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
      const hook = beforeBlobDelete;
      beforeBlobDelete = undefined;
      if (hook) {
        await hook();
      }
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
