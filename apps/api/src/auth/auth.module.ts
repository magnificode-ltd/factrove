import { Module } from "@nestjs/common";
import { ActorService } from "./actor.service.js";
import { AuthService } from "./auth.service.js";

@Module({
  providers: [AuthService, ActorService],
  exports: [AuthService, ActorService],
})
export class AuthModule {}
