import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type Artifact } from "@prisma/client";
import type {
  ArtifactRecord,
  CreateArtifactInput,
  ListArtifactsInput,
  UpdateArtifactInput,
} from "../types/artifact-record.js";
import { PrismaService } from "../prisma.service.js";

function toArtifactRecord(row: Artifact): ArtifactRecord {
  return {
    id: row.id,
    creatorUserId: row.creatorUserId,
    organizationId: row.organizationId,
    accessType: row.accessType,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    objectKey: row.objectKey,
    contentRevision: row.contentRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    uploadedAt: row.uploadedAt,
    shareToken: row.shareToken,
    shareTokenHash: row.shareTokenHash,
    sharePasswordHash: row.sharePasswordHash,
  };
}

@Injectable()
export class ArtifactsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.create({
      data: {
        id: input.id,
        creatorUserId: input.creatorUserId,
        organizationId: input.organizationId,
        accessType: input.accessType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        name: input.name ?? null,
        objectKey: input.objectKey ?? `${input.id}.html`,
        uploadedAt: input.uploadedAt ?? null,
      },
    });
    return toArtifactRecord(row);
  }

  // Commits one immutable object. Share columns, access, and createdAt stay as they are.
  // The update matches the revision the caller read, so a concurrent replace cannot share this write.
  // name is set only when the caller passes it. Omitting name leaves the column unchanged.
  async commitContent(input: {
    id: string;
    expectedRevision: number;
    objectKey: string;
    sizeBytes: number;
    uploadedAt: Date;
    name?: string;
  }): Promise<boolean> {
    const updated = await this.prisma.artifact.updateMany({
      where: { id: input.id, contentRevision: input.expectedRevision },
      data: {
        objectKey: input.objectKey,
        sizeBytes: input.sizeBytes,
        uploadedAt: input.uploadedAt,
        contentRevision: { increment: 1 },
        ...(input.name === undefined ? {} : { name: input.name }),
      },
    });
    return updated.count === 1;
  }

  // Switches private -> org_shared for this creator when the confirmed organization is still current.
  // The only row lock is the artifact. User, session, and membership rows are not locked, so a
  // membership delete or a login is not blocked and cannot cycle with this transaction. An
  // organization delete that also needs this artifact can still deadlock on the organization
  // foreign key; that error is retried once and then reported as organization-changed, with no
  // write. The authorization check is a later statement, so it sees commits that landed while this
  // transaction waited on the artifact. An artifact that is already org_shared is returned
  // with no write and no organization check. Share columns, content, and createdAt are not written.
  async shareWithOrganization(input: {
    id: string;
    creatorUserId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<ShareWithOrganizationOutcome> {
    try {
      return await this.shareWithOrganizationOnce(input);
    } catch (error) {
      if (!isShareLockConflict(error)) {
        throw error;
      }
    }
    try {
      return await this.shareWithOrganizationOnce(input);
    } catch (error) {
      if (!isShareLockConflict(error)) {
        throw error;
      }
      return { outcome: "organization-changed" };
    }
  }

  private shareWithOrganizationOnce(input: {
    id: string;
    creatorUserId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<ShareWithOrganizationOutcome> {
    return this.prisma.$transaction((tx) => shareWithOrganizationInTransaction(tx, input), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: SHARE_TRANSACTION_TIMEOUT_MS,
    });
  }

  async update(id: string, input: UpdateArtifactInput): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.update({
      where: { id },
      data: {
        organizationId: input.organizationId,
        accessType: input.accessType,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        uploadedAt: input.uploadedAt,
      },
    });
    return toArtifactRecord(row);
  }

  async delete(id: string): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.delete({ where: { id } });
    return toArtifactRecord(row);
  }

  async findById(id: string): Promise<ArtifactRecord | null> {
    const row = await this.prisma.artifact.findUnique({ where: { id } });
    return row ? toArtifactRecord(row) : null;
  }

  // Stores a new token only while the artifact is unshared. A concurrent share keeps the first token.
  // When a password hash is supplied it is written in the same update, so a failure cannot leave
  // a live unprotected link.
  async saveShare(
    id: string,
    shareToken: string,
    shareTokenHash: string,
    sharePasswordHash: string | null = null,
  ): Promise<ArtifactRecord | null> {
    const updated = await this.prisma.artifact.updateMany({
      where: { id, shareTokenHash: null },
      data: { shareToken, shareTokenHash, sharePasswordHash },
    });
    if (updated.count !== 1) {
      return null;
    }
    return this.findById(id);
  }

  async clearShare(id: string): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.update({
      where: { id },
      data: { shareToken: null, shareTokenHash: null, sharePasswordHash: null },
    });
    return toArtifactRecord(row);
  }

  // Applies only while the share with this hash is still active, so a revoke or a new
  // token in between cannot receive the password.
  async setSharePassword(id: string, shareTokenHash: string, sharePasswordHash: string): Promise<ArtifactRecord | null> {
    const updated = await this.prisma.artifact.updateMany({
      where: { id, shareTokenHash },
      data: { sharePasswordHash },
    });
    if (updated.count !== 1) {
      return null;
    }
    return this.findById(id);
  }

  async clearSharePassword(id: string, shareTokenHash: string): Promise<ArtifactRecord | null> {
    const updated = await this.prisma.artifact.updateMany({
      where: { id, shareTokenHash },
      data: { sharePasswordHash: null },
    });
    if (updated.count !== 1) {
      return null;
    }
    return this.findById(id);
  }

  // Public lookup uses the unique hash alone, then compares the id in memory.
  // The ciphertext is selected so the caller can require decryption with the current key.
  async findShared(id: string, shareTokenHash: string): Promise<ArtifactRecord | null> {
    const row = await this.prisma.artifact.findUnique({
      where: { shareTokenHash },
      select: {
        id: true,
        creatorUserId: true,
        organizationId: true,
        accessType: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        objectKey: true,
        contentRevision: true,
        createdAt: true,
        updatedAt: true,
        uploadedAt: true,
        shareToken: true,
        shareTokenHash: true,
        sharePasswordHash: true,
      },
    });
    if (!row || row.id !== id) {
      return null;
    }
    return row;
  }

  async list(input: ListArtifactsInput): Promise<ArtifactRecord[]> {
    if (input.view === "org" && input.organizationId === null) {
      return [];
    }

    const rows = await this.prisma.artifact.findMany({
      where:
        input.view === "mine"
          ? { creatorUserId: input.userId }
          : {
              organizationId: input.organizationId,
              accessType: "org_shared",
            },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toArtifactRecord);
  }
}

