import type { AccessType, ArtifactView } from "@factrove/contracts";

export type ArtifactRecord = {
  id: string;
  creatorUserId: string;
  organizationId: string | null;
  accessType: AccessType;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
  uploadedAt: Date | null;
  shareToken: string | null;
  shareTokenHash: string | null;
  sharePasswordHash: string | null;
};

export type CreateArtifactInput = {
  id: string;
  creatorUserId: string;
  organizationId: string | null;
  accessType: AccessType;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: Date | null;
};

export type UpdateArtifactInput = {
  organizationId?: string | null;
  accessType?: AccessType;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt?: Date | null;
};

export type ListArtifactsInput = {
  view: ArtifactView;
  userId: string;
  organizationId: string | null;
};
