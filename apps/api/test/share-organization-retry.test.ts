import { describe, expect, it } from "vitest";
import { ArtifactsRepository } from "../src/database/repositories/artifacts.repository.js";
import type { PrismaService } from "../src/database/prisma.service.js";

const input = {
  id: "11111111-1111-4111-8111-111111111111",
  creatorUserId: "user-1",
  organizationId: "org-1",
  sessionId: "session-1",
};

// organization-changed is the repository outcome ArtifactsService maps to 409 ORGANIZATION_CHANGED.
// A transaction that throws did not commit, so these cases do not write.

const savedRecord = {
  id: input.id,
  creatorUserId: input.creatorUserId,
  organizationId: input.organizationId,
  accessType: "org_shared" as const,
  name: null,
  mimeType: "text/html",
  sizeBytes: 1,
  objectKey: `${input.id}.html`,
  contentRevision: 0,
  createdAt: new Date("2026-10-22T00:00:00.000Z"),
  updatedAt: new Date("2026-10-22T00:00:00.000Z"),
  uploadedAt: null,
  shareToken: null,
  shareTokenHash: null,
  sharePasswordHash: null,
};

describe("shareWithOrganization retry", () => {
  const sqlStates = ["40P01", "40001", "55P03", "57014"] as const;

  it.each(sqlStates)("retries structured SQLSTATE %s from meta.code with a neutral message", async (sqlState) => {
    await expectTwoFailures(structuredSqlState(sqlState));
  });

  it.each([
    ["40P01", "deadlock detected"],
    ["40001", "could not serialize access due to concurrent update"],
    ["55P03", "canceling statement due to lock timeout"],
    ["57014", "canceling statement due to statement timeout"],
  ] as const)("retries %s from the message only", async (_sqlState, message) => {
    await expectTwoFailures(messageOnly(message));
  });

  it.each(sqlStates)("retries SQLSTATE %s wrapped as the error cause", async (sqlState) => {
    await expectTwoFailures(wrapped(structuredSqlState(sqlState)));
  });

  it.each(["P2028", "P2034"] as const)("retries structured Prisma code %s", async (code) => {
    await expectTwoFailures(structuredPrismaCode(code));
  });

  it.each(["P2028", "P2034"] as const)("retries Prisma code %s wrapped as the error cause", async (code) => {
    await expectTwoFailures(wrapped(structuredPrismaCode(code)));
  });

  it("returns the shared row when the second attempt succeeds", async () => {
    let attempts = 0;
    const repository = repositoryFrom(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw structuredSqlState("40P01");
      }
      return { outcome: "shared" as const, record: savedRecord };
    });

    await expect(repository.shareWithOrganization(input)).resolves.toEqual({
      outcome: "shared",
      record: savedRecord,
    });
    expect(attempts).toBe(2);
  });

  it("returns the saved row when the second attempt finds the artifact already shared", async () => {
    let attempts = 0;
    const repository = repositoryFrom(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw messageOnly("deadlock detected");
      }
      return { outcome: "already" as const, record: savedRecord };
    });

    await expect(repository.shareWithOrganization(input)).resolves.toEqual({
      outcome: "already",
      record: savedRecord,
    });
    expect(attempts).toBe(2);
  });

  it("does not retry an unrelated failure", async () => {
    let attempts = 0;
    const repository = new ArtifactsRepository({
      $transaction: async () => {
        attempts += 1;
        throw new Error("connection reset");
      },
    } as unknown as PrismaService);

    await expect(repository.shareWithOrganization(input)).rejects.toThrow("connection reset");
    expect(attempts).toBe(1);
  });

  it("does not retry a creator foreign-key violation", async () => {
    let attempts = 0;
    const repository = new ArtifactsRepository({
      $transaction: async () => {
        attempts += 1;
        throw foreignKeyError("artifact_creator_user_id_fkey");
      },
    } as unknown as PrismaService);

    await expect(repository.shareWithOrganization(input)).rejects.toThrow(/artifact_creator_user_id_fkey/);
    expect(attempts).toBe(1);
  });

  it("retries an artifact organization foreign-key violation once and classifies the fresh outcome", async () => {
    let attempts = 0;
    let writes = 0;
    const repository = new ArtifactsRepository({
      $transaction: async (fn: (tx: ReturnType<typeof classifyTx>) => Promise<unknown>) => {
        attempts += 1;
        if (attempts <= 2) {
          throw foreignKeyError("artifact_organization_id_fkey");
        }
        return fn(classifyTx([{ id: input.sessionId }], () => {
          writes += 1;
        }));
      },
    } as unknown as PrismaService);

    await expect(repository.shareWithOrganization(input)).resolves.toEqual({ outcome: "organization-changed" });
    expect(attempts).toBe(3);
    expect(writes).toBe(0);
  });

  it("returns the fresh unauthenticated outcome when the session is gone after the organization foreign key fails", async () => {
    let attempts = 0;
    const repository = new ArtifactsRepository({
      $transaction: async (fn: (tx: ReturnType<typeof classifyTx>) => Promise<unknown>) => {
        attempts += 1;
        if (attempts <= 2) {
          throw foreignKeyError("artifact_organization_id_fkey");
        }
        return fn(classifyTx([]));
      },
    } as unknown as PrismaService);

    await expect(repository.shareWithOrganization(input)).resolves.toEqual({ outcome: "unauthenticated" });
    expect(attempts).toBe(3);
  });
});

