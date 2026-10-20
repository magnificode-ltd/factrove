import "reflect-metadata";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CreateArtifactInput } from "../src/database/types/artifact-record.js";
import { ArtifactsRepository } from "../src/database/repositories/artifacts.repository.js";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  localOrganizationFixture,
  localUserFixture,
  seedLocalIdentities,
} from "../src/database/seed/seed-local-identities.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
const configPath = fileURLToPath(new URL("../auth-schema.config.ts", import.meta.url));
const testDatabaseName = "factrove_test";

function withDatabase(databaseUrl: string, database: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.href;
}

function artifactInput(overrides: Partial<CreateArtifactInput> = {}): CreateArtifactInput {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    creatorUserId: localUserFixture.id,
    organizationId: localOrganizationFixture.id,
    accessType: "private",
    mimeType: "text/html",
    sizeBytes: 12,
    ...overrides,
  };
}

describe("Better Auth schema generation", () => {
  it("regenerates the Prisma schema from the backend auth config without changing it", async () => {
    const config = await readFile(configPath, "utf8");
    expect(config).toContain("prismaAdapter(prisma, {");
    expect(config).toContain('provider: "postgresql"');
    expect(config).toContain("plugins: [organization(), factroveApiKey()]");

    const before = await readFile(schemaPath, "utf8");
    const result = await execFileAsync("pnpm", ["db:generate-schema"], { cwd: apiRoot });
    const after = await readFile(schemaPath, "utf8");
    const output = `${result.stdout}\n${result.stderr}`;

    expect(after).toBe(before);
    expect(output).toContain("already up to date");
    expect(output).not.toContain("Prisma schema mismatch");
    expect(after).toContain("model User");
    expect(after).toContain("model Organization");
    expect(after).toContain("model Session");
    expect(after).toContain("model Account");
    expect(after).toContain("model Verification");
    expect(after).toContain("model Member");
    expect(after).toContain("model Invitation");
    expect(after).toContain("model Artifact");
    expect(after).not.toMatch(/userId\s+String\s+@unique/);
    expect(after).not.toMatch(/@@unique\(\[userId\]\)/);
  });
});

