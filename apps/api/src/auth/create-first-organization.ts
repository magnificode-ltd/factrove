import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  CREATE_ORGANIZATION_REQUEST_MESSAGE,
  ORGANIZATION_NAME_MESSAGE,
  normalizeOrganizationName,
  type CreateOrganizationResponse,
} from "@factrove/contracts";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/index.js";
import { ApiErrorException } from "../services/api-error.js";
import { readAssignedClientIp } from "./client-ip.js";
import { ActorService, type HeaderSource } from "./actor.service.js";
import { organizationSlugCandidates } from "./organization-slug.js";

type JsonRequest = HeaderSource & {
  body?: unknown;
};

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

@Injectable()
export class CreateFirstOrganizationService {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    @Inject(ActorService) private readonly actors: ActorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async create(request: JsonRequest, readBody: () => unknown, now = Date.now()): Promise<CreateOrganizationResponse> {
    this.limit(request, now);
    const actor = await this.actors.requireActor(request);
    const sessionId = actor.sessionId;
    if (actor.via !== "session" || sessionId === null) {
      throw new ApiErrorException(401, "UNAUTHENTICATED", "Creating an organization requires a browser session.");
    }
    const name = readOrganizationName(readBody());
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${actor.user.id} FOR UPDATE`;
      const memberships = await tx.member.count({ where: { userId: actor.user.id } });
      if (memberships > 0) {
        throw new ApiErrorException(409, "ORGANIZATION_EXISTS", "You already belong to an organization.");
      }
      const organization = await insertOrganization(tx, name);
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          userId: actor.user.id,
          role: "owner",
          createdAt: new Date(),
        },
      });
      const updated = await tx.session.updateMany({
        where: { id: sessionId, userId: actor.user.id },
        data: { activeOrganizationId: organization.id },
      });
      if (updated.count !== 1) {
        throw new ApiErrorException(401, "UNAUTHENTICATED", "Sign in to continue.");
      }
      return organization;
    });
    return { organization: { id: created.id, name: created.name } };
  }

  private limit(request: HeaderSource, now: number): void {
    // configureHttpApp assigns this header from the socket and drops a caller-supplied value.
    const key = readAssignedClientIp(request.headers) ?? "unknown";
    const recent = (this.attempts.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      const oldest = recent[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
      this.attempts.set(key, recent);
      throw new ApiErrorException(429, "RATE_LIMITED", "Too many organization creates. Try again later.", retryAfterSeconds);
    }
    recent.push(now);
    this.attempts.set(key, recent);
  }
}

async function insertOrganization(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<{ id: string; name: string }> {
  const candidates = organizationSlugCandidates(name, () => randomBytes(3).toString("hex"));
  for (const slug of candidates) {
    await tx.$executeRaw`SAVEPOINT organization_slug`;
    try {
      const created = await tx.organization.create({
        data: {
          id: randomUUID(),
          name,
          slug,
          createdAt: new Date(),
        },
        select: { id: true, name: true },
      });
      await tx.$executeRaw`RELEASE SAVEPOINT organization_slug`;
      return created;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT organization_slug`;
      if (!isSlugConflict(error)) {
        throw error;
      }
    }
  }
  throw new ApiErrorException(500, "INTERNAL_ERROR", "The organization could not be created.");
}

function isSlugConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function readOrganizationName(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiErrorException(400, "INVALID_REQUEST", "The request is invalid.");
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "name" || typeof record.name !== "string") {
    throw new ApiErrorException(400, "INVALID_REQUEST", CREATE_ORGANIZATION_REQUEST_MESSAGE);
  }
  const name = normalizeOrganizationName(record.name);
  if (name === null) {
    throw new ApiErrorException(400, "INVALID_REQUEST", ORGANIZATION_NAME_MESSAGE);
  }
  return name;
}
