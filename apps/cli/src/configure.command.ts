import { createInterface } from "node:readline/promises";
import { CliConfigService } from "./cli-config.service.js";
import { CliError } from "./cli-error.js";
import { saveProfile } from "./credentials.js";
import { promptSecret, readAllStdin } from "./secret-input.js";
import { Inject, Injectable } from "@nestjs/common";

@Injectable()
export class ConfigureCommand {
  constructor(@Inject(CliConfigService) private readonly config: CliConfigService) {}

  async execute(): Promise<void> {
    const invocation = this.config.load();
    if (invocation.kind !== "configure") {
      throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
    }
    const answers = await readAnswers(invocation.apiKey, invocation.apiUrl, invocation.suggestedApiUrl);
    const apiKey = answers.apiKey;
    if (apiKey.length === 0) {
      throw new CliError("INVALID_INPUT", "An API key is required.");
    }
    const apiUrl = answers.apiUrl || invocation.suggestedApiUrl;
    assertHttpUrl(apiUrl);
    await saveProfile({
      profile: invocation.profile,
      env: process.env,
      apiKey,
      apiUrl,
    });
    process.stdout.write(`Configured profile "${invocation.profile}" for ${apiUrl}.\n`);
  }
}

function assertHttpUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("INVALID_INPUT", "API URL must be an absolute HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("INVALID_INPUT", "API URL must be an absolute HTTP or HTTPS URL.");
  }
}

async function readAnswers(
  apiKeyFlag: string | undefined,
  apiUrlFlag: string | undefined,
  suggestedApiUrl: string,
): Promise<{ apiKey: string; apiUrl: string }> {
  if (apiKeyFlag !== undefined && apiUrlFlag !== undefined) {
    return { apiKey: apiKeyFlag, apiUrl: apiUrlFlag };
  }
  if (!process.stdin.isTTY) {
    const text = await readAllStdin();
    const lines = text.split(/\r?\n/);
    return {
      apiKey: apiKeyFlag ?? (lines[0] ?? "").trim(),
      apiUrl: apiUrlFlag ?? (lines[1] ?? "").trim(),
    };
  }
  const apiKey = apiKeyFlag ?? (await promptSecret("Factrove API key: ", "Configure cancelled.")).trim();
  const typedUrl = apiUrlFlag ?? (await promptLine(`Factrove API URL [${suggestedApiUrl}]: `));
  return { apiKey, apiUrl: typedUrl };
}

async function promptLine(prompt: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await reader.question(prompt);
    return answer.trim();
  } finally {
    reader.close();
  }
}
