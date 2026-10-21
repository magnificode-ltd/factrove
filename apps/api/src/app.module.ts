import { Module, type MiddlewareConsumer, type NestModule, type OnModuleInit } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { BetterAuthMiddleware } from "./auth/auth.middleware.js";
import { ApiModule } from "./controllers/api.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { ConfigModule } from "./services/config.module.js";
import { assertSharePasswordSupport } from "./sharing/share-password.js";

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, ApiModule],
})
export class AppModule implements NestModule, OnModuleInit {
  onModuleInit(): void {
    assertSharePasswordSupport();
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(BetterAuthMiddleware).forRoutes("{*path}");
  }
}
