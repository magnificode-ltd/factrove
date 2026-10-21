import { z } from "zod";

export const accessTypeSchema = z.enum(["private", "org_shared"]);
export const artifactViewSchema = z.enum(["mine", "org"]);
export const contentFormatSchema = z.enum(["html", "markdown"]);

export const contentMediaTypes = {
  html: "text/html",
  markdown: "text/markdown"
} as const;

export const artifactDtoSchema = z.object({
  id: z.string().uuid(),
  creatorUserId: z.string(),
  organizationId: z.string().nullable(),
  accessType: accessTypeSchema,
  filename: z.string(),
  mimeType: z.literal("text/html"),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  uploadedAt: z.string().datetime({ offset: true }),
  viewerUrl: z.string().url(),
  contentUrl: z.string().url(),
  shared: z.boolean()
});

export const shareStateSchema = z.object({
  shared: z.boolean(),
  shareUrl: z.string().url().nullable()
});

export const shareEnvelopeSchema = z.object({
  share: shareStateSchema
});

export const publicArtifactSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.literal("text/html"),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string().datetime({ offset: true }),
  contentUrl: z.string().url()
});

export const publicArtifactEnvelopeSchema = z.object({
  artifact: publicArtifactSchema
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() })
});

export const artifactEnvelopeSchema = z.object({ artifact: artifactDtoSchema });
export const artifactListEnvelopeSchema = z.object({ items: z.array(artifactDtoSchema) });
export const contextEnvelopeSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), name: z.string() }).nullable()
});
export const healthEnvelopeSchema = z.object({ status: z.literal("ok") });

export type AccessType = z.infer<typeof accessTypeSchema>;
export type ArtifactView = z.infer<typeof artifactViewSchema>;
export type ContentFormat = z.infer<typeof contentFormatSchema>;
export type ContentMediaType = (typeof contentMediaTypes)[ContentFormat];
export type ArtifactDto = z.infer<typeof artifactDtoSchema>;
export type ShareState = z.infer<typeof shareStateSchema>;
export type ShareEnvelope = z.infer<typeof shareEnvelopeSchema>;
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;
export type PublicArtifactEnvelope = z.infer<typeof publicArtifactEnvelopeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;
export type ArtifactListEnvelope = z.infer<typeof artifactListEnvelopeSchema>;
export type ContextEnvelope = z.infer<typeof contextEnvelopeSchema>;
export type HealthEnvelope = z.infer<typeof healthEnvelopeSchema>;
