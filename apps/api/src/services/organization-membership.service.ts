import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  INVITATION_EMAIL_MESSAGE,
  INVITATION_LIST_DEFAULT_LIMIT,
  INVITATION_LIST_MAX_LIMIT,
  INVITATION_TOKEN_REQUEST_MESSAGE,
  createInvitationRequestSchema,
  invitationTokenRequestSchema,
  type CreateOrganizationResponse,
  type Invitation,
  type InvitationEnvelope,
  type InvitationList,
  type InvitationPreview,
} from "@factrove/contracts";
import { Prisma } from "@prisma/client";
import {
  consumeInvitation,
  createInvitationToken,
  expireStalePendingInvitations,
  hashInvitationToken,
  invitationTokenMatches,
  isInvitationToken,
  normalizeInvitationEmail,
  revokeInvitation,
} from "../auth/invitation-token.js";
import { readAssignedClientIp } from "../auth/client-ip.js";
import { ActorService, type ActorWithOrganization, type HeaderSource } from "../auth/actor.service.js";
import { OrganizationsRepository, type InvitationRecord } from "../database/repositories/organizations.repository.js";
import { PrismaService } from "../database/index.js";
import { InviteMailer } from "../mail/invite-mailer.js";
import { API_CONFIG, type ApiConfig } from "./api-config.js";
import { ApiErrorException } from "./api-error.js";
import { InvitationRateLimiter } from "./invitation-rate-limit.js";

const SESSION_MESSAGE = "Organization invitations require a browser session.";
const OWNER_MESSAGE = "Only an owner can manage invitations.";
const ALREADY_MEMBER_MESSAGE = "That person is already a member of this organization.";
const PENDING_MESSAGE = "An invitation for this email is already pending.";
const CLOSED_MESSAGE = "Send a new invitation.";
const NOT_FOUND_MESSAGE = "Invitation was not found.";
const INVALID_MESSAGE = "This invitation link is not valid.";
const MISMATCH_MESSAGE = "Sign in with the invited email address.";
const VERIFICATION_MESSAGE = "Confirm your email address before joining this organization.";
const EXISTS_MESSAGE = "You already belong to an organization.";
const EMAIL_UNAVAILABLE_MESSAGE = "The invitation email could not be queued. Resend it to try again.";
const CURSOR_MESSAGE = "That page cursor is not valid.";
const LIMIT_MESSAGE = "The page limit must be from 1 to 50.";

type OwnerActor = ActorWithOrganization & { sessionId: string };

type QueuedInvitation = {
  invitation: InvitationRecord;
  organizationName: string;
  inviterName: string;
};

@Injectable()
export class OrganizationMembershipService {
  private readonly rates = new InvitationRateLimiter();

