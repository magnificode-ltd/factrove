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
    const credential = await tx.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    });
    if (!credential?.password) {
      throw new ClaimLocalArtifactsError(
        "That account cannot sign in. Sign up with email and password, then run this command again.",
      );
    }

    const memberships = await tx.member.findMany({
      where: { userId: user.id },
      select: { organizationId: true },
      take: 2,
    });
    const organizationId = memberships.length === 1 ? memberships[0]?.organizationId : undefined;
    if (!organizationId) {
      throw new ClaimLocalArtifactsError("That account must belong to exactly one organization.");
    }

    const pending = await tx.artifact.count({
      where: { creatorUserId: localUserFixture.id },
    });
    if (pending === 0) {
      return {
        userId: user.id,
        email: user.email,
        artifactsClaimed: 0,
        membershipsAdded: 0,
      };
    }

    const updated = await tx.artifact.updateMany({
      where: { creatorUserId: localUserFixture.id },
      data: { creatorUserId: user.id, organizationId },
    });

    return {
      userId: user.id,
      email: user.email,
      artifactsClaimed: updated.count,
      membershipsAdded: 0,
    };
  });
}
