import "reflect-metadata";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backfillOrganizationDisplayName } from "../src/auth/organization-backfill-name.js";
import { organizationSlugCandidates } from "../src/auth/organization-slug.js";
import { claimLocalArtifacts } from "../src/database/seed/claim-local-artifacts.js";
import { localOrganizationFixture, localUserFixture, seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

describe("organization backfill", () => {
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
    await seedLocalIdentities(prisma);
    await prisma.$executeRaw`ALTER TABLE artifact ALTER COLUMN organization_id DROP NOT NULL`;
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

  it("uses the same slug and display-name rules as create-first-organization", async () => {
    const names = ["Ada Lab", "Local", "!!!", "Árvíz", "b".repeat(47), "c".repeat(48), "Tom's organization"];
    for (const name of names) {
      const expected = organizationSlugCandidates(name, () => "abc123");
      const actual = await slugCandidates(prisma, name, ["abc123"]);
      expect(actual).toEqual(expected);
    }
    const namesAndEmails: Array<[string, string]> = [
      ["  Tom  ", "tom@example.com"],
      ["   ", "ada.lovelace@example.com"],
      ["", "@example.com"],
      ["Tom\nX", "tom@example.com"],
      ["a".repeat(80), "a@example.com"],
      ["\nTom\n", "tom@example.com"],
    ];
    for (const [name, email] of namesAndEmails) {
      const rows = await prisma.$queryRaw<Array<{ display_name: string }>>`
        SELECT factrove_backfill_display_name(${name}, ${email}) AS display_name
      `;
      expect(rows[0]?.display_name).toBe(backfillOrganizationDisplayName(name, email));
    }
  });

  it("stops when a null artifact has a creator with several memberships", async () => {
    const userId = "user-many";
    await expect(prisma.$transaction(async (tx) => {
      await insertUser(tx, { id: userId, name: "Many", email: "many@example.com" });
      await insertOrganization(tx, { id: "many-a", name: "Many A", slug: "many-a" });
      await insertOrganization(tx, { id: "many-b", name: "Many B", slug: "many-b" });
      await insertMember(tx, { id: "many-member-a", organizationId: "many-a", userId });
      await insertMember(tx, { id: "many-member-b", organizationId: "many-b", userId });
      await insertArtifact(tx, { id: randomUUID(), creatorUserId: userId, organizationId: null });
      await tx.$queryRaw`SELECT factrove_backfill_organizations()`;
    })).rejects.toThrow(/organization_id is null for creator user-many/);
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
  });

  it("creates one owner organization per user, fills artifacts, and can run again", async () => {
    await insertUser(prisma, { id: "user-tom-a", name: "  Tom  ", email: "tom.a@example.com" });
    await insertUser(prisma, { id: "user-tom-b", name: "Tom", email: "tom.b@example.com" });
    await insertUser(prisma, { id: "user-blank", name: "   ", email: "ada.lovelace@example.com" });
    await insertUser(prisma, { id: "user-bad", name: "Tom\nX", email: "bad@example.com" });
    await insertUser(prisma, { id: "user-kept", name: "Kept", email: "kept@example.com" });
    await insertOrganization(prisma, { id: "kept-org", name: "Kept Lab", slug: "kept-lab" });
    await insertMember(prisma, { id: "kept-member", organizationId: "kept-org", userId: "user-kept" });
    await insertSession(prisma, { id: "session-tom-a", userId: "user-tom-a", activeOrganizationId: null });
    await insertSession(prisma, { id: "session-tom-b", userId: "user-tom-b", activeOrganizationId: "" });
    await insertSession(prisma, { id: "session-kept", userId: "user-kept", activeOrganizationId: "kept-org" });
    await insertSession(prisma, { id: "session-kept-empty", userId: "user-kept", activeOrganizationId: null });
    const keptArtifact = randomUUID();
    const blankArtifact = randomUUID();
    const localArtifact = randomUUID();
    await insertArtifact(prisma, { id: keptArtifact, creatorUserId: "user-kept", organizationId: "kept-org" });
    await insertArtifact(prisma, { id: blankArtifact, creatorUserId: "user-blank", organizationId: null });
    await insertArtifact(prisma, { id: localArtifact, creatorUserId: localUserFixture.id, organizationId: null });

    await prisma.$queryRaw`SELECT factrove_backfill_organizations()`;

    const tomA = await ownerOrganization(prisma, "user-tom-a");
    const tomB = await ownerOrganization(prisma, "user-tom-b");
    const blank = await ownerOrganization(prisma, "user-blank");
    const bad = await ownerOrganization(prisma, "user-bad");
    expect(tomA).toMatchObject({ name: "Tom's organization", slug: "tom-s-organization" });
    expect(tomB).toMatchObject({ name: "Tom's organization", slug: "tom-s-organization-2" });
    expect(blank).toMatchObject({ name: "ada.lovelace's organization", slug: "ada-lovelace-s-organization" });
    expect(bad).toMatchObject({ name: "Organization", slug: "organization" });
    expect(await prisma.member.count({ where: { userId: localUserFixture.id } })).toBe(0);
    expect(await prisma.member.count({ where: { userId: "user-kept" } })).toBe(1);
    expect(await prisma.organization.count({ where: { id: "kept-org" } })).toBe(1);

    const tomSession = await prisma.session.findUniqueOrThrow({ where: { id: "session-tom-a" } });
    const tomBSession = await prisma.session.findUniqueOrThrow({ where: { id: "session-tom-b" } });
    const keptSession = await prisma.session.findUniqueOrThrow({ where: { id: "session-kept" } });
    expect(tomSession.activeOrganizationId).toBe(tomA.id);
    expect(tomBSession.activeOrganizationId).toBe(tomB.id);
    expect(keptSession.activeOrganizationId).toBe("kept-org");
    expect((await prisma.session.findUniqueOrThrow({ where: { id: "session-kept-empty" } })).activeOrganizationId).toBe("kept-org");

    const keptRow = await prisma.artifact.findUniqueOrThrow({ where: { id: keptArtifact } });
    const blankRow = await prisma.artifact.findUniqueOrThrow({ where: { id: blankArtifact } });
    const localRow = await prisma.artifact.findUniqueOrThrow({ where: { id: localArtifact } });
    expect(keptRow.organizationId).toBe("kept-org");
    expect(blankRow.organizationId).toBe(blank.id);
    expect(localRow.organizationId).toBe(localOrganizationFixture.id);

    const organizationIds = [tomA.id, tomB.id, blank.id, bad.id];
    const before = await prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, slug: true, name: true },
      orderBy: { id: "asc" },
    });
    await prisma.$queryRaw`SELECT factrove_backfill_organizations()`;
    expect(await prisma.member.count({ where: { userId: { in: ["user-tom-a", "user-tom-b", "user-blank", "user-bad", "user-kept", localUserFixture.id] } } })).toBe(5);
    expect(await prisma.organization.findMany({
      where: { id: { in: organizationIds } },
      select: { id: true, slug: true, name: true },
      orderBy: { id: "asc" },
    })).toEqual(before);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: "session-tom-a" } })).activeOrganizationId).toBe(tomA.id);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: keptArtifact } })).organizationId).toBe("kept-org");
  });

  it("points claimed artifacts at the account's only organization and adds no membership", async () => {
    const pending = randomUUID();
    await insertArtifact(prisma, { id: pending, creatorUserId: localUserFixture.id, organizationId: localOrganizationFixture.id });
    await insertAccount(prisma, { id: "account-none", userId: "user-blank" });
    await prisma.member.deleteMany({ where: { userId: "user-blank" } });
    await expect(claimLocalArtifacts(prisma, "ada.lovelace@example.com")).rejects.toThrow(
      "That account must belong to exactly one organization.",
    );
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: pending } })).creatorUserId).toBe(localUserFixture.id);

    await insertMember(prisma, { id: "blank-member", organizationId: "kept-org", userId: "user-blank" });
    await insertOrganization(prisma, { id: "blank-extra", name: "Extra", slug: "blank-extra" });
    await insertMember(prisma, { id: "blank-extra-member", organizationId: "blank-extra", userId: "user-blank" });
    await expect(claimLocalArtifacts(prisma, "ada.lovelace@example.com")).rejects.toThrow(
      "That account must belong to exactly one organization.",
    );

    await insertAccount(prisma, { id: "account-tom", userId: "user-tom-a" });
    const beforeMembers = await prisma.member.count({ where: { userId: "user-tom-a" } });
    const claimed = await claimLocalArtifacts(prisma, "tom.a@example.com");
    expect(claimed.membershipsAdded).toBe(0);
    expect(claimed.artifactsClaimed).toBeGreaterThan(0);
    expect(await prisma.member.count({ where: { userId: "user-tom-a" } })).toBe(beforeMembers);
    const moved = await prisma.artifact.findUniqueOrThrow({ where: { id: pending } });
    const tom = await ownerOrganization(prisma, "user-tom-a");
    expect(moved.creatorUserId).toBe("user-tom-a");
    expect(moved.organizationId).toBe(tom.id);

    const again = await claimLocalArtifacts(prisma, "tom.a@example.com");
    expect(again.artifactsClaimed).toBe(0);
    expect(again.membershipsAdded).toBe(0);
  });
});

