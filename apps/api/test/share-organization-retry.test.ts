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

describe("shareWithOrganization retry", () => {
  const cases = [
    ["40P01", sqlStateError("40P01")],
    ["40001", sqlStateError("40001")],
    ["55P03", sqlStateError("55P03")],
    ["57014", sqlStateError("57014")],
    ["P2028", prismaCodeError("P2028")],
    ["P2034", prismaCodeError("P2034")],
  ] as const;

  it.each(cases)("retries %s once and then returns organization-changed with no write", async (_code, error) => {
    let attempts = 0;
    const repository = new ArtifactsRepository({
      $transaction: async () => {
        attempts += 1;
        throw error;
      },
    } as unknown as PrismaService);

    await expect(repository.shareWithOrganization(input)).resolves.toEqual({ outcome: "organization-changed" });
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

function sqlStateError(sqlState: string): Error {
  const error = new Error(
    `Raw query failed. Code: \`${sqlState}\`. Message: \`canceling statement due to lock timeout\``,
  );
  return Object.assign(error, {
    code: "P2010",
    meta: { code: sqlState, message: "canceling statement due to lock timeout" },
  });
}

function prismaCodeError(code: string): Error {
  return Object.assign(new Error(`Transaction API error: ${code}`), { code });
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
