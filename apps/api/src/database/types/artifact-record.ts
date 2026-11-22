import type { AccessType, ArtifactView } from "@factrove/contracts";

export type ArtifactRecord = {
  id: string;
  creatorUserId: string;
  organizationId: string;
  accessType: AccessType;
  name: string | null;
  mimeType: string;
  sizeBytes: number;
  objectKey: string;
  contentRevision: number;
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
  organizationId: string;
  accessType: AccessType;
  mimeType: string;
  sizeBytes: number;
  name?: string | null;
  objectKey?: string;
  uploadedAt?: Date | null;
};

export type UpdateArtifactInput = {
  organizationId?: string;
  accessType?: AccessType;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt?: Date | null;
};

export type ListArtifactsInput = {
  view: ArtifactView;
  userId: string;
  organizationId: string | null;
  // Set for an API key. view=mine then includes only that organization.
  // A session leaves this unset and still lists the creator's artifacts in every organization.
  mineOrganizationId?: string;
};
