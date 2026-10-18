import { Module } from "@nestjs/common";
import { ApiModule } from "./controllers/api.module.js";
import { DatabaseModule } from "./database/database.module.js";

@Module({
  imports: [DatabaseModule, ApiModule],
})
export class AppModule {}