describe("PostgreSQL artifact persistence", () => {
  let prisma: PrismaService;
  let repository: ArtifactsRepository;
  let secondDeployOutput = "";

  beforeAll(async () => {
    loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) {
      throw new Error("DATABASE_URL is required. Point apps/api/.env at the local PostgreSQL server.");
    }

    const admin = new Client({ connectionString: withDatabase(baseUrl, "postgres") });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${testDatabaseName} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${testDatabaseName}`);
    } finally {
      await admin.end();
    }

    const testUrl = withDatabase(baseUrl, testDatabaseName);
    process.env.DATABASE_URL = testUrl;
    const migrateEnv = { ...process.env, DATABASE_URL: testUrl };
    const migrateArgs = ["exec", "prisma", "migrate", "deploy"];
    await execFileAsync("pnpm", migrateArgs, { cwd: apiRoot, env: migrateEnv });
    const second = await execFileAsync("pnpm", migrateArgs, { cwd: apiRoot, env: migrateEnv });
    secondDeployOutput = `${second.stdout}\n${second.stderr}`;

    prisma = new PrismaService();
    await prisma.$connect();
    repository = new ArtifactsRepository(prisma);
    await seedLocalIdentities(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.artifact.deleteMany();
    await prisma.member.deleteMany();
    await prisma.invitation.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: localUserFixture.id } } });
    await prisma.organization.deleteMany({ where: { id: { not: localOrganizationFixture.id } } });
  });

  it("applies the initial migration once and reports no pending changes on the next deploy", async () => {
    expect(secondDeployOutput).toContain("No pending migrations to apply.");
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations ORDER BY migration_name
    `;
    expect(applied.map((row) => row.migration_name)).toEqual([
      "20261011120000_add_identity_and_artifact",
      "20261018210000_add_apikey",
      "20261020120000_add_artifact_share",
    ]);
  });

  it("references generated user and organization identities and leaves member.userId non-unique", async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;
    expect(tables.map((row) => row.tablename)).toEqual([
      "account",
      "apikey",
      "artifact",
      "invitation",
      "member",
      "organization",
      "session",
      "user",
      "verification",
    ]);

    const foreignKeys = await prisma.$queryRaw<
      { column_name: string; foreign_table: string; delete_rule: string }[]
    >`
      SELECT kcu.column_name, ccu.table_name AS foreign_table, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = 'artifact' AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY kcu.column_name
    `;
    expect(foreignKeys).toEqual([
      { column_name: "creator_user_id", foreign_table: "user", delete_rule: "RESTRICT" },
      { column_name: "organization_id", foreign_table: "organization", delete_rule: "RESTRICT" },
    ]);

    const memberIndexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'member'
    `;
    expect(
      memberIndexes.filter(
        (row) =>
          row.indexdef.includes("UNIQUE") &&
          row.indexdef.includes("userId") &&
          !row.indexdef.includes("organizationId"),
      ),
    ).toEqual([]);

    const artifactIndexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'artifact' ORDER BY indexname
    `;
    expect(artifactIndexes.map((row) => row.indexname)).toEqual([
      "artifact_creator_created_id_idx",
      "artifact_org_access_created_id_idx",
      "artifact_pkey",
      "artifact_share_token_hash_key",
    ]);

    const createdAtType = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'artifact' AND column_name = 'created_at'
    `;
    expect(createdAtType[0]?.data_type).toBe("timestamp with time zone");
  });

  it("allows one user to belong to multiple organizations", async () => {
    const createdAt = new Date("2026-02-01T00:00:00.000Z");
    await prisma.organization.create({
      data: { id: "other-org", name: "Other Organization", slug: "other", createdAt },
    });
    await prisma.member.create({
      data: {
        id: "member-local",
        organizationId: localOrganizationFixture.id,
        userId: localUserFixture.id,
        createdAt,
      },
    });
    await prisma.member.create({
      data: { id: "member-other", organizationId: "other-org", userId: localUserFixture.id, createdAt },
    });

    const memberships = await prisma.member.findMany({
      where: { userId: localUserFixture.id },
      orderBy: { id: "asc" },
    });
    expect(memberships.map((row) => row.organizationId)).toEqual(["local-org", "other-org"]);
  });

  it("keeps local fixture ids stable when the seed runs twice", async () => {
    await seedLocalIdentities(prisma);
    await seedLocalIdentities(prisma);

    const users = await prisma.user.findMany();
    const organizations = await prisma.organization.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: localUserFixture.id,
      name: localUserFixture.name,
      email: localUserFixture.email,
      emailVerified: localUserFixture.emailVerified,
    });
    expect(organizations).toHaveLength(1);
    expect(organizations[0]).toMatchObject({
      id: localOrganizationFixture.id,
      name: localOrganizationFixture.name,
      slug: localOrganizationFixture.slug,
    });
    expect(organizations[0]?.createdAt.toISOString()).toBe(localOrganizationFixture.createdAt.toISOString());
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });

  it("filters mine and org artifacts independently", async () => {
    await prisma.user.create({
      data: {
        id: "other-user",
        name: "Other User",
        email: "other@example.invalid",
        emailVerified: false,
      },
    });
    const minePrivate = await repository.create(artifactInput({ accessType: "private" }));
    const mineShared = await repository.create(artifactInput({ accessType: "org_shared" }));
    const otherPrivate = await repository.create(
      artifactInput({ creatorUserId: "other-user", accessType: "private" }),
    );
    const otherShared = await repository.create(
      artifactInput({ creatorUserId: "other-user", accessType: "org_shared" }),
    );

    const mine = await repository.list({
      view: "mine",
      userId: localUserFixture.id,
      organizationId: localOrganizationFixture.id,
    });
    const org = await repository.list({
      view: "org",
      userId: localUserFixture.id,
      organizationId: localOrganizationFixture.id,
    });
    const otherMine = await repository.list({
      view: "mine",
      userId: "other-user",
      organizationId: localOrganizationFixture.id,
    });
    const noOrganization = await repository.list({
      view: "org",
      userId: localUserFixture.id,
      organizationId: null,
    });

    expect(mine.map((row) => row.id).sort()).toEqual([minePrivate.id, mineShared.id].sort());
    expect(org.map((row) => row.id).sort()).toEqual([mineShared.id, otherShared.id].sort());
    expect(otherMine.map((row) => row.id).sort()).toEqual([otherPrivate.id, otherShared.id].sort());
    expect(noOrganization).toEqual([]);
    expect(org.some((row) => row.id === otherPrivate.id)).toBe(false);
    expect((await repository.findById(mineShared.id))?.id).toBe(mineShared.id);
    expect(await repository.findById(randomUUID())).toBeNull();
  });

  it("orders artifacts by created_at descending and then id descending", async () => {
    const olderId = "00000000-0000-4000-8000-000000000002";
    const newerId = "00000000-0000-4000-8000-000000000001";
    const tieLow = "00000000-0000-4000-8000-000000000010";
    const tieHigh = "00000000-0000-4000-8000-000000000020";
    for (const id of [olderId, newerId, tieLow, tieHigh]) {
      await repository.create(artifactInput({ id }));
    }
    await prisma.artifact.update({
      where: { id: olderId },
      data: { createdAt: new Date("2026-10-01T00:00:00.000Z") },
    });
    await prisma.artifact.update({
      where: { id: newerId },
      data: { createdAt: new Date("2026-10-02T00:00:00.000Z") },
    });
    const sameTime = new Date("2026-09-01T00:00:00.000Z");
    await prisma.artifact.update({ where: { id: tieLow }, data: { createdAt: sameTime } });
    await prisma.artifact.update({ where: { id: tieHigh }, data: { createdAt: sameTime } });

    const listed = await repository.list({
      view: "mine",
      userId: localUserFixture.id,
      organizationId: localOrganizationFixture.id,
    });
    expect(listed.map((row) => row.id)).toEqual([newerId, olderId, tieHigh, tieLow]);
    expect(listed[0]?.createdAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("updates and deletes an artifact without changing created_at", async () => {
    const created = await repository.create(artifactInput());
    const uploadedAt = new Date("2026-10-11T15:04:05.000Z");
    const updated = await repository.update(created.id, { sizeBytes: 40, uploadedAt, accessType: "org_shared" });

    expect(updated.createdAt.toISOString()).toBe(created.createdAt.toISOString());
    expect(updated.sizeBytes).toBe(40);
    expect(updated.accessType).toBe("org_shared");
    expect(updated.uploadedAt?.toISOString()).toBe("2026-10-11T15:04:05.000Z");
    const stored = await prisma.artifact.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.createdAt.toISOString()).toBe(created.createdAt.toISOString());

    const deleted = await repository.delete(created.id);
    expect(deleted.id).toBe(created.id);
    expect(await repository.findById(created.id)).toBeNull();
    await expect(repository.update(created.id, { sizeBytes: 1 })).rejects.toMatchObject({ code: "P2025" });
    await expect(repository.delete(created.id)).rejects.toMatchObject({ code: "P2025" });
  });

  it("stores a share token for the owner and looks public links up by hash", async () => {
    const created = await repository.create(artifactInput());
    expect(created.shareToken).toBeNull();
    expect(created.shareTokenHash).toBeNull();
    const token = "share-token-value";
    const hash = "a".repeat(64);
    const saved = await repository.saveShare(created.id, token, hash);
    expect(saved?.shareToken).toBe(token);
    expect(saved?.shareTokenHash).toBe(hash);
    const raced = await repository.saveShare(created.id, "other-token", "b".repeat(64));
    expect(raced).toBeNull();
    expect((await repository.findById(created.id))?.shareToken).toBe(token);

    const shared = await repository.findShared(created.id, hash);
    expect(shared?.id).toBe(created.id);
    expect(shared?.shareToken).toBeNull();
    expect(shared?.shareTokenHash).toBe(hash);
    expect(await repository.findShared(created.id, "b".repeat(64))).toBeNull();
    expect(await repository.findShared(randomUUID(), hash)).toBeNull();

    const cleared = await repository.clearShare(created.id);
    expect(cleared.shareToken).toBeNull();
    expect(cleared.shareTokenHash).toBeNull();
    expect(await repository.findShared(created.id, hash)).toBeNull();
  });

  it("rejects missing creators, org_shared without an organization, and unknown access values", async () => {
    const personal = await repository.create(artifactInput({ organizationId: null, accessType: "private" }));
    expect(personal.organizationId).toBeNull();

    await expect(repository.create(artifactInput({ creatorUserId: "missing-user" }))).rejects.toMatchObject({
      code: "P2003",
    });
    await expect(repository.create(artifactInput({ accessType: "org_shared", organizationId: null }))).rejects.toThrow(
      /artifact_org_shared_requires_organization_check|23514/,
    );
    await expect(repository.create(artifactInput({ sizeBytes: -1 }))).rejects.toThrow(
      /artifact_size_bytes_nonnegative_check|23514/,
    );

    const id = randomUUID();
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "artifact" ("id", "creator_user_id", "organization_id", "access_type", "mime_type", "size_bytes", "updated_at")
         VALUES ($1::uuid, $2, $3, 'public', 'text/html', 1, NOW())`,
        id,
        localUserFixture.id,
        localOrganizationFixture.id,
      ),
    ).rejects.toThrow(/invalid input value for enum/);
  });
});
