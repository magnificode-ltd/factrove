import type { IncomingHttpHeaders } from "node:http";
import { Inject, Injectable } from "@nestjs/common";
import type { ContextEnvelope } from "@factrove/contracts";
import { fromNodeHeaders } from "better-auth/node";
import { PrismaService } from "../database/index.js";
import { ApiErrorException } from "../services/api-error.js";
import { AuthService } from "./auth.service.js";

export type Actor = ContextEnvelope & {
  via: "session" | "api-key";
  // Set for a session cookie. API keys have no session row to lock.
  sessionId: string | null;
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
    const organization = await this.organizationFor(session.user.id, readActiveOrganizationId(session.session));
    return {
      user: { id: session.user.id, name: session.user.name },
      organization,
      via: "session",
      sessionId: readSessionId(session.session),
    };
  }

  private async fromApiKey(secret: string): Promise<Actor | null> {
    const result = await this.auth.api().verifyApiKey({ body: { key: secret } });
    if (!result.valid || !result.key) {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: result.key.referenceId },
      select: { id: true, name: true },
    });
    if (!user) {
      return null;
    }
    const organization = await this.organizationFor(user.id, null);
    return {
      user: { id: user.id, name: user.name },
      organization,
      via: "api-key",
      sessionId: null,
    };
  }

  private async organizationFor(userId: string, activeOrganizationId: string | null): Promise<ContextEnvelope["organization"]> {
    if (activeOrganizationId) {
      const active = await this.prisma.member.findFirst({
        where: { userId, organizationId: activeOrganizationId },
        select: { organization: { select: { id: true, name: true } } },
      });
      if (active) {
        return active.organization;
      }
    }
    const memberships = await this.prisma.member.findMany({
      where: { userId },
      select: { organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    if (memberships.length === 1) {
      return memberships[0]?.organization ?? null;
    }
    return null;
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