  constructor(
    @Inject(ActorService) private readonly actors: ActorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrganizationsRepository) private readonly organizations: OrganizationsRepository,
    @Inject(InviteMailer) private readonly mailer: InviteMailer,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async list(request: HeaderSource, query: { limit?: string; cursor?: string }): Promise<InvitationList> {
    const actor = await this.requireOwner(request);
    const limit = readLimit(query.limit);
    const cursor = readCursor(query.cursor);
    const page = await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, actor);
      const point = cursor === null ? null : await this.organizations.cursorCreatedAt(tx, actor.organization.id, cursor);
      if (cursor !== null && point === null) {
        throw new ApiErrorException(400, "INVALID_REQUEST", CURSOR_MESSAGE);
      }
      const rows = await this.organizations.listInvitations(
        tx,
        actor.organization.id,
        limit + 1,
        point === null || cursor === null ? null : { createdAt: asDate(point), id: cursor },
      );
      return rows;
    });
    const visible = page.slice(0, limit);
    const last = visible[visible.length - 1];
    return {
      invitations: visible.map(toInvitation),
      nextCursor: page.length > limit && last ? last.id : null,
    };
  }

  async create(request: HeaderSource, body: unknown): Promise<InvitationEnvelope> {
    const actor = await this.requireOwner(request);
    const email = readInvitationEmail(body);
    this.rates.chargeSend(actor.user.id, actor.organization.id, email);
    const token = createInvitationToken();
    const queued = await this.writeInvitation(() => this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, actor);
      await this.lockSend(tx, actor.organization.id);
      await expireStalePendingInvitations(tx, { organizationId: actor.organization.id });
      if (await this.organizations.emailHasMembership(tx, actor.organization.id, email)) {
        throw new ApiErrorException(409, "ALREADY_MEMBER", ALREADY_MEMBER_MESSAGE);
      }
      if (await this.organizations.pendingId(tx, actor.organization.id, email)) {
        throw new ApiErrorException(409, "INVITATION_PENDING", PENDING_MESSAGE);
      }
      await this.rejectCooldown(tx, actor.organization.id, email);
      const invitation = await this.organizations.insertInvitation(tx, {
        id: randomUUID(),
        organizationId: actor.organization.id,
        email,
        inviterId: actor.user.id,
        tokenHash: hashInvitationToken(token),
      });
      return this.queuedFrom(tx, invitation, actor.organization.id, actor.user.id);
    }));
    this.deliver(queued, token);
    return { invitation: toInvitation(queued.invitation), delivery: "queued" };
  }

  async resend(request: HeaderSource, invitationId: string): Promise<InvitationEnvelope> {
    const actor = await this.requireOwner(request);
    const id = readInvitationId(invitationId);
    const existing = await this.organizations.findInvitation(this.prisma, id, actor.organization.id);
    if (!existing || (existing.status !== "pending" && existing.status !== "expired" && existing.status !== "accepted" && existing.status !== "canceled")) {
      throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
    }
    if (existing.status === "accepted" || existing.status === "canceled") {
      throw new ApiErrorException(409, "INVITATION_CLOSED", CLOSED_MESSAGE);
    }
    const token = createInvitationToken();
    this.rates.chargeSend(actor.user.id, actor.organization.id, normalizeInvitationEmail(existing.email));
    const queued = await this.writeInvitation(() => this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, actor);
      await this.lockSend(tx, actor.organization.id);
      await expireStalePendingInvitations(tx, { organizationId: actor.organization.id });
      const row = await this.organizations.lockInvitation(tx, id, actor.organization.id);
      if (!row) {
        throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      if (row.status === "accepted" || row.status === "canceled") {
        throw new ApiErrorException(409, "INVITATION_CLOSED", CLOSED_MESSAGE);
      }
      if (row.status !== "pending" && row.status !== "expired") {
        throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const email = normalizeInvitationEmail(row.email);
      await this.rejectCooldown(tx, actor.organization.id, email);
      if (await this.organizations.pendingId(tx, actor.organization.id, email, row.id)) {
        throw new ApiErrorException(409, "INVITATION_PENDING", PENDING_MESSAGE);
      }
      const invitation = await this.organizations.rotateInvitation(tx, {
        id: row.id,
        organizationId: actor.organization.id,
        tokenHash: hashInvitationToken(token),
      });
      if (!invitation) {
        throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      const inviterName = await this.organizations.userName(tx, row.inviterId);
      return {
        invitation,
        organizationName: actor.organization.name,
        inviterName: inviterName ?? "",
      };
    }));
    this.deliver(queued, token);
    return { invitation: toInvitation(queued.invitation), delivery: "queued" };
  }

  async revoke(request: HeaderSource, invitationId: string): Promise<void> {
    const actor = await this.requireOwner(request);
    const id = readInvitationId(invitationId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockOwner(tx, actor);
      const row = await this.organizations.lockInvitation(tx, id, actor.organization.id);
      if (!row || (row.status !== "pending" && row.status !== "canceled")) {
        throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
      }
      if (row.status === "canceled") {
        return;
      }
      const revoked = await revokeInvitation(tx, row.id);
      if (!revoked) {
        throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
      }
    });
  }

  async preview(request: HeaderSource, body: unknown): Promise<InvitationPreview> {
    this.rates.chargePreview(clientIp(request));
    const token = readInvitationToken(body);
    const preview = await this.organizations.previewByHash(this.prisma, hashInvitationToken(token));
    if (!preview) {
      throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
    }
    return {
      organization: { name: preview.organizationName },
      inviter: { name: preview.inviterName },
      email: preview.email,
      expiresAt: asDate(preview.expiresAt).toISOString(),
    };
  }

  async accept(request: HeaderSource, body: unknown): Promise<CreateOrganizationResponse> {
    if (this.actors.hasCredentialHeader(request)) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", SESSION_MESSAGE);
    }
    const actor = await this.actors.requireActor(request);
    if (actor.via !== "session" || actor.sessionId === null) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", SESSION_MESSAGE);
    }
    const sessionId = actor.sessionId;
    this.rates.chargeAccept(clientIp(request), sessionId);
    const token = readInvitationToken(body);
    const invitationId = await this.organizations.findIdByHash(this.prisma, hashInvitationToken(token));
    if (invitationId === null) {
      throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
    }
    return this.prisma.$transaction(async (tx) => {
      // Same first lock as creating an organization: the acting user row.
      // Onboarding and accept then cannot each hold a lock the other needs.
      const user = await this.organizations.lockUser(tx, actor.user.id);
      if (!user || !(await this.organizations.sessionIsCurrent(tx, sessionId, actor.user.id))) {
        throw new ApiErrorException(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      // Organization before invitation. A send already holds this row, and the
      // member insert needs it too. Taking the invitation first deadlocks.
      if (!(await this.organizations.lockInvitationOrganization(tx, invitationId))) {
        throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
      }
      const row = await this.organizations.lockInvitationById(tx, invitationId);
      if (!row || !liveInvitation(row, token)) {
        throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
      }
      if (!user.emailVerified) {
        throw new ApiErrorException(403, "EMAIL_VERIFICATION_REQUIRED", VERIFICATION_MESSAGE);
      }
      if (normalizeInvitationEmail(user.email) !== normalizeInvitationEmail(row.email)) {
        throw new ApiErrorException(403, "INVITATION_EMAIL_MISMATCH", MISMATCH_MESSAGE);
      }
      if (await this.organizations.membershipRole(tx, row.inviterId, row.organizationId) !== "owner") {
        throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
      }
      if (await this.organizations.membershipCount(tx, actor.user.id) > 0) {
        throw new ApiErrorException(409, "ORGANIZATION_EXISTS", EXISTS_MESSAGE);
      }
      const organization = await this.organizations.organizationIdentity(tx, row.organizationId);
      if (!organization) {
        throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
      }
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          userId: actor.user.id,
          role: "member",
          createdAt: new Date(),
        },
      });
      const consumed = await consumeInvitation(tx, row.id);
      if (!consumed) {
        throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
      }
      const updated = await this.organizations.activateSession(tx, sessionId, actor.user.id, organization.id);
      if (updated !== 1) {
        throw new ApiErrorException(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      return { organization: { id: organization.id, name: organization.name } };
    });
  }

  private async requireOwner(request: HeaderSource): Promise<OwnerActor> {
    if (this.actors.hasCredentialHeader(request)) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", SESSION_MESSAGE);
    }
    const actor = await this.actors.requireCurrentOrganization(request);
    if (actor.via !== "session" || actor.sessionId === null) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", SESSION_MESSAGE);
    }
    const role = await this.organizations.membershipRole(this.prisma, actor.user.id, actor.organization.id);
    if (role !== "owner") {
      throw new ApiErrorException(403, "FORBIDDEN", OWNER_MESSAGE);
    }
    return { ...actor, sessionId: actor.sessionId };
  }

  // The organization row is the shared resource for every owner. Holding it
  // from the cooldown check through the invitation write stops a second owner
  // from sending again after the first owner inserts and revokes.
  private async lockSend(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    const locked = await this.organizations.lockOrganization(tx, organizationId);
    if (!locked) {
      throw new ApiErrorException(403, "FORBIDDEN", OWNER_MESSAGE);
    }
  }

  private async lockOwner(tx: Prisma.TransactionClient, actor: OwnerActor): Promise<void> {
    const user = await this.organizations.lockUser(tx, actor.user.id);
    if (!user || !(await this.organizations.sessionIsCurrent(tx, actor.sessionId, actor.user.id))) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    const role = await this.organizations.membershipRole(tx, actor.user.id, actor.organization.id);
    if (role !== "owner") {
      throw new ApiErrorException(403, "FORBIDDEN", OWNER_MESSAGE);
    }
  }

  private async rejectCooldown(tx: Prisma.TransactionClient, organizationId: string, email: string): Promise<void> {
    const retryAfterSeconds = await this.organizations.cooldownSeconds(tx, organizationId, email);
    if (retryAfterSeconds > 0) {
      throw new ApiErrorException(429, "RATE_LIMITED", "Too many invitation requests. Try again later.", retryAfterSeconds);
    }
  }

  private async queuedFrom(
    tx: Prisma.TransactionClient,
    invitation: InvitationRecord,
    organizationId: string,
    inviterId: string,
  ): Promise<QueuedInvitation> {
    const organization = await this.organizations.organizationIdentity(tx, organizationId);
    const inviterName = await this.organizations.userName(tx, inviterId);
    return {
      invitation,
      organizationName: organization?.name ?? "",
      inviterName: inviterName ?? "",
    };
  }

  private async writeInvitation(write: () => Promise<QueuedInvitation>): Promise<QueuedInvitation> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof ApiErrorException) {
        throw error;
      }
      if (isPendingEmailConflict(error)) {
        throw new ApiErrorException(409, "INVITATION_PENDING", PENDING_MESSAGE);
      }
      throw error;
    }
  }

  private deliver(queued: QueuedInvitation, token: string): void {
    const acceptUrl = invitationAcceptUrl(this.config.webOrigin, token);
    let accepted = false;
    try {
      accepted = this.mailer.trySendOrganizationInvite({
        email: queued.invitation.email,
        organizationName: queued.organizationName,
        inviterName: queued.inviterName,
        expiresAt: asDate(queued.invitation.expiresAt),
        acceptUrl,
      });
    } catch {
      accepted = false;
    }
    if (!accepted) {
      throw new ApiErrorException(503, "EMAIL_UNAVAILABLE", EMAIL_UNAVAILABLE_MESSAGE, 1);
    }
  }
}

