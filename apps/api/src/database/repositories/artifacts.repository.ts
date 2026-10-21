import { Inject, Injectable } from "@nestjs/common";
import type { Artifact } from "@prisma/client";
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
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
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
        uploadedAt: input.uploadedAt ?? null,
      },
    });
    return toArtifactRecord(row);
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
  async saveShare(id: string, shareToken: string, shareTokenHash: string): Promise<ArtifactRecord | null> {
    const updated = await this.prisma.artifact.updateMany({
      where: { id, shareTokenHash: null },
      data: { shareToken, shareTokenHash },
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
        mimeType: true,
        sizeBytes: true,
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
