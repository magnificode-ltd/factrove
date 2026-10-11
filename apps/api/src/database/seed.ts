import { PrismaClient } from "@prisma/client";
import { seedLocalIdentities } from "./seed-local-identities.js";

const prisma = new PrismaClient();

try {
  await seedLocalIdentities(prisma);
} finally {
  await prisma.$disconnect();
}
