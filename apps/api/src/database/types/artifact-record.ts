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
};

export type CreatePendingArtifactInput = {
  id: string;
  creatorUserId: string;
  organizationId: string | null;
  accessType: AccessType;
  mimeType: string;
  sizeBytes: number;
};

export type ListReadyArtifactsInput = {
  view: ArtifactView;
  userId: string;
  organizationId: string | null;
};
