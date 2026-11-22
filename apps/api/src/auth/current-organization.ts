import type { PrismaClient } from "@prisma/client";

export const ORGANIZATION_SETUP_REQUIRED_MESSAGE = "Create an organization to continue.";
export const ORGANIZATION_SELECTION_REQUIRED_MESSAGE = "Choose an organization to continue.";

export type OrganizationIdentity = {
  id: string;
  name: string;
};

export type ResolvedOrganization =
  | { status: "ready"; organization: OrganizationIdentity }
  | { status: "setup-required" }
  | { status: "selection-required" };

// One membership is current when the session has no usable active organization.
// Several memberships are not. The oldest row is not a tie-break.
export async function resolveCurrentOrganization(
  prisma: PrismaClient,
  userId: string,
  activeOrganizationId: string | null,
): Promise<ResolvedOrganization> {
  if (activeOrganizationId) {
    const active = await prisma.member.findFirst({
      where: { userId, organizationId: activeOrganizationId },
      select: { organization: { select: { id: true, name: true } } },
    });
    if (active) {
      return { status: "ready", organization: active.organization };
    }
  }
  const memberships = await prisma.member.findMany({
    where: { userId },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (memberships.length === 0) {
    return { status: "setup-required" };
  }
  const only = memberships.length === 1 ? memberships[0]?.organization : undefined;
  if (only) {
    return { status: "ready", organization: only };
  }
  return { status: "selection-required" };
}
