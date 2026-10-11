import { Global, Module } from "@nestjs/common";
import { ArtifactsRepository } from "./artifacts.repository.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService, ArtifactsRepository],
  exports: [PrismaService, ArtifactsRepository],
})
export class DatabaseModule {}