export type ShareWithOrganizationOutcome =
  | { outcome: "shared" | "already"; record: ArtifactRecord }
  | { outcome: "not-found" }
  | { outcome: "unauthenticated" }
  | { outcome: "organization-required" }
  | { outcome: "organization-changed" };

// A few seconds, and shorter than the Prisma transaction timeout, so a blocked lock becomes
// 55P03 or 57014 instead of a late P2028 that the HTTP layer would turn into a 500.
const SHARE_LOCK_TIMEOUT = "3000";
const SHARE_STATEMENT_TIMEOUT = "4000";
const SHARE_TRANSACTION_TIMEOUT_MS = 8_000;

async function shareWithOrganizationInTransaction(
  tx: Prisma.TransactionClient,
  input: { id: string; creatorUserId: string; organizationId: string; sessionId: string | null },
): Promise<ShareWithOrganizationOutcome> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', ${SHARE_LOCK_TIMEOUT}, true)`;
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${SHARE_STATEMENT_TIMEOUT}, true)`;
  // Lock only this artifact. The next statement starts after the wait, so its snapshot includes
  // a membership, session, or organization change that committed while this request was blocked.
  await tx.$queryRaw`SELECT id FROM artifact WHERE id = ${input.id}::uuid FOR UPDATE`;
  const locked = await tx.artifact.findUnique({ where: { id: input.id } });
  if (!locked || locked.creatorUserId !== input.creatorUserId) {
    return { outcome: "not-found" };
  }
  if (locked.accessType === "org_shared") {
    return { outcome: "already", record: toArtifactRecord(locked) };
  }

  const updated = await tx.$executeRaw`
    UPDATE artifact
    SET access_type = 'org_shared'::"access_type",
        organization_id = ${input.organizationId},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${input.id}::uuid
      AND creator_user_id = ${input.creatorUserId}
      AND access_type = 'private'::"access_type"
      AND EXISTS (
        SELECT 1 FROM "user" WHERE id = artifact.creator_user_id
      )
      AND ${shareAuthorizationSql(input)}
  `;
  if (updated === 1) {
    const saved = await tx.artifact.findUnique({ where: { id: input.id } });
    if (!saved || saved.creatorUserId !== input.creatorUserId) {
      return { outcome: "not-found" };
    }
    return { outcome: "shared", record: toArtifactRecord(saved) };
  }
  return classifyShareRefusal(tx, input);
}

// Same rule as ActorService.organizationFor, evaluated in the UPDATE so the check and the write
// cannot drift. A session must still be present and unexpired. API keys have no session row and
// use the sole-membership rule. Plain EXISTS does not lock those rows.
function shareAuthorizationSql(input: {
  organizationId: string;
  sessionId: string | null;
}): Prisma.Sql {
  const confirmedMembership = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "member"
      WHERE "userId" = artifact.creator_user_id
        AND "organizationId" = ${input.organizationId}
    )
  `;
  const soleMembership = Prisma.sql`
    (SELECT COUNT(*)::int FROM "member" WHERE "userId" = artifact.creator_user_id) = 1
    AND ${confirmedMembership}
  `;
  if (input.sessionId === null) {
    return soleMembership;
  }
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "session"
      WHERE "session".id = ${input.sessionId}
        AND "session"."userId" = artifact.creator_user_id
        AND "session"."expiresAt" > CURRENT_TIMESTAMP
        AND (
          (
            "session"."activeOrganizationId" = ${input.organizationId}
            AND EXISTS (
              SELECT 1
              FROM "member"
              WHERE "userId" = artifact.creator_user_id
                AND "organizationId" = "session"."activeOrganizationId"
            )
          )
          OR (
            (
              "session"."activeOrganizationId" IS NULL
              OR "session"."activeOrganizationId" = ''
              OR NOT EXISTS (
                SELECT 1
                FROM "member"
                WHERE "userId" = artifact.creator_user_id
                  AND "organizationId" = "session"."activeOrganizationId"
              )
            )
            AND ${soleMembership}
          )
        )
    )
  `;
}

async function classifyShareRefusal(
  tx: Prisma.TransactionClient,
  input: { id: string; creatorUserId: string; organizationId: string; sessionId: string | null },
): Promise<ShareWithOrganizationOutcome> {
  const row = await tx.artifact.findUnique({ where: { id: input.id } });
  if (!row || row.creatorUserId !== input.creatorUserId) {
    return { outcome: "not-found" };
  }
  if (row.accessType === "org_shared") {
    return { outcome: "already", record: toArtifactRecord(row) };
  }
  if (input.sessionId) {
    const sessions = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "session"
      WHERE id = ${input.sessionId}
        AND "userId" = ${input.creatorUserId}
        AND "expiresAt" > CURRENT_TIMESTAMP
    `;
    if (sessions.length === 0) {
      return { outcome: "unauthenticated" };
    }
  }
  const users = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "user" WHERE id = ${input.creatorUserId}
  `;
  if (users.length === 0) {
    return { outcome: "unauthenticated" };
  }
  const currentOrganizationId = await readCurrentOrganizationId(tx, input.creatorUserId, input.sessionId);
  if (currentOrganizationId === null) {
    return { outcome: "organization-required" };
  }
  return { outcome: "organization-changed" };
}

async function readCurrentOrganizationId(
  tx: Prisma.TransactionClient,
  userId: string,
  sessionId: string | null,
): Promise<string | null> {
  let activeOrganizationId: string | null = null;
  if (sessionId) {
    const sessions = await tx.$queryRaw<Array<{ activeOrganizationId: string | null }>>`
      SELECT "activeOrganizationId"
      FROM "session"
      WHERE id = ${sessionId}
        AND "userId" = ${userId}
        AND "expiresAt" > CURRENT_TIMESTAMP
    `;
    const active = sessions[0]?.activeOrganizationId;
    activeOrganizationId = typeof active === "string" && active.length > 0 ? active : null;
  }
  if (activeOrganizationId) {
    const activeMembership = await tx.$queryRaw<Array<{ organizationId: string }>>`
      SELECT "organizationId"
      FROM "member"
      WHERE "userId" = ${userId} AND "organizationId" = ${activeOrganizationId}
      LIMIT 1
    `;
    if (activeMembership.length === 1) {
      return activeOrganizationId;
    }
  }
  const memberships = await tx.$queryRaw<Array<{ organizationId: string }>>`
    SELECT "organizationId"
    FROM "member"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" ASC
    LIMIT 2
  `;
  return memberships.length === 1 ? memberships[0]?.organizationId ?? null : null;
}

function isShareLockConflict(error: unknown): boolean {
  return matchesShareLockConflict(error) || matchesShareLockConflict(errorCause(error));
}

function matchesShareLockConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "P2028" || code === "P2034") {
    return true;
  }
  const meta = "meta" in error ? error.meta : undefined;
  const metaCode =
    typeof meta === "object" && meta !== null && "code" in meta && typeof meta.code === "string" ? meta.code : "";
  if (metaCode === "40P01" || metaCode === "40001" || metaCode === "55P03" || metaCode === "57014") {
    return true;
  }
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return /(?:40P01|40001|55P03|57014)/.test(message)
    || /deadlock detected|could not serialize access|canceling statement due to lock timeout|canceling statement due to statement timeout/i.test(message);
}

function errorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return undefined;
  }
  return error.cause;
}
