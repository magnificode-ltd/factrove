export { DatabaseModule } from "./database.module.js";
export { PrismaService } from "./prisma.service.js";
export { ArtifactsRepository } from "./repositories/artifacts.repository.js";
export { localOrganizationFixture, localUserFixture, seedLocalIdentities } from "./seed/seed-local-identities.js";
export type { ArtifactRecord, CreateArtifactInput, ListArtifactsInput, UpdateArtifactInput } from "./types/artifact-record.js";
