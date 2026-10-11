import type { PrismaClient } from "@prisma/client";

export const localUserFixture = {
  id: "local-user",
  name: "Local User",
  email: "local@example.invalid",
  emailVerified: false,
} as const;

export const localOrganizationFixture = {
  id: "local-org",
  name: "Local Organization",
  slug: "local",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
} as const;

export async function seedLocalIdentities(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: localUserFixture.id },
    update: {
      name: localUserFixture.name,
      email: localUserFixture.email,
      emailVerified: localUserFixture.emailVerified,
    },
    create: {
      id: localUserFixture.id,
      name: localUserFixture.name,
      email: localUserFixture.email,
      emailVerified: localUserFixture.emailVerified,
    },
  });

  await prisma.organization.upsert({
    where: { id: localOrganizationFixture.id },
    update: {
      name: localOrganizationFixture.name,
      slug: localOrganizationFixture.slug,
    },
    create: {
      id: localOrganizationFixture.id,
      name: localOrganizationFixture.name,
      slug: localOrganizationFixture.slug,
      createdAt: localOrganizationFixture.createdAt,
    },
  });
}
