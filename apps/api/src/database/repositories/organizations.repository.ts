import { Injectable } from "@nestjs/common";
import type { InvitationDb } from "../../auth/invitation-token.js";

export type LockedUser = {
  id: string;
  email: string;
  emailVerified: boolean;
};

export type InvitationRecord = {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  lastSentAt: Date | null;
  createdAt: Date;
};

export type LockedInvitation = InvitationRecord & {
  tokenHash: string | null;
  organizationId: string;
  inviterId: string;
  isExpired: boolean;
};

export type InvitationPreviewRecord = {
  organizationName: string;
  inviterName: string;
  email: string;
  expiresAt: Date;
};

export type InvitationCursor = {
  createdAt: Date;
  id: string;
};

export type MemberRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
};

@Injectable()
export class OrganizationsRepository {
  async lockUser(db: InvitationDb, userId: string): Promise<LockedUser | null> {
    const rows = await db.$queryRaw<LockedUser[]>`
      SELECT id, email, "emailVerified"
      FROM "user"
      WHERE id = ${userId}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async sessionIsCurrent(db: InvitationDb, sessionId: string, userId: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM session
      WHERE id = ${sessionId}
        AND "userId" = ${userId}
        AND "expiresAt" > CURRENT_TIMESTAMP
    `;
    return rows.length === 1;
  }

  async membershipShare(
    db: InvitationDb,
    userId: string,
    organizationId: string,
  ): Promise<{ id: string; role: string } | null> {
    const rows = await db.$queryRaw<Array<{ id: string; role: string }>>`
      SELECT id, role
      FROM member
      WHERE "userId" = ${userId}
        AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    return rows[0] ?? null;
  }

  async membershipRole(db: InvitationDb, userId: string, organizationId: string): Promise<string | null> {
    const rows = await db.$queryRaw<Array<{ role: string }>>`
      SELECT role
      FROM member
      WHERE "userId" = ${userId}
        AND "organizationId" = ${organizationId}
      FOR SHARE
    `;
    return rows[0]?.role ?? null;
  }

  async membershipCount(db: InvitationDb, userId: string): Promise<number> {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM member
      WHERE "userId" = ${userId}
    `;
    return Number(rows[0]?.count ?? 0);
  }

