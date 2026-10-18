import { Injectable } from "@nestjs/common";
import { DEFAULT_API_URL, parseCliArgs, type CliInvocation } from "./parse-args.js";

@Injectable()
export class CliConfigService {
  private invocation: CliInvocation | undefined;

  load(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): CliInvocation {
    this.invocation ??= parseCliArgs(argv, env);
    return this.invocation;
  }

  apiUrl(): string {
    const invocation = this.load();
    if (invocation.kind === "help") {
      return DEFAULT_API_URL;
    }
    return invocation.apiUrl;
  }
}
