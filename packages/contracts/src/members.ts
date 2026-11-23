import { z } from "zod";
import { invitationRoleSchema, invitationSchema } from "./invitations.js";

export const organizationMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: invitationRoleSchema,
});

export const organizationMemberCallerSchema = z.object({
  id: z.string(),
  role: invitationRoleSchema,
});

export const organizationMemberListSchema = z.object({
  caller: organizationMemberCallerSchema,
  members: z.array(organizationMemberSchema),
  invitations: z.array(invitationSchema),
  nextCursor: z.string().nullable(),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type OrganizationMemberList = z.infer<typeof organizationMemberListSchema>;
