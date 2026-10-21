import { Injectable } from "@nestjs/common";
import { CliError } from "./cli-error.js";
import { DEFAULT_API_URL, apiKeyForInvocation, parseCliArgs, type CliInvocation } from "./parse-args.js";

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
    if (invocation.kind === "configure") {
      return invocation.suggestedApiUrl;
    }
    return invocation.apiUrl;
  }

  requireApiKey(): string {
    const key = apiKeyForInvocation(this.load());
    if (!key) {
      throw new CliError("INVALID_INPUT", "An API key is required. Run: factrove configure");
    }
    return key;
  }
}
