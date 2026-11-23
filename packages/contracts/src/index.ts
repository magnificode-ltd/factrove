import { z } from "zod";
import { ARTIFACT_NAME_MESSAGE, artifactNameValueSchema, normalizeArtifactName } from "./artifact-name.js";

export {
  ARTIFACT_NAME_MAX_LENGTH,
  ARTIFACT_NAME_MESSAGE,
  artifactNameCodePointLength,
  artifactNameFromFilename,
  artifactNameHasForbiddenCharacter,
  artifactNameValueSchema,
  normalizeArtifactName
} from "./artifact-name.js";

export {
  CREATE_ORGANIZATION_REQUEST_MESSAGE,
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MESSAGE,
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  normalizeOrganizationName,
  organizationNameCodePointLength,
  type CreateOrganizationResponse
} from "./organization-name.js";

export {
  INVITATION_EMAIL_MAX_LENGTH,
  INVITATION_EMAIL_MESSAGE,
  INVITATION_LIST_DEFAULT_LIMIT,
  INVITATION_LIST_MAX_LIMIT,
  INVITATION_TOKEN_REQUEST_MESSAGE,
  createInvitationRequestSchema,
  invitationDeliverySchema,
  invitationEmailSchema,
  invitationEnvelopeSchema,
  invitationListSchema,
  invitationPreviewSchema,
  invitationRoleSchema,
  invitationSchema,
  invitationStatusSchema,
  invitationTokenRequestSchema,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationEnvelope,
  type InvitationList,
  type InvitationPreview,
  type InvitationTokenRequest
} from "./invitations.js";

export const accessTypeSchema = z.enum(["private", "org_shared"]);
export const artifactViewSchema = z.enum(["mine", "org"]);
export const contentFormatSchema = z.enum(["html", "markdown"]);

export const contentMediaTypes = {
  html: "text/html",
  markdown: "text/markdown"
} as const;

// Better Auth email/password defaults. createAuth passes these through so the
// API and the OpenAPI request schemas share one source.
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;
// @better-auth/api-key defaults. factroveApiKey passes these through.
export const API_KEY_NAME_MIN_LENGTH = 1;
export const API_KEY_NAME_MAX_LENGTH = 32;

export const SHARE_PASSWORD_MIN_LENGTH = 10;
export const SHARE_PASSWORD_MAX_LENGTH = 128;
export const SHARE_PASSWORD_MIN_UNIQUE = 4;
export {
  isAllWhitespaceSharePassword,
  isCommonSharePassword,
  uniqueSharePasswordCharacters
} from "./common-passwords.js";
import {
  isAllWhitespaceSharePassword,
  isCommonSharePassword,
  uniqueSharePasswordCharacters
} from "./common-passwords.js";
// The visitor sends an unlock grant in this header. It is never a cookie or part of a URL.
export const SHARE_GRANT_HEADER = "x-factrove-share-grant";

export const artifactDtoSchema = z.object({
  id: z.string().uuid(),
  creatorUserId: z.string(),
  organizationId: z.string().nullable(),
  accessType: accessTypeSchema,
  filename: z.string(),
  name: artifactNameValueSchema()
    .nullable()
    .describe("Library name. Null when the artifact has no name."),
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
  passwordProtected: z.boolean(),
  guessesLockedOut: z.boolean().optional()
});

export const shareEnvelopeSchema = z.object({
  share: shareStateSchema
});

const sharePasswordRules = z
  .string()
  .min(SHARE_PASSWORD_MIN_LENGTH, `Use at least ${SHARE_PASSWORD_MIN_LENGTH} characters.`)
  .max(SHARE_PASSWORD_MAX_LENGTH, `Use at most ${SHARE_PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => !isAllWhitespaceSharePassword(value), {
    message: "Choose a password with letters or numbers."
  })
  .refine((value) => uniqueSharePasswordCharacters(value) >= SHARE_PASSWORD_MIN_UNIQUE, {
    message: `Use at least ${SHARE_PASSWORD_MIN_UNIQUE} different characters.`
  })
  .refine((value) => !isCommonSharePassword(value), {
    message: "Choose a less common password."
  });

export const sharePasswordSchema = z.preprocess(
  (value) => typeof value === "string" ? value.normalize("NFC") : value,
  sharePasswordRules
);

export const createShareRequestSchema = z
  .object({
    password: z.preprocess(
      (value) => value === undefined || typeof value !== "string" ? value : value.normalize("NFC"),
      sharePasswordRules.optional()
    )
  })
  .strict();

// The only accepted change is private -> org_shared. org_shared -> private is not this request.
// organizationId is the organization the caller confirmed, and it must be the current membership.
export const SHARE_WITH_ORGANIZATION_REQUEST_MESSAGE =
  'Send { "accessType": "org_shared", "organizationId": "<current organization id>" }. This shares a private artifact with that organization.';

export const ORGANIZATION_CHANGED_MESSAGE =
  "The current organization changed. Confirm the organization and try again.";

export const shareWithOrganizationRequestSchema = z
  .object({
    accessType: z.literal("org_shared"),
    organizationId: z.string().min(1)
  })
  .strict();

// Name only. This is not the organization-share body, and it cannot clear a name.
export const RENAME_ARTIFACT_REQUEST_MESSAGE =
  'Send { "name": "<library name>" }. The name is one line of 1 to 120 characters.';

export const renameArtifactRequestSchema = z
  .object({
    // Same acceptance rule as upload: NFC, then trim, then 1 to 120 code points.
    // A raw string can be longer than 120 before that normalization.
    name: z.string().superRefine((value, ctx) => {
      if (normalizeArtifactName(value) === null) {
        ctx.addIssue(ARTIFACT_NAME_MESSAGE);
      }
    })
  })
  .strict();

export const publicArtifactSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  name: artifactNameValueSchema()
    .nullable()
    .describe("Library name. Null when the artifact has no name."),
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
export type ShareWithOrganizationRequest = z.infer<typeof shareWithOrganizationRequestSchema>;
export type RenameArtifactRequest = z.infer<typeof renameArtifactRequestSchema>;
export type PublicArtifact = z.infer<typeof publicArtifactSchema>;
export type PublicArtifactEnvelope = z.infer<typeof publicArtifactEnvelopeSchema>;
export type PublicUnlockRequest = z.infer<typeof publicUnlockRequestSchema>;
export type PublicUnlockEnvelope = z.infer<typeof publicUnlockEnvelopeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;
export type ArtifactListEnvelope = z.infer<typeof artifactListEnvelopeSchema>;
export type ContextEnvelope = z.infer<typeof contextEnvelopeSchema>;
export type HealthEnvelope = z.infer<typeof healthEnvelopeSchema>;

export { apiErrorCatalog, type ApiErrorCode } from "./errors.js";
