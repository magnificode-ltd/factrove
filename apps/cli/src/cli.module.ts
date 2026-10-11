import { Module } from "@nestjs/common";
import { createFactroveClient } from "@factrove/api-client";

export const FACTROVE_CLIENT = Symbol("FACTROVE_CLIENT");

@Module({
  providers: [{
    provide: FACTROVE_CLIENT,
    useFactory: () => createFactroveClient({
      baseUrl: process.env.FACTROVE_API_URL ?? "http://localhost:3001"
    })
  }],
  exports: [FACTROVE_CLIENT]
})
export class CliModule {}
