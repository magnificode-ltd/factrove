import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/index.js";
import { API_CONFIG, type ApiConfig } from "../services/api-config.js";
import { browserOrigins } from "../sharing/public-origin.js";
import { createAuth, type FactroveAuth } from "./create-auth.js";

@Injectable()
export class AuthService implements OnModuleInit {
  private factroveAuth: FactroveAuth | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  onModuleInit(): void {
    this.factroveAuth = createAuth({
      prisma: this.prisma,
      baseURL: this.config.apiPublicOrigin,
      secret: this.config.authSecret,
      trustedOrigins: [...new Set([...browserOrigins(this.config.webOrigin, this.config.publicBaseUrl), this.config.apiPublicOrigin])],
      cookieDomain: this.config.authCookieDomain,
    });
  }

  handler(): FactroveAuth["handler"] {
    return this.auth().handler;
  }

  api(): FactroveAuth["api"] {
    return this.auth().api;
  }

  private auth(): FactroveAuth {
    if (!this.factroveAuth) {
      throw new Error("Auth is not initialized");
    }
    return this.factroveAuth;
  }
}