function liveInvitation(row: { status: string; role: string | null; tokenHash: string | null; isExpired: boolean }, token: string): boolean {
  return row.status === "pending"
    && row.role === "member"
    && !isDatabaseExpired(row.isExpired)
    && row.tokenHash !== null
    && invitationTokenMatches(token, row.tokenHash);
}

function isDatabaseExpired(value: boolean | string): boolean {
  return value === true || value === "t" || value === "true";
}

function readInvitationEmail(body: unknown): string {
  const parsed = createInvitationRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", INVITATION_EMAIL_MESSAGE);
  }
  return normalizeInvitationEmail(parsed.data.email);
}

function readInvitationToken(body: unknown): string {
  const parsed = invitationTokenRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiErrorException(400, "INVALID_REQUEST", INVITATION_TOKEN_REQUEST_MESSAGE);
  }
  if (!isInvitationToken(parsed.data.token)) {
    throw new ApiErrorException(404, "INVITATION_INVALID", INVALID_MESSAGE);
  }
  return parsed.data.token;
}

function readInvitationId(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new ApiErrorException(404, "INVITATION_NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  return trimmed;
}

function readLimit(value: string | undefined): number {
  if (value === undefined || value.length === 0) {
    return INVITATION_LIST_DEFAULT_LIMIT;
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ApiErrorException(400, "INVALID_REQUEST", LIMIT_MESSAGE);
  }
  const limit = Number(value);
  if (limit > INVITATION_LIST_MAX_LIMIT) {
    throw new ApiErrorException(400, "INVALID_REQUEST", LIMIT_MESSAGE);
  }
  return limit;
}

function readCursor(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  if (value.trim() !== value || value.length > 200) {
    throw new ApiErrorException(400, "INVALID_REQUEST", CURSOR_MESSAGE);
  }
  return value;
}

function clientIp(request: HeaderSource): string {
  return readAssignedClientIp(request.headers) ?? "unknown";
}

function invitationAcceptUrl(webOrigin: string, token: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/invites/accept?token=${encodeURIComponent(token)}`;
}

function toInvitation(row: InvitationRecord): Invitation {
  const role = row.role === "owner" || row.role === "admin" || row.role === "member" ? row.role : "member";
  const status = invitationStatus(row.status);
  return {
    id: row.id,
    email: row.email,
    role,
    status,
    expiresAt: asDate(row.expiresAt).toISOString(),
    lastSentAt: row.lastSentAt === null ? null : asDate(row.lastSentAt).toISOString(),
    createdAt: asDate(row.createdAt).toISOString(),
  };
}

function invitationStatus(status: string): Invitation["status"] {
  if (status === "pending" || status === "accepted" || status === "canceled" || status === "expired") {
    return status;
  }
  throw new Error("Invitation status is invalid.");
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invitation timestamp is invalid.");
  }
  return date;
}

function isPendingEmailConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return true;
    }
    const code = typeof error.meta?.code === "string" ? error.meta.code : "";
    if (error.code === "P2010" && code === "23505") {
      return true;
    }
  }
  return error instanceof Error && error.message.includes("invitation_pending_email_key");
}
