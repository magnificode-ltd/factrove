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

  // Switches private -> org_shared for this creator and assigns the current organization.
  // The artifact row is locked first. Membership and the session's active organization are then
  // locked and re-read in the same transaction, so a removal or active-organization change that
  // landed while this update waited is visible, and one that arrives later waits until commit.
  // An artifact that is already org_shared is returned with no write and no organization check.
  // Share columns, content, and createdAt are not part of the write.
  async shareWithOrganization(input: {
    id: string;
    creatorUserId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<ShareWithOrganizationOutcome> {
    return this.prisma.$transaction(
      (tx) => shareWithOrganizationInTransaction(tx, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    );
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
  | { outcome: "organization-required" }
  | { outcome: "organization-changed" };

async function shareWithOrganizationInTransaction(
  tx: Prisma.TransactionClient,
  input: { id: string; creatorUserId: string; organizationId: string; sessionId: string | null },
): Promise<ShareWithOrganizationOutcome> {
  // Lock the artifact before the authorization rows. A caller that already holds this row can
  // change membership or the active organization before we observe them; we then refuse.
  await tx.$queryRaw`SELECT id FROM artifact WHERE id = ${input.id}::uuid FOR UPDATE`;
  const locked = await tx.artifact.findUnique({ where: { id: input.id } });
  if (!locked || locked.creatorUserId !== input.creatorUserId) {
    return { outcome: "not-found" };
  }
  if (locked.accessType === "org_shared") {
    return { outcome: "already", record: toArtifactRecord(locked) };
  }

  const currentOrganizationId = await lockedCurrentOrganizationId(tx, input.creatorUserId, input.sessionId);
  if (currentOrganizationId === null) {
    return { outcome: "organization-required" };
  }
  if (currentOrganizationId !== input.organizationId) {
    return { outcome: "organization-changed" };
  }

  const updated = await tx.artifact.updateMany({
    where: {
      id: input.id,
      creatorUserId: input.creatorUserId,
      accessType: "private",
    },
    data: {
      accessType: "org_shared",
      organizationId: currentOrganizationId,
      updatedAt: new Date(),
    },
  });
  const saved = await tx.artifact.findUnique({ where: { id: input.id } });
  if (!saved || saved.creatorUserId !== input.creatorUserId) {
    return { outcome: "not-found" };
  }
  if (updated.count !== 1) {
    return saved.accessType === "org_shared"
      ? { outcome: "already", record: toArtifactRecord(saved) }
      : { outcome: "not-found" };
  }
  return { outcome: "shared", record: toArtifactRecord(saved) };
}

// Holds the user row, the session row, and every membership through the caller's commit.
// FOR UPDATE on the user conflicts with a new membership's foreign-key lock. FOR SHARE
// conflicts with deleting a membership or changing the active organization.
async function lockedCurrentOrganizationId(
  tx: Prisma.TransactionClient,
  userId: string,
  sessionId: string | null,
): Promise<string | null> {
  await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;

  let activeOrganizationId: string | null = null;
  if (sessionId) {
    const sessions = await tx.$queryRaw<Array<{ activeOrganizationId: string | null }>>`
      SELECT "activeOrganizationId"
      FROM "session"
      WHERE id = ${sessionId} AND "userId" = ${userId}
      FOR SHARE
    `;
    const active = sessions[0]?.activeOrganizationId;
    activeOrganizationId = typeof active === "string" && active.length > 0 ? active : null;
  }

  const memberships = await tx.$queryRaw<Array<{ organizationId: string }>>`
    SELECT "organizationId"
    FROM "member"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" ASC
    FOR SHARE
  `;
  if (activeOrganizationId && memberships.some((membership) => membership.organizationId === activeOrganizationId)) {
    return activeOrganizationId;
  }
  return memberships.length === 1 ? memberships[0]?.organizationId ?? null : null;
}
