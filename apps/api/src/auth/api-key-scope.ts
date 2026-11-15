import type { PrismaClient } from "@prisma/client";
import { APIError } from "better-auth/api";

export const API_KEY_NOT_FOUND_MESSAGE = "API Key not found";

type JsonRecord = Record<string, unknown>;

export type ApiKeyRequestContext = {
  path?: string;
  body?: unknown;
  query?: unknown;
};

export type ScopedApiKeyRequest = {
  body?: unknown;
  query?: unknown;
};

// Create and list ignore an organization id from the client. The active
// organization is the scope. Delete, get, and update of a key outside that
// organization are the same 404 as a missing key.
export async function scopeOrganizationApiKeyRequest(
  ctx: ApiKeyRequestContext,
  input: { prisma: PrismaClient; userId: string; organizationId: string },
): Promise<ScopedApiKeyRequest | undefined> {
  const action = apiKeyAction(ctx.path);
  if (action === "create") {
    return { body: scopedCreateBody(ctx.body, input.userId, input.organizationId) };
  }
  if (action === "list") {
    return { query: scopedListQuery(ctx.query, input.organizationId) };
  }
  if (action === "delete" || action === "get" || action === "update") {
    await rejectKeyOutsideOrganization(ctx, input.prisma, input.organizationId, action);
  }
  return undefined;
}

export function createdByUserIdFrom(metadata: unknown): string | null {
  const parsed = parseMetadata(metadata);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const value = parsed.createdByUserId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function scopedCreateBody(body: unknown, userId: string, organizationId: string): JsonRecord {
  const next = isRecord(body) ? body : {};
  delete next.userId;
  next.organizationId = organizationId;
  next.metadata = { createdByUserId: userId };
  return next;
}

function scopedListQuery(query: unknown, organizationId: string): JsonRecord {
  const next = isRecord(query) ? query : {};
  next.organizationId = organizationId;
  return next;
}

async function rejectKeyOutsideOrganization(
  ctx: ApiKeyRequestContext,
  prisma: PrismaClient,
  organizationId: string,
  action: "delete" | "get" | "update",
): Promise<void> {
  const keyId = action === "get" ? readQueryId(ctx.query) : readBodyKeyId(ctx.body);
  if (!keyId || !canReadApiKeys(prisma)) {
    return;
  }
  const row = await prisma.apikey.findUnique({
    where: { id: keyId },
    select: { referenceId: true },
  });
  if (!row || row.referenceId !== organizationId) {
    throw new APIError("NOT_FOUND", {
      message: API_KEY_NOT_FOUND_MESSAGE,
      code: "KEY_NOT_FOUND",
    });
  }
}

function apiKeyAction(path: string | undefined): "create" | "list" | "delete" | "get" | "update" | null {
  const normalized = path?.split("?")[0] ?? "";
  if (normalized.endsWith("/api-key/create")) {
    return "create";
  }
  if (normalized.endsWith("/api-key/list")) {
    return "list";
  }
  if (normalized.endsWith("/api-key/delete")) {
    return "delete";
  }
  if (normalized.endsWith("/api-key/get")) {
    return "get";
  }
  if (normalized.endsWith("/api-key/update")) {
    return "update";
  }
  return null;
}

function readBodyKeyId(body: unknown): string | null {
  if (!isRecord(body)) {
    return null;
  }
  const value = body.keyId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readQueryId(query: unknown): string | null {
  if (!isRecord(query)) {
    return null;
  }
  const value = query.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function canReadApiKeys(prisma: PrismaClient): boolean {
  const apikey = prisma.apikey as { findUnique?: unknown } | undefined;
  return typeof apikey?.findUnique === "function";
}

function parseMetadata(metadata: unknown): JsonRecord | null {
  if (typeof metadata === "string") {
    try {
      return parseMetadata(JSON.parse(metadata) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)) {
    return metadata as JsonRecord;
  }
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
