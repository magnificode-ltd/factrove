import * as z from "zod";

export const ORGANIZATION_NAME_MAX_LENGTH = 80;
export const ORGANIZATION_NAME_MESSAGE = "name must be one line of 1 to 80 characters.";
export const CREATE_ORGANIZATION_REQUEST_MESSAGE =
  'Send { "name": "<organization name>" }. The name is one line of 1 to 80 characters.';

const ORGANIZATION_NAME_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u;

export function organizationNameHasForbiddenCharacter(value: string): boolean {
  return ORGANIZATION_NAME_FORBIDDEN.test(value.normalize("NFC"));
}

export function organizationNameCodePointLength(value: string): number {
  return [...value].length;
}

// NFC first. Forbidden characters are rejected before trimming. Then 1 to 80 code points.
export function normalizeOrganizationName(value: string): string | null {
  const normalized = value.normalize("NFC");
  if (organizationNameHasForbiddenCharacter(normalized)) {
    return null;
  }
  const trimmed = normalized.trim();
  const length = organizationNameCodePointLength(trimmed);
  if (length === 0 || length > ORGANIZATION_NAME_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}

export const createOrganizationRequestSchema = z
  .object({
    name: z.string().superRefine((value, ctx) => {
      if (normalizeOrganizationName(value) === null) {
        ctx.addIssue(ORGANIZATION_NAME_MESSAGE);
      }
    }),
  })
  .strict();

export const createOrganizationResponseSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export type CreateOrganizationResponse = z.infer<typeof createOrganizationResponseSchema>;
