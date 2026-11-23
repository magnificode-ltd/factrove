import { z } from "zod";

export const INVITATION_EMAIL_MAX_LENGTH = 254;
export const INVITATION_EMAIL_MESSAGE = "Enter an email address.";
export const INVITATION_TOKEN_REQUEST_MESSAGE = "Send the invitation token as JSON.";
export const INVITATION_LIST_DEFAULT_LIMIT = 20;
export const INVITATION_LIST_MAX_LIMIT = 50;

const invitationEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const invitationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(INVITATION_EMAIL_MAX_LENGTH)
  .regex(invitationEmailPattern, INVITATION_EMAIL_MESSAGE)
  .refine((value) => !value.includes("<") && !value.includes(">"), INVITATION_EMAIL_MESSAGE);

export const invitationStatusSchema = z.enum(["pending", "accepted", "canceled", "expired"]);
export const invitationRoleSchema = z.enum(["owner", "admin", "member"]);

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: invitationRoleSchema,
  status: invitationStatusSchema,
  expiresAt: z.string().datetime({ offset: true }),
  lastSentAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export const invitationDeliverySchema = z.literal("queued");

export const invitationEnvelopeSchema = z.object({
  invitation: invitationSchema,
  delivery: invitationDeliverySchema,
});

export const invitationListSchema = z.object({
  invitations: z.array(invitationSchema),
  nextCursor: z.string().nullable(),
});

export const createInvitationRequestSchema = z
  .object({
    email: invitationEmailSchema,
  })
  .strict();

export const invitationTokenRequestSchema = z
  .object({
    token: z.string(),
  })
  .strict();

export const invitationPreviewSchema = z.object({
  organization: z.object({
    name: z.string(),
  }),
  inviter: z.object({
    name: z.string(),
  }),
  email: z.string(),
  expiresAt: z.string().datetime({ offset: true }),
});

export type Invitation = z.infer<typeof invitationSchema>;
export type InvitationEnvelope = z.infer<typeof invitationEnvelopeSchema>;
export type InvitationList = z.infer<typeof invitationListSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
