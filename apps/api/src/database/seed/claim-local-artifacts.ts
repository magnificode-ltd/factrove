import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { localUserFixture } from "./seed-local-identities.js";

export class ClaimLocalArtifactsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimLocalArtifactsError";
  }
}

export type ClaimLocalArtifactsResult = {
  userId: string;
  email: string;
  artifactsClaimed: number;
  membershipsAdded: number;
};

export async function claimLocalArtifacts(prisma: PrismaClient, email: string): Promise<ClaimLocalArtifactsResult> {
  const normalized = email.trim();
  if (normalized.length === 0 || !normalized.includes("@")) {
    throw new ClaimLocalArtifactsError(
      "Pass the email of an account that can already sign in: pnpm db:claim-local-artifacts -- --email you@example.com",
    );
  }

  return prisma.$transaction(async (tx) => {
    const matches = await tx.user.findMany({
      where: { email: { equals: normalized, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    if (matches.length === 0) {
      throw new ClaimLocalArtifactsError(
        `No account exists for ${normalized}. Sign up in Factrove, then run this command again.`,
      );
    }
    if (matches.length > 1) {
      throw new ClaimLocalArtifactsError("More than one account matches that email.");
    }
    const user = matches[0];
    if (!user || user.id === localUserFixture.id) {
      throw new ClaimLocalArtifactsError(
        "The seeded local user has no password. Sign up a real account and pass that email.",
      );
    }

    const artifacts = await tx.artifact.findMany({
      where: { creatorUserId: localUserFixture.id },
      select: { organizationId: true },
    });
    const organizationIds = [
      ...new Set(artifacts.flatMap((artifact) => (artifact.organizationId ? [artifact.organizationId] : []))),
    ];

    let membershipsAdded = 0;
    for (const organizationId of organizationIds) {
      const existing = await tx.member.findFirst({
        where: { userId: user.id, organizationId },
        select: { id: true },
      });
      if (existing) {
        continue;
      }
      await tx.member.create({
        data: {
          id: randomUUID(),
          organizationId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
      });
      membershipsAdded += 1;
    }

    const updated = await tx.artifact.updateMany({
      where: { creatorUserId: localUserFixture.id },
      data: { creatorUserId: user.id },
    });

    return {
      userId: user.id,
      email: user.email,
      artifactsClaimed: updated.count,
      membershipsAdded,
    };
  });
}
