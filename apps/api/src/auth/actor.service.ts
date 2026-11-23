import type { IncomingHttpHeaders } from "node:http";
import { Inject, Injectable } from "@nestjs/common";
import type { ContextEnvelope } from "@factrove/contracts";
import { fromNodeHeaders } from "better-auth/node";
import { PrismaService } from "../database/index.js";
import { ApiErrorException } from "../services/api-error.js";
import { createdByMemberIdFrom, createdByUserIdFrom } from "./api-key-scope.js";
import { AuthService } from "./auth.service.js";
import {
  ORGANIZATION_SELECTION_REQUIRED_MESSAGE,
  ORGANIZATION_SETUP_REQUIRED_MESSAGE,
  resolveCurrentOrganization,
  type ResolvedOrganization,
} from "./current-organization.js";

export type Actor = ContextEnvelope & {
  via: "session" | "api-key";
  // Set for a session cookie. API keys have no session row to lock.
  sessionId: string | null;
  organizationStatus: ResolvedOrganization["status"];
};

export type ActorWithOrganization = Actor & {
  organization: NonNullable<Actor["organization"]>;
  organizationStatus: "ready";
};

export type HeaderSource = {
  headers: IncomingHttpHeaders;
};

@Injectable()
export class ActorService {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async requireActor(request: HeaderSource): Promise<Actor> {
    const actor = await this.resolve(request);
    if (!actor) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", "Sign in to continue.");
    }
    return actor;
  }

  // Authenticated product routes. Onboarding and auth stay on requireActor.
  async requireCurrentOrganization(request: HeaderSource): Promise<ActorWithOrganization> {
    const actor = await this.requireActor(request);
    this.ensureCurrentOrganization(actor);
    return actor;
  }

  ensureCurrentOrganization(actor: Actor): asserts actor is ActorWithOrganization {
    if (actor.organizationStatus === "ready" && actor.organization) {
      return;
    }
    if (actor.organizationStatus === "selection-required") {
      throw new ApiErrorException(409, "ORGANIZATION_SELECTION_REQUIRED", ORGANIZATION_SELECTION_REQUIRED_MESSAGE);
    }
    throw new ApiErrorException(403, "ORGANIZATION_SETUP_REQUIRED", ORGANIZATION_SETUP_REQUIRED_MESSAGE);
  }

  async resolve(request: HeaderSource): Promise<Actor | null> {
    const presented = presentedCredential(request.headers);
    if (presented.present) {
      if (!presented.key) {
        return null;
      }
      return this.fromApiKey(presented.key);
    }
    return this.fromSession(request);
  }

  hasCredentialHeader(request: HeaderSource): boolean {
    return authorizationHeader(request.headers) !== undefined || request.headers["x-api-key"] !== undefined;
  }

  private async fromSession(request: HeaderSource): Promise<Actor | null> {
    const session = await this.auth.api().getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session?.user) {
      return null;
    }
    const resolved = await resolveCurrentOrganization(
      this.prisma,
      session.user.id,
      readActiveOrganizationId(session.session),
    );
    return {
      user: { id: session.user.id, name: session.user.name },
      organization: resolved.status === "ready" ? resolved.organization : null,
      organizationStatus: resolved.status,
      via: "session",
      sessionId: readSessionId(session.session),
    };
  }

  private async fromApiKey(secret: string): Promise<Actor | null> {
    const result = await this.auth.api().verifyApiKey({ body: { key: secret } });
    if (!result.valid || !result.key) {
      return null;
    }
    const organizationId = result.key.referenceId;
    const createdByUserId = createdByUserIdFrom(result.key.metadata);
    if (!organizationId || !createdByUserId || !result.key.id) {
      return null;
    }
    // A recorded membership id is the one captured at creation or at the first
    // use of a rollout key. A new row after the creator leaves and joins again
    // does not match, and this path does not replace a stored id.
    const createdByMemberId = createdByMemberIdFrom(result.key.metadata)
      ?? await this.bindMissingMembership(result.key.id, createdByUserId, organizationId);
    if (!createdByMemberId) {
      return null;
    }
    const membership = await this.prisma.member.findFirst({
      where: { id: createdByMemberId, userId: createdByUserId, organizationId },
      select: {
        user: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
      },
    });
    if (!membership) {
      return null;
    }
    return {
      user: { id: membership.user.id, name: membership.user.name },
      organization: membership.organization,
      organizationStatus: "ready",
      via: "api-key",
      sessionId: null,
    };
  }

  // Keys created by the previous process after the migration lock have
  // createdByUserId and no membership id. Bind the creator's single current
  // membership in the key's organization, and only while the stored id is
  // absent. The apikey row lock makes the check and the write one step.
  private async bindMissingMembership(
    keyId: string,
    createdByUserId: string,
    organizationId: string,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ metadata: string | null; key_digest: string; enabled: boolean | null }>>`
        SELECT metadata, "key" AS key_digest, enabled
        FROM apikey
        WHERE id = ${keyId}
        FOR UPDATE
      `;
      const row = locked[0];
      if (!row || row.enabled === false || row.key_digest.startsWith("invalidated:")) {
        return null;
      }
      const existing = createdByMemberIdFrom(row.metadata);
      if (existing) {
        return existing;
      }
      if (createdByUserIdFrom(row.metadata) !== createdByUserId) {
        return null;
      }
      const members = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM member
        WHERE "userId" = ${createdByUserId}
          AND "organizationId" = ${organizationId}
        FOR SHARE
      `;
      if (members.length !== 1) {
        return null;
      }
      const memberId = members[0]?.id;
      if (!memberId) {
        return null;
      }
      await tx.$executeRaw`
        UPDATE apikey
        SET metadata = ${JSON.stringify({ createdByUserId, createdByMemberId: memberId })},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${keyId}
      `;
      return memberId;
    });
  }
}

function presentedCredential(headers: IncomingHttpHeaders): { present: boolean; key: string | null } {
  if (authorizationHeader(headers) !== undefined) {
    return { present: true, key: bearerToken(headers) };
  }
  return { present: false, key: null };
}

function authorizationHeader(headers: IncomingHttpHeaders): string | undefined {
  const value = headers.authorization ?? headers.Authorization;
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function bearerToken(headers: IncomingHttpHeaders): string | null {
  const header = authorizationHeader(headers);
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token || token.length > 512) {
    return null;
  }
  return token;
}

function readSessionId(session: unknown): string | null {
  if (typeof session !== "object" || session === null || !("id" in session)) {
    return null;
  }
  const value = session.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readActiveOrganizationId(session: unknown): string | null {
  if (typeof session !== "object" || session === null || !("activeOrganizationId" in session)) {
    return null;
  }
  const value = session.activeOrganizationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}
