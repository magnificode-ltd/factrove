import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { ArtifactsRepository } from "./repositories/artifacts.repository.js";
import { OrganizationsRepository } from "./repositories/organizations.repository.js";

@Global()
@Module({
  providers: [PrismaService, ArtifactsRepository, OrganizationsRepository],
  exports: [PrismaService, ArtifactsRepository, OrganizationsRepository],
})
export class DatabaseModule {}
