import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

// 32 bytes, base64url, no padding. The invitation id is not a substitute for this secret.
export const INVITATION_TOKEN_BYTES = 32;

export const INVITATION_PENDING = "pending";
export const INVITATION_ACCEPTED = "accepted";
export const INVITATION_CANCELED = "canceled";
export const INVITATION_EXPIRED = "expired";

export type InvitationDb = Prisma.TransactionClient | PrismaClient;

export function createInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

export function isInvitationToken(value: string): boolean {
  return value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function invitationTokenMatches(token: string, tokenHash: string): boolean {
  if (!isInvitationToken(token) || !/^[0-9a-f]{64}$/.test(tokenHash)) {
    return false;
  }
  const actual = Buffer.from(hashInvitationToken(token), "utf8");
  const expected = Buffer.from(tokenHash, "utf8");
  return timingSafeEqual(actual, expected);
}

// Same address auth stores: trim, lower case, and keep a plus tag (name+tag@host).
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Pending rows past expiresAt become expired and lose their hash. The clock is
// PostgreSQL CURRENT_TIMESTAMP, so a caller cannot pass an application time.
// Call this before inserting a replacement so a stale pending row frees the
// one-pending-email slot.
export async function expireStalePendingInvitations(
  db: InvitationDb,
  scope?: { organizationId: string },
): Promise<number> {
  if (scope?.organizationId) {
    return db.$executeRaw`
      UPDATE invitation
      SET status = ${INVITATION_EXPIRED},
          "tokenHash" = NULL
      WHERE status = ${INVITATION_PENDING}
        AND "expiresAt" <= CURRENT_TIMESTAMP
        AND "organizationId" = ${scope.organizationId}
    `;
  }
  return db.$executeRaw`
    UPDATE invitation
    SET status = ${INVITATION_EXPIRED},
        "tokenHash" = NULL
    WHERE status = ${INVITATION_PENDING}
      AND "expiresAt" <= CURRENT_TIMESTAMP
  `;
}

export async function consumeInvitation(db: InvitationDb, invitationId: string): Promise<boolean> {
  return clearPendingInvitation(db, invitationId, INVITATION_ACCEPTED);
}

export async function revokeInvitation(db: InvitationDb, invitationId: string): Promise<boolean> {
  return clearPendingInvitation(db, invitationId, INVITATION_CANCELED);
}

async function clearPendingInvitation(
  db: InvitationDb,
  invitationId: string,
  status: typeof INVITATION_ACCEPTED | typeof INVITATION_CANCELED,
): Promise<boolean> {
  const updated = await db.$executeRaw`
    UPDATE invitation
    SET status = ${status},
        "tokenHash" = NULL
    WHERE id = ${invitationId}
      AND status = ${INVITATION_PENDING}
  `;
  return updated === 1;
}
