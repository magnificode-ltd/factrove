import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { ArtifactsRepository } from "./repositories/artifacts.repository.js";

@Global()
@Module({
  providers: [PrismaService, ArtifactsRepository],
  exports: [PrismaService, ArtifactsRepository],
})
export class DatabaseModule {}
