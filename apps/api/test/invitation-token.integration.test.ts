import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  consumeInvitation,
  createInvitationToken,
  expireStalePendingInvitations,
  hashInvitationToken,
  invitationTokenMatches,
  isInvitationToken,
  normalizeInvitationEmail,
  revokeInvitation,
} from "../src/auth/invitation-token.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = fileURLToPath(
  new URL("../prisma/migrations/20261123140000_invitation_tokens_and_api_key_creator/migration.sql", import.meta.url),
);
const migrationSql = readFileSync(migrationPath, "utf8");

describe("invitation token primitives", () => {
  it("generates a 32-byte secret, stores only its SHA-256 hex, and rejects an invitation id", () => {
    const token = createInvitationToken();
    const hash = hashInvitationToken(token);
    expect(isInvitationToken(token)).toBe(true);
    expect(token).toHaveLength(43);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(invitationTokenMatches(token, hash)).toBe(true);
    expect(invitationTokenMatches(createInvitationToken(), hash)).toBe(false);
    expect(invitationTokenMatches(token, `${hash.slice(0, 63)}g`)).toBe(false);
    expect(invitationTokenMatches(token, hash.toUpperCase())).toBe(false);

    const invitationId = randomUUID();
    expect(isInvitationToken(invitationId)).toBe(false);
    expect(invitationTokenMatches(invitationId, hashInvitationToken(invitationId))).toBe(false);
    expect(isInvitationToken("a".repeat(32))).toBe(false);
    expect(createInvitationToken()).not.toBe(token);
  });

  it("trims and lowercases an address and keeps the plus tag", () => {
    expect(normalizeInvitationEmail("  Ada+Lab@Example.COM ")).toBe("ada+lab@example.com");
    expect(normalizeInvitationEmail("ada+lab@example.com")).toBe("ada+lab@example.com");
    expect(normalizeInvitationEmail("ada+lab@example.com")).not.toBe("ada@example.com");
    expect(normalizeInvitationEmail("  ")).toBe("");
  });

  it("locks artifact, then users, then member, then organization, invitation, and apikey", () => {
    const artifact = migrationSql.indexOf("LOCK TABLE artifact IN ACCESS EXCLUSIVE MODE");
    const users = migrationSql.indexOf('LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE');
    const member = migrationSql.indexOf("LOCK TABLE member IN ACCESS EXCLUSIVE MODE");
    const organization = migrationSql.indexOf("LOCK TABLE organization IN SHARE ROW EXCLUSIVE MODE");
    const invitation = migrationSql.indexOf("LOCK TABLE invitation IN ACCESS EXCLUSIVE MODE");
    const apikey = migrationSql.indexOf("LOCK TABLE apikey IN ACCESS EXCLUSIVE MODE");
    expect(artifact).toBeGreaterThan(-1);
    expect(artifact).toBeLessThan(users);
    expect(users).toBeLessThan(member);
    expect(member).toBeLessThan(organization);
    expect(organization).toBeLessThan(invitation);
    expect(invitation).toBeLessThan(apikey);
    expect(migrationSql).not.toContain("FOR UPDATE");
  });
});

