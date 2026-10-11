import { Injectable } from "@nestjs/common";
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
  };
}

@Injectable()
export class ArtifactsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
