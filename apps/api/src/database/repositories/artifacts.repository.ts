import { Injectable } from "@nestjs/common";
import type { Artifact } from "@prisma/client";
import type { ArtifactRecord, CreatePendingArtifactInput, ListReadyArtifactsInput } from "../types/artifact-record.js";
import { PrismaService } from "../prisma.service.js";

function toArtifactRecord(row: Artifact): ArtifactRecord {
  return {
    id: row.id,
    creatorUserId: row.creatorUserId,
    organizationId: row.organizationId,
    accessType: row.accessType,
    filename: row.filename,
    mimeType: row.mimeType,
    objectKey: row.objectKey,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    uploadedAt: row.uploadedAt,
  };
}

@Injectable()
export class ArtifactsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPending(input: CreatePendingArtifactInput): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.create({
      data: {
        id: input.id,
        creatorUserId: input.creatorUserId,
        organizationId: input.organizationId,
        accessType: input.accessType,
        filename: input.filename,
        mimeType: input.mimeType,
        objectKey: input.objectKey,
        sizeBytes: input.sizeBytes,
      },
    });
    return toArtifactRecord(row);
  }

  async markUploaded(id: string, uploadedAt: Date): Promise<ArtifactRecord> {
    const row = await this.prisma.artifact.update({
      where: { id },
      data: { uploadedAt },
    });
    return toArtifactRecord(row);
  }

  async findReadyById(id: string): Promise<ArtifactRecord | null> {
    const row = await this.prisma.artifact.findFirst({
      where: { id, uploadedAt: { not: null } },
    });
    return row ? toArtifactRecord(row) : null;
  }

  async listReady(input: ListReadyArtifactsInput): Promise<ArtifactRecord[]> {
    if (input.view === "org" && input.organizationId === null) {
      return [];
    }

    const rows = await this.prisma.artifact.findMany({
      where:
        input.view === "mine"
          ? { creatorUserId: input.userId, uploadedAt: { not: null } }
          : {
              organizationId: input.organizationId,
              accessType: "org_shared",
              uploadedAt: { not: null },
            },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toArtifactRecord);
  }
}
