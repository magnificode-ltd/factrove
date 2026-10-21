import { z } from "zod";

export const accessTypeSchema = z.enum(["private", "org_shared"]);
export const artifactViewSchema = z.enum(["mine", "org"]);
export const contentFormatSchema = z.enum(["html", "markdown"]);

export const contentMediaTypes = {
  html: "text/html",
  markdown: "text/markdown"
} as const;

export const SHARE_PASSWORD_MIN_LENGTH = 8;
export const SHARE_PASSWORD_MAX_LENGTH = 128;
// The visitor sends an unlock grant in this header. It is never a cookie or part of a URL.
export const SHARE_GRANT_HEADER = "x-factrove-share-grant";

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
  shared: z.boolean(),
  passwordProtected: z.boolean()
});

export const shareStateSchema = z.object({
  shared: z.boolean(),
  shareUrl: z.string().url().nullable(),
  passwordProtected: z.boolean()
});

export const shareEnvelopeSchema = z.object({
  share: shareStateSchema
});

export const sharePasswordSchema = z
  .string()
  .min(SHARE_PASSWORD_MIN_LENGTH, `Use at least ${SHARE_PASSWORD_MIN_LENGTH} characters.`)
  .max(SHARE_PASSWORD_MAX_LENGTH, `Use at most ${SHARE_PASSWORD_MAX_LENGTH} characters.`);

export const createShareRequestSchema = z
  .object({
    password: sharePasswordSchema.optional()
  })
  .strict();

export const publicArtifactSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  mimeType: z.literal("text/html"),
  sizeBytes: z.number().int().nonnegative(),
  uploadedAt: z.string().datetime({ offset: true }),
  contentUrl: z.string().url(),
  passwordProtected: z.boolean()
});

export const publicArtifactEnvelopeSchema = z.object({
  artifact: publicArtifactSchema
});

export const publicUnlockRequestSchema = z
  .object({
    password: z.string().min(1).max(1024)
  })
  .strict();

// grant is null when the link has no password, so the visitor can open it directly.
export const publicUnlockEnvelopeSchema = z.object({
  grant: z
    .object({
      token: z.string().min(1),
      expiresAt: z.string().datetime({ offset: true })
    })
    .nullable()
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
export type CreateShareRequest = z.infer<typeof createShareRequestSchema>;
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;
export type PublicArtifactEnvelope = z.infer<typeof publicArtifactEnvelopeSchema>;
export type PublicUnlockRequest = z.infer<typeof publicUnlockRequestSchema>;
export type PublicUnlockEnvelope = z.infer<typeof publicUnlockEnvelopeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;
export type ArtifactListEnvelope = z.infer<typeof artifactListEnvelopeSchema>;
export type ContextEnvelope = z.infer<typeof contextEnvelopeSchema>;
export type HealthEnvelope = z.infer<typeof healthEnvelopeSchema>;