async function slugCandidates(prisma: PrismaClient, name: string, suffixes: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ slugs: string[] | string }>>`
    SELECT factrove_slug_candidates(${name}, ARRAY[${Prisma.join(suffixes)}]::text[]) AS slugs
  `;
  const value = rows[0]?.slugs;
  if (Array.isArray(value)) {
    return value;
  }
  const text = typeof value === "string" ? value : "";
  return text.replace(/^\{|\}$/g, "").split(",").filter((item) => item.length > 0);
}

async function ownerOrganization(prisma: PrismaClient, userId: string): Promise<{ id: string; name: string; slug: string }> {
  const member = await prisma.member.findFirstOrThrow({
    where: { userId, role: "owner" },
    include: { organization: true },
  });
  return member.organization;
}

type SqlClient = PrismaClient | Prisma.TransactionClient;

async function insertUser(
  prisma: SqlClient,
  input: { id: string; name: string; email: string },
): Promise<void> {
  const now = new Date();
  await prisma.user.create({
    data: {
      id: input.id,
      name: input.name,
      email: input.email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function insertOrganization(
  prisma: SqlClient,
  input: { id: string; name: string; slug: string },
): Promise<void> {
  await prisma.organization.create({
    data: { id: input.id, name: input.name, slug: input.slug, createdAt: new Date() },
  });
}

async function insertMember(
  prisma: SqlClient,
  input: { id: string; organizationId: string; userId: string },
): Promise<void> {
  await prisma.member.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      role: "owner",
      createdAt: new Date(),
    },
  });
}

async function insertSession(
  prisma: SqlClient,
  input: { id: string; userId: string; activeOrganizationId: string | null },
): Promise<void> {
  const now = new Date();
  await prisma.session.create({
    data: {
      id: input.id,
      expiresAt: new Date(now.getTime() + 86_400_000),
      token: input.id,
      createdAt: now,
      updatedAt: now,
      userId: input.userId,
      activeOrganizationId: input.activeOrganizationId === "" ? "" : input.activeOrganizationId,
    },
  });
}

async function insertAccount(prisma: SqlClient, input: { id: string; userId: string }): Promise<void> {
  const now = new Date();
  await prisma.account.create({
    data: {
      id: input.id,
      accountId: input.userId,
      providerId: "credential",
      userId: input.userId,
      password: "hashed-password",
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function insertArtifact(
  prisma: SqlClient,
  input: { id: string; creatorUserId: string; organizationId: string | null },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO artifact (
      id, creator_user_id, organization_id, access_type, mime_type, size_bytes, object_key, updated_at
    )
    VALUES (
      ${input.id}::uuid,
      ${input.creatorUserId},
      ${input.organizationId},
      'private'::"access_type",
      'text/html',
      4,
      ${`${input.id}.html`},
      CURRENT_TIMESTAMP
    )
  `;
}