function repositoryFrom(run: () => Promise<unknown>): ArtifactsRepository {
  return new ArtifactsRepository({ $transaction: run } as unknown as PrismaService);
}

async function expectTwoFailures(error: Error): Promise<void> {
  let attempts = 0;
  const repository = repositoryFrom(async () => {
    attempts += 1;
    throw error;
  });
  await expect(repository.shareWithOrganization(input)).resolves.toEqual({ outcome: "organization-changed" });
  expect(attempts).toBe(2);
}

// The message stays neutral so a match can only come from meta.code.
function structuredSqlState(sqlState: string): Error {
  return Object.assign(new Error("persistence conflict"), {
    code: "P2010",
    meta: { code: sqlState, message: "persistence conflict" },
  });
}

// No meta.code, so a match can only come from the message.
function messageOnly(message: string): Error {
  return Object.assign(new Error(message), { code: "P2010" });
}

// The message does not contain the Prisma code, so a match can only come from error.code.
function structuredPrismaCode(code: string): Error {
  return Object.assign(new Error("transaction could not finish"), { code });
}

function wrapped(cause: Error): Error {
  return Object.assign(new Error("transaction failed"), { cause });
}

function foreignKeyError(constraint: string): Error {
  const message = `update or update on table "artifact" violates foreign key constraint "${constraint}"`;
  return Object.assign(new Error(`Raw query failed. Code: \`23503\`. Message: \`${message}\``), {
    code: "P2010",
    meta: { code: "23503", message },
  });
}

function classifyTx(sessions: Array<{ id: string }>, onWrite?: () => void) {
  return {
    artifact: {
      findUnique: async () => ({
        id: input.id,
        creatorUserId: input.creatorUserId,
        accessType: "private" as const,
      }),
    },
    $executeRaw: async () => {
      onWrite?.();
      throw new Error("classification must not write");
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = Array.from(strings).join(" ");
      if (sql.includes("set_config") || sql.includes("FOR UPDATE")) {
        return [];
      }
      if (sql.includes("activeOrganizationId")) {
        return [{ activeOrganizationId: input.organizationId }];
      }
      if (sql.includes('FROM "session"')) {
        return sessions;
      }
      if (sql.includes('FROM "user"')) {
        return [{ id: input.creatorUserId }];
      }
      if (sql.includes('FROM "member"')) {
        return [{ organizationId: input.organizationId }];
      }
      return [];
    },
  };
}