describe("invitation tokens and API key creator migration", () => {
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

  it("stops on duplicate memberships without guessing a role or rewriting other rows", async () => {
    await prisma.$executeRaw`ALTER TABLE member DROP CONSTRAINT IF EXISTS "member_organizationId_userId_key"`;
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "dup-user", "dup-user@example.com");
    await insertOrganization(prisma, "dup-org", "Dup Org", now);
    await insertMember(prisma, { id: "member-a", organizationId: "dup-org", userId: "dup-user", role: "owner", createdAt: now });
    await insertMember(prisma, { id: "member-b", organizationId: "dup-org", userId: "dup-user", role: "member", createdAt: now });
    const artifactId = randomUUID();
    await insertArtifact(prisma, { id: artifactId, creatorUserId: "dup-user", organizationId: "dup-org" });
    const pendingHash = hashInvitationToken(createInvitationToken());
    await insertInvitation(prisma, {
      id: "dup-invite",
      organizationId: "dup-org",
      email: "pending@example.com",
      inviterId: "dup-user",
      status: "pending",
      tokenHash: pendingHash,
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await insertApiKey(prisma, {
      id: "dup-key",
      referenceId: "dup-org",
      key: "dup-key-digest",
      metadata: JSON.stringify({ createdByUserId: "dup-user" }),
      updatedAt: now,
    });

    await expect(runMigration()).rejects.toThrow(
      /duplicate memberships: organization dup-org user dup-user members member-a \(role owner\), member-b \(role member\)[\s\S]*Refusing to choose a role/,
    );

    expect(await prisma.member.count({ where: { organizationId: "dup-org" } })).toBe(2);
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } })).organizationId).toBe("dup-org");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "dup-invite" } })).tokenHash).toBe(pendingHash);
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: "dup-key" } })).key).toBe("dup-key-digest");
    expect(await constraintExists(prisma, "member_organizationId_userId_key")).toBe(false);

    await prisma.member.delete({ where: { id: "member-b" } });
    await runMigration();
    expect(await constraintExists(prisma, "member_organizationId_userId_key")).toBe(true);
    await expect(insertMember(prisma, {
      id: "member-b",
      organizationId: "dup-org",
      userId: "dup-user",
      role: "member",
      createdAt: now,
    })).rejects.toThrow(/Unique constraint failed on the fields: \(`organizationId`,`userId`\)/);
    expect(JSON.parse((await prisma.apikey.findUniqueOrThrow({ where: { id: "dup-key" } })).metadata ?? "")).toEqual({
      createdByUserId: "dup-user",
      createdByMemberId: "member-a",
    });
  });

  it("refuses an invitation status outside the four known states", async () => {
    await prisma.$executeRaw`ALTER TABLE invitation DROP CONSTRAINT IF EXISTS invitation_token_hash_status_check`;
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "status-user", "status-user@example.com");
    await insertOrganization(prisma, "status-org", "Status Org", now);
    await prisma.invitation.create({
      data: {
        id: "status-rejected",
        organizationId: "status-org",
        email: "rejected@example.com",
        status: "rejected",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        inviterId: "status-user",
      },
    });

    await expect(runMigration()).rejects.toThrow(
      /invitation status is not pending, accepted, canceled, or expired: invitation status-rejected status rejected[\s\S]*Refusing to guess a status/,
    );
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "status-rejected" } })).status).toBe("rejected");

    await prisma.invitation.delete({ where: { id: "status-rejected" } });
    await runMigration();
    expect(await constraintExists(prisma, "invitation_token_hash_status_check")).toBe(true);
  });

  it("cancels legacy pending invitations, then enforces hashes and one pending email", async () => {
    await prisma.$executeRaw`ALTER TABLE invitation DROP CONSTRAINT IF EXISTS invitation_token_hash_status_check`;
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "legacy-user", "legacy-user@example.com");
    await insertOrganization(prisma, "legacy-org", "Legacy Org", now);
    await insertOrganization(prisma, "legacy-other", "Legacy Other", now);
    await insertMember(prisma, {
      id: "legacy-org-member",
      organizationId: "legacy-org",
      userId: "legacy-user",
      role: "owner",
      createdAt: now,
    });
    const keptHash = hashInvitationToken(createInvitationToken());
    await prisma.invitation.create({
      data: {
        id: "legacy-pending",
        organizationId: "legacy-org",
        email: "Legacy@Example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        inviterId: "legacy-user",
      },
    });
    await insertInvitation(prisma, {
      id: "legacy-kept",
      organizationId: "legacy-org",
      email: "kept@example.com",
      inviterId: "legacy-user",
      status: "pending",
      tokenHash: keptHash,
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await prisma.invitation.create({
      data: {
        id: "legacy-accepted",
        organizationId: "legacy-org",
        email: "accepted@example.com",
        status: "accepted",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        inviterId: "legacy-user",
      },
    });
    const artifactId = randomUUID();
    await insertArtifact(prisma, { id: artifactId, creatorUserId: "legacy-user", organizationId: "legacy-org" });

    await runMigration();

    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: "legacy-pending" } })).toMatchObject({
      status: "canceled",
      tokenHash: null,
    });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "legacy-kept" } })).tokenHash).toBe(keptHash);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "legacy-accepted" } })).status).toBe("accepted");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: "legacy-org" } })).name).toBe("Legacy Org");
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } })).organizationId).toBe("legacy-org");
    expect(await functionExists(prisma)).toBe(false);
    expect(await constraintExists(prisma, "invitation_token_hash_status_check")).toBe(true);
    expect(await indexExists(prisma, "invitation_pending_email_key")).toBe(true);
    expect(await indexExists(prisma, "invitation_tokenHash_key")).toBe(true);

    await expect(prisma.invitation.create({
      data: {
        id: "legacy-no-hash",
        organizationId: "legacy-org",
        email: "plain@example.com",
        status: "pending",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        inviterId: "legacy-user",
      },
    })).rejects.toThrow(/invitation_token_hash_status_check/);
    await expect(insertInvitation(prisma, {
      id: "legacy-accepted-hash",
      organizationId: "legacy-org",
      email: "hashed-accepted@example.com",
      inviterId: "legacy-user",
      status: "accepted",
      tokenHash: hashInvitationToken(createInvitationToken()),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    })).rejects.toThrow(/invitation_token_hash_status_check/);

    await expect(insertInvitation(prisma, {
      id: "legacy-case",
      organizationId: "legacy-org",
      email: "kept@example.com",
      inviterId: "legacy-user",
      status: "pending",
      tokenHash: hashInvitationToken(createInvitationToken()),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    })).rejects.toThrow(/Unique constraint failed on the fields: \(`organizationId`,`lower\(email\)`\)/);
    await insertInvitation(prisma, {
      id: "legacy-plus",
      organizationId: "legacy-org",
      email: "kept+lab@example.com",
      inviterId: "legacy-user",
      status: "pending",
      tokenHash: hashInvitationToken(createInvitationToken()),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await insertInvitation(prisma, {
      id: "legacy-other-org",
      organizationId: "legacy-other",
      email: "kept@example.com",
      inviterId: "legacy-user",
      status: "pending",
      tokenHash: hashInvitationToken(createInvitationToken()),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await insertMember(prisma, {
      id: "legacy-other-member",
      organizationId: "legacy-other",
      userId: "legacy-user",
      role: "member",
      createdAt: now,
    });
    expect(await prisma.member.count({ where: { userId: "legacy-user" } })).toBe(2);
  });

  it("expires stale pending rows with the database clock and then allows a replacement", async () => {
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "expiry-user", "expiry-user@example.com");
    await insertOrganization(prisma, "expiry-org", "Expiry Org", now);
    await insertOrganization(prisma, "expiry-other", "Expiry Other", now);
    const staleToken = createInvitationToken();
    const futureToken = createInvitationToken();
    const otherToken = createInvitationToken();
    await insertInvitation(prisma, {
      id: "expiry-stale",
      organizationId: "expiry-org",
      email: "stale@example.com",
      inviterId: "expiry-user",
      status: "pending",
      tokenHash: hashInvitationToken(staleToken),
      expiresAt: now,
    });
    await insertInvitation(prisma, {
      id: "expiry-future",
      organizationId: "expiry-org",
      email: "future@example.com",
      inviterId: "expiry-user",
      status: "pending",
      tokenHash: hashInvitationToken(futureToken),
      expiresAt: now,
    });
    await insertInvitation(prisma, {
      id: "expiry-other",
      organizationId: "expiry-other",
      email: "other-stale@example.com",
      inviterId: "expiry-user",
      status: "pending",
      tokenHash: hashInvitationToken(otherToken),
      expiresAt: now,
    });
    await insertInvitation(prisma, {
      id: "expiry-accepted",
      organizationId: "expiry-org",
      email: "already-accepted@example.com",
      inviterId: "expiry-user",
      status: "accepted",
      tokenHash: null,
      expiresAt: now,
    });
    await prisma.$executeRaw`
      UPDATE invitation
      SET "expiresAt" = CURRENT_TIMESTAMP - interval '1 second'
      WHERE id IN ('expiry-stale', 'expiry-other', 'expiry-accepted')
    `;
    await prisma.$executeRaw`
      UPDATE invitation
      SET "expiresAt" = CURRENT_TIMESTAMP + interval '1 day'
      WHERE id = 'expiry-future'
    `;

    expect(await expireStalePendingInvitations(prisma, { organizationId: "expiry-org" })).toBe(1);
    const stale = await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-stale" } });
    expect(stale.status).toBe("expired");
    expect(stale.tokenHash).toBeNull();
    expect(invitationTokenMatches(staleToken, hashInvitationToken(staleToken))).toBe(true);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-future" } })).status).toBe("pending");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-other" } })).status).toBe("pending");
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-accepted" } })).status).toBe("accepted");

    const replacementToken = createInvitationToken();
    await expect(insertInvitation(prisma, {
      id: "expiry-blocked",
      organizationId: "expiry-other",
      email: "Other-Stale@Example.com",
      inviterId: "expiry-user",
      status: "pending",
      tokenHash: hashInvitationToken(replacementToken),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    })).rejects.toThrow(/Unique constraint failed on the fields: \(`organizationId`,`lower\(email\)`\)/);

    expect(await expireStalePendingInvitations(prisma)).toBe(1);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-other" } })).tokenHash).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-future" } })).tokenHash).toBe(
      hashInvitationToken(futureToken),
    );
    await insertInvitation(prisma, {
      id: "expiry-replacement",
      organizationId: "expiry-other",
      email: normalizeInvitationEmail("Other-Stale@Example.com"),
      inviterId: "expiry-user",
      status: "pending",
      tokenHash: hashInvitationToken(replacementToken),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    const replaced = await prisma.invitation.findUniqueOrThrow({ where: { id: "expiry-replacement" } });
    expect(invitationTokenMatches(replacementToken, replaced.tokenHash ?? "")).toBe(true);
    expect(replaced.id).not.toBe(replacementToken);
  });

  it("clears the hash when a pending invitation is accepted or revoked", async () => {
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "clear-user", "clear-user@example.com");
    await insertOrganization(prisma, "clear-org", "Clear Org", now);
    const acceptedToken = createInvitationToken();
    const revokedToken = createInvitationToken();
    await insertInvitation(prisma, {
      id: "clear-accept",
      organizationId: "clear-org",
      email: "accept@example.com",
      inviterId: "clear-user",
      status: "pending",
      tokenHash: hashInvitationToken(acceptedToken),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });
    await insertInvitation(prisma, {
      id: "clear-revoke",
      organizationId: "clear-org",
      email: "revoke@example.com",
      inviterId: "clear-user",
      status: "pending",
      tokenHash: hashInvitationToken(revokedToken),
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(await consumeInvitation(prisma, "clear-accept")).toBe(true);
    expect(await consumeInvitation(prisma, "clear-accept")).toBe(false);
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: "clear-accept" } })).toMatchObject({
      status: "accepted",
      tokenHash: null,
    });
    expect(await revokeInvitation(prisma, "clear-accept")).toBe(false);

    expect(await revokeInvitation(prisma, "clear-revoke")).toBe(true);
    expect(await revokeInvitation(prisma, "clear-revoke")).toBe(false);
    expect(await prisma.invitation.findUniqueOrThrow({ where: { id: "clear-revoke" } })).toMatchObject({
      status: "canceled",
      tokenHash: null,
    });
    expect(invitationTokenMatches(acceptedToken, hashInvitationToken(acceptedToken))).toBe(true);
    expect(invitationTokenMatches(revokedToken, "")).toBe(false);
  });

  it("backfills createdByMemberId and invalidates keys that cannot be matched", async () => {
    const now = new Date("2026-11-23T00:00:00.000Z");
    await insertUser(prisma, "key-user", "key-user@example.com");
    await insertUser(prisma, "key-stranger", "key-stranger@example.com");
    await insertUser(prisma, "key-outsider", "key-outsider@example.com");
    await insertOrganization(prisma, "key-org", "Key Org", now);
    await insertOrganization(prisma, "key-other", "Key Other", now);
    await insertMember(prisma, {
      id: "key-member",
      organizationId: "key-org",
      userId: "key-user",
      role: "owner",
      createdAt: now,
    });
    await insertMember(prisma, {
      id: "key-other-member",
      organizationId: "key-other",
      userId: "key-user",
      role: "owner",
      createdAt: now,
    });
    await insertMember(prisma, {
      id: "key-outsider-member",
      organizationId: "key-other",
      userId: "key-outsider",
      role: "member",
      createdAt: now,
    });
    const artifactId = randomUUID();
    await insertArtifact(prisma, { id: artifactId, creatorUserId: "key-user", organizationId: "key-org" });
    await insertApiKey(prisma, {
      id: "key-matched",
      referenceId: "key-org",
      key: "matched-digest",
      metadata: JSON.stringify({ createdByUserId: "key-user", note: "drop-me" }),
      updatedAt: now,
    });
    await insertApiKey(prisma, {
      id: "key-encoded",
      referenceId: "key-org",
      key: "encoded-digest",
      metadata: JSON.stringify(JSON.stringify({ createdByUserId: "key-user" })),
      updatedAt: now,
    });
    await insertApiKey(prisma, {
      id: "key-unmatched",
      referenceId: "key-org",
      key: "unmatched-digest",
      metadata: JSON.stringify({ createdByUserId: "key-stranger" }),
      updatedAt: now,
    });
    await insertApiKey(prisma, {
      id: "key-wrong-org",
      referenceId: "key-org",
      key: "wrong-org-digest",
      metadata: JSON.stringify({ createdByUserId: "key-outsider" }),
      updatedAt: now,
    });
    await insertApiKey(prisma, {
      id: "key-bad-json",
      referenceId: "key-org",
      key: "bad-json-digest",
      metadata: "{",
      updatedAt: now,
    });

    await runMigration();

    const matched = await prisma.apikey.findUniqueOrThrow({ where: { id: "key-matched" } });
    expect(matched.key).toBe("matched-digest");
    expect(matched.enabled).toBe(true);
    expect(JSON.parse(matched.metadata ?? "")).toEqual({
      createdByUserId: "key-user",
      createdByMemberId: "key-member",
    });
    expect(JSON.parse((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-encoded" } })).metadata ?? "")).toEqual({
      createdByUserId: "key-user",
      createdByMemberId: "key-member",
    });
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-encoded" } })).key).toBe("encoded-digest");
    for (const id of ["key-unmatched", "key-wrong-org", "key-bad-json"]) {
      const row = await prisma.apikey.findUniqueOrThrow({ where: { id } });
      expect(row.enabled).toBe(false);
      expect(row.key).toBe(`invalidated:${id}`);
    }
    expect(JSON.parse((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-unmatched" } })).metadata ?? "")).toEqual({
      createdByUserId: "key-stranger",
    });
    expect(JSON.parse((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-wrong-org" } })).metadata ?? "")).toEqual({
      createdByUserId: "key-outsider",
    });
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-bad-json" } })).metadata).toBeNull();
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifactId } })).organizationId).toBe("key-org");
    expect(await prisma.organization.count({ where: { id: { in: ["key-org", "key-other"] } } })).toBe(2);

    const backfilledAt = (await prisma.apikey.findUniqueOrThrow({ where: { id: "key-matched" } })).updatedAt;
    await runMigration();
    const again = await prisma.apikey.findUniqueOrThrow({ where: { id: "key-matched" } });
    expect(again.updatedAt.toISOString()).toBe(backfilledAt.toISOString());
    expect(again.key).toBe("matched-digest");
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-unmatched" } })).key).toBe("invalidated:key-unmatched");

    await insertMember(prisma, {
      id: "key-stranger-member",
      organizationId: "key-org",
      userId: "key-stranger",
      role: "member",
      createdAt: now,
    });
    await runMigration();
    const rejoined = await prisma.apikey.findUniqueOrThrow({ where: { id: "key-unmatched" } });
    expect(rejoined.key).toBe("invalidated:key-unmatched");
    expect(rejoined.enabled).toBe(false);
    expect(JSON.parse(rejoined.metadata ?? "")).toEqual({ createdByUserId: "key-stranger" });
    expect(await prisma.member.count({ where: { id: "key-stranger-member" } })).toBe(1);

    await insertApiKey(prisma, {
      id: "key-late",
      referenceId: "key-org",
      key: "late-digest",
      metadata: JSON.stringify({ createdByUserId: "key-user" }),
      updatedAt: now,
    });
    await runMigration();
    expect(JSON.parse((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-late" } })).metadata ?? "")).toEqual({
      createdByUserId: "key-user",
      createdByMemberId: "key-member",
    });
    expect((await prisma.apikey.findUniqueOrThrow({ where: { id: "key-late" } })).key).toBe("late-digest");

    await prisma.member.delete({ where: { id: "key-member" } });
    await insertMember(prisma, {
      id: "key-member-new",
      organizationId: "key-org",
      userId: "key-user",
      role: "member",
      createdAt: now,
    });
    await runMigration();
    for (const id of ["key-matched", "key-encoded", "key-late"]) {
      const row = await prisma.apikey.findUniqueOrThrow({ where: { id } });
      expect(row.enabled).toBe(false);
      expect(row.key).toBe(`invalidated:${id}`);
      expect(JSON.parse(row.metadata ?? "")).toEqual({ createdByUserId: "key-user" });
    }
    expect(await prisma.member.count({ where: { id: "key-member-new" } })).toBe(1);
    expect(await functionExists(prisma)).toBe(false);
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

async function constraintExists(prisma: PrismaClient, name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT conname AS name
    FROM pg_constraint
    WHERE conname = ${name}
  `;
  return rows.length === 1;
}

async function indexExists(prisma: PrismaClient, name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ${name}
  `;
  return rows.length === 1;
}

async function functionExists(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT proname AS name
    FROM pg_proc
    WHERE proname = 'factrove_invitation_tokens_and_api_key_creator'
  `;
  return rows.length > 0;
}

async function insertUser(prisma: PrismaClient, id: string, email: string): Promise<void> {
  await prisma.user.create({
    data: { id, name: id, email, emailVerified: true },
  });
}

async function insertOrganization(prisma: PrismaClient, id: string, name: string, createdAt: Date): Promise<void> {
  await prisma.organization.create({
    data: { id, name, slug: id, createdAt },
  });
}

async function insertMember(
  prisma: PrismaClient,
  input: { id: string; organizationId: string; userId: string; role: string; createdAt: Date },
): Promise<void> {
  await prisma.member.create({ data: input });
}

async function insertArtifact(
  prisma: PrismaClient,
  input: { id: string; creatorUserId: string; organizationId: string },
): Promise<void> {
  await prisma.artifact.create({
    data: {
      id: input.id,
      creatorUserId: input.creatorUserId,
      organizationId: input.organizationId,
      mimeType: "text/html",
      sizeBytes: 5,
      objectKey: `${input.id}.html`,
    },
  });
}

async function insertInvitation(
  prisma: PrismaClient,
  input: {
    id: string;
    organizationId: string;
    email: string;
    inviterId: string;
    status: string;
    tokenHash: string | null;
    expiresAt: Date;
  },
): Promise<void> {
  await prisma.invitation.create({
    data: {
      id: input.id,
      organizationId: input.organizationId,
      email: input.email,
      role: "member",
      status: input.status,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      inviterId: input.inviterId,
    },
  });
}

async function insertApiKey(
  prisma: PrismaClient,
  input: { id: string; referenceId: string; key: string; metadata: string; updatedAt: Date },
): Promise<void> {
  await prisma.apikey.create({
    data: {
      id: input.id,
      referenceId: input.referenceId,
      key: input.key,
      metadata: input.metadata,
      enabled: true,
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
    },
  });
}