  async emailHasMembership(db: InvitationDb, organizationId: string, email: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ found: boolean }>>`
      SELECT TRUE AS found
      FROM member AS m
      JOIN "user" AS u ON u.id = m."userId"
      WHERE m."organizationId" = ${organizationId}
        AND lower(u.email) = ${email}
      LIMIT 1
    `;
    return rows.length > 0;
  }

  async pendingId(
    db: InvitationDb,
    organizationId: string,
    email: string,
    exceptId?: string,
  ): Promise<string | null> {
    const rows = exceptId === undefined
      ? await db.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM invitation
          WHERE "organizationId" = ${organizationId}
            AND lower(email) = ${email}
            AND status = 'pending'
          LIMIT 1
        `
      : await db.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM invitation
          WHERE "organizationId" = ${organizationId}
            AND lower(email) = ${email}
            AND status = 'pending'
            AND id <> ${exceptId}
          LIMIT 1
        `;
    return rows[0]?.id ?? null;
  }

  async cooldownSeconds(db: InvitationDb, organizationId: string, email: string): Promise<number> {
    const rows = await db.$queryRaw<Array<{ seconds: number | null }>>`
      SELECT CEIL(
        EXTRACT(EPOCH FROM (MAX("lastSentAt") + interval '60 seconds' - CURRENT_TIMESTAMP))
      )::int AS seconds
      FROM invitation
      WHERE "organizationId" = ${organizationId}
        AND lower(email) = ${email}
        AND "lastSentAt" IS NOT NULL
        AND "lastSentAt" > CURRENT_TIMESTAMP - interval '60 seconds'
    `;
    const seconds = Number(rows[0]?.seconds ?? 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }

  async insertInvitation(
    db: InvitationDb,
    input: { id: string; organizationId: string; email: string; inviterId: string; tokenHash: string },
  ): Promise<InvitationRecord> {
    const rows = await db.$queryRaw<InvitationRecord[]>`
      INSERT INTO invitation (
        id,
        "organizationId",
        email,
        role,
        status,
        "expiresAt",
        "createdAt",
        "inviterId",
        "tokenHash",
        "lastSentAt"
      ) VALUES (
        ${input.id},
        ${input.organizationId},
        ${input.email},
        'member',
        'pending',
        CURRENT_TIMESTAMP + interval '7 days',
        CURRENT_TIMESTAMP,
        ${input.inviterId},
        ${input.tokenHash},
        CURRENT_TIMESTAMP
      )
      RETURNING id, email, role, status, "expiresAt", "lastSentAt", "createdAt"
    `;
    return requiredRow(rows);
  }

  async rotateInvitation(
    db: InvitationDb,
    input: { id: string; organizationId: string; tokenHash: string },
  ): Promise<InvitationRecord | null> {
    const rows = await db.$queryRaw<InvitationRecord[]>`
      UPDATE invitation
      SET "tokenHash" = ${input.tokenHash},
          status = 'pending',
          "expiresAt" = CURRENT_TIMESTAMP + interval '7 days',
          "lastSentAt" = CURRENT_TIMESTAMP
      WHERE id = ${input.id}
        AND "organizationId" = ${input.organizationId}
        AND status IN ('pending', 'expired')
      RETURNING id, email, role, status, "expiresAt", "lastSentAt", "createdAt"
    `;
    return rows[0] ?? null;
  }

  async findInvitation(db: InvitationDb, id: string, organizationId: string): Promise<LockedInvitation | null> {
    const rows = await this.invitationRows(db, id, organizationId, false);
    return rows[0] ?? null;
  }

  // Shared by every owner of this organization. Callers take it after the acting
  // user and membership share, and before any invitation row, matching the
  // migration lock order: user, member, organization, invitation.
  async lockOrganization(db: InvitationDb, organizationId: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM organization
      WHERE id = ${organizationId}
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  // The invitation row is read, not locked. The organization lock comes first so
  // a later invitation lock cannot wait while another transaction holds this row.
  async lockInvitationOrganization(db: InvitationDb, invitationId: string): Promise<boolean> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT organization.id
      FROM organization
      WHERE organization.id = (
        SELECT "organizationId"
        FROM invitation
        WHERE id = ${invitationId}
      )
      FOR UPDATE OF organization
    `;
    return rows.length === 1;
  }

  async lockInvitation(db: InvitationDb, id: string, organizationId: string): Promise<LockedInvitation | null> {
    const rows = await this.invitationRows(db, id, organizationId, true);
    return rows[0] ?? null;
  }

  async activateSession(db: InvitationDb, sessionId: string, userId: string, organizationId: string): Promise<number> {
    return db.$executeRaw`
      UPDATE session
      SET "activeOrganizationId" = ${organizationId},
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = ${sessionId}
        AND "userId" = ${userId}
        AND "expiresAt" > CURRENT_TIMESTAMP
    `;
  }

  private invitationRows(
    db: InvitationDb,
    id: string,
    organizationId: string,
    lock: boolean,
  ): Promise<LockedInvitation[]> {
    if (lock) {
      return db.$queryRaw<LockedInvitation[]>`
        SELECT
          id,
          email,
          role,
          status,
          "tokenHash",
          "organizationId",
          "inviterId",
          "expiresAt",
          "lastSentAt",
          "createdAt",
          ("expiresAt" <= CURRENT_TIMESTAMP) AS "isExpired"
        FROM invitation
        WHERE id = ${id}
          AND "organizationId" = ${organizationId}
        FOR UPDATE
      `;
    }
    return db.$queryRaw<LockedInvitation[]>`
      SELECT
        id,
        email,
        role,
        status,
        "tokenHash",
        "organizationId",
        "inviterId",
        "expiresAt",
        "lastSentAt",
        "createdAt",
        ("expiresAt" <= CURRENT_TIMESTAMP) AS "isExpired"
      FROM invitation
      WHERE id = ${id}
        AND "organizationId" = ${organizationId}
    `;
  }

  async lockInvitationById(db: InvitationDb, id: string): Promise<LockedInvitation | null> {
    const rows = await db.$queryRaw<LockedInvitation[]>`
      SELECT
        id,
        email,
        role,
        status,
        "tokenHash",
        "organizationId",
        "inviterId",
        "expiresAt",
        "lastSentAt",
        "createdAt",
        ("expiresAt" <= CURRENT_TIMESTAMP) AS "isExpired"
      FROM invitation
      WHERE id = ${id}
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }

  async findIdByHash(db: InvitationDb, tokenHash: string): Promise<string | null> {
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM invitation
      WHERE "tokenHash" = ${tokenHash}
    `;
    return rows[0]?.id ?? null;
  }

  async previewByHash(db: InvitationDb, tokenHash: string): Promise<InvitationPreviewRecord | null> {
    const rows = await db.$queryRaw<InvitationPreviewRecord[]>`
      SELECT
        o.name AS "organizationName",
        u.name AS "inviterName",
        i.email AS email,
        i."expiresAt" AS "expiresAt"
      FROM invitation AS i
      JOIN organization AS o ON o.id = i."organizationId"
      JOIN "user" AS u ON u.id = i."inviterId"
      WHERE i."tokenHash" = ${tokenHash}
        AND i.status = 'pending'
        AND i."expiresAt" > CURRENT_TIMESTAMP
    `;
    return rows[0] ?? null;
  }

  async cursorCreatedAt(db: InvitationDb, organizationId: string, id: string): Promise<Date | null> {
    const rows = await db.$queryRaw<Array<{ createdAt: Date }>>`
      SELECT "createdAt"
      FROM invitation
      WHERE id = ${id}
        AND "organizationId" = ${organizationId}
    `;
    return rows[0]?.createdAt ?? null;
  }

  async listInvitations(
    db: InvitationDb,
    organizationId: string,
    limit: number,
    cursor: InvitationCursor | null,
  ): Promise<InvitationRecord[]> {
    if (cursor) {
      return db.$queryRaw<InvitationRecord[]>`
        SELECT id, email, role, status, "expiresAt", "lastSentAt", "createdAt"
        FROM invitation
        WHERE "organizationId" = ${organizationId}
          AND ("createdAt", id) < (${cursor.createdAt}, ${cursor.id})
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${limit}
      `;
    }
    return db.$queryRaw<InvitationRecord[]>`
      SELECT id, email, role, status, "expiresAt", "lastSentAt", "createdAt"
      FROM invitation
      WHERE "organizationId" = ${organizationId}
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${limit}
    `;
  }

  async memberCursor(db: InvitationDb, organizationId: string, id: string): Promise<Date | null> {
    const rows = await db.$queryRaw<Array<{ createdAt: Date }>>`
      SELECT "createdAt"
      FROM member
      WHERE id = ${id}
        AND "organizationId" = ${organizationId}
    `;
    return rows[0]?.createdAt ?? null;
  }

  // Joined date ascending, then id. The cursor is exclusive.
  async listMembers(
    db: InvitationDb,
    organizationId: string,
    limit: number,
    cursor: InvitationCursor | null,
  ): Promise<MemberRecord[]> {
    if (cursor) {
      return db.$queryRaw<MemberRecord[]>`
        SELECT m.id, u.name, u.email, m.role, m."createdAt"
        FROM member AS m
        JOIN "user" AS u ON u.id = m."userId"
        WHERE m."organizationId" = ${organizationId}
          AND (m."createdAt", m.id) > (${cursor.createdAt}, ${cursor.id})
        ORDER BY m."createdAt" ASC, m.id ASC
        LIMIT ${limit}
      `;
    }
    return db.$queryRaw<MemberRecord[]>`
      SELECT m.id, u.name, u.email, m.role, m."createdAt"
      FROM member AS m
      JOIN "user" AS u ON u.id = m."userId"
      WHERE m."organizationId" = ${organizationId}
      ORDER BY m."createdAt" ASC, m.id ASC
      LIMIT ${limit}
    `;
  }

  async listPendingInvitations(db: InvitationDb, organizationId: string, limit: number): Promise<InvitationRecord[]> {
    return db.$queryRaw<InvitationRecord[]>`
      SELECT id, email, role, status, "expiresAt", "lastSentAt", "createdAt"
      FROM invitation
      WHERE "organizationId" = ${organizationId}
        AND status = 'pending'
        AND "expiresAt" > CURRENT_TIMESTAMP
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${limit}
    `;
  }

  async organizationIdentity(db: InvitationDb, id: string): Promise<{ id: string; name: string } | null> {
    const rows = await db.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name
      FROM organization
      WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }

  async userName(db: InvitationDb, id: string): Promise<string | null> {
    const rows = await db.$queryRaw<Array<{ name: string }>>`
      SELECT name
      FROM "user"
      WHERE id = ${id}
    `;
    return rows[0]?.name ?? null;
  }
}

function requiredRow(rows: InvitationRecord[]): InvitationRecord {
  const row = rows[0];
  if (!row) {
    throw new Error("Invitation insert did not return a row.");
  }
  return row;
}
