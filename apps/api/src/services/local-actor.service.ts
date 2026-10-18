import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { ContextEnvelope } from "@factrove/contracts";
import { PrismaService } from "../database/index.js";
import { API_CONFIG, type ApiConfig } from "./api-config.js";

@Injectable()
export class LocalActorService implements OnModuleInit {
  private actor: ContextEnvelope | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: this.config.localUserId },
      select: { id: true, name: true },
    });
    if (!user) {
      throw new Error(
        `LOCAL_USER_ID "${this.config.localUserId}" does not match a user row. Seed the local identities before starting the API.`,
      );
    }

    let organization: ContextEnvelope["organization"] = null;
    if (this.config.localOrganizationId !== null) {
      const row = await this.prisma.organization.findUnique({
        where: { id: this.config.localOrganizationId },
        select: { id: true, name: true },
      });
      if (!row) {
        throw new Error(
          `LOCAL_ORGANIZATION_ID "${this.config.localOrganizationId}" does not match an organization row. Seed the local identities before starting the API.`,
        );
      }
      organization = { id: row.id, name: row.name };
    }

    this.actor = {
      user: { id: user.id, name: user.name },
      organization,
    };
  }

  current(): ContextEnvelope {
    if (!this.actor) {
      throw new Error("Local actor is not initialized");
    }
    return this.actor;
  }
}
