import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export function cliEnvFilePath(): string {
  return fileURLToPath(new URL("../.env", import.meta.url));
}

// Fills blank FACTROVE_* names from apps/cli/.env. Values already set in the
// environment stay in place, so flags and the process environment still win.
export function loadCliEnv(env: NodeJS.ProcessEnv, filePath = cliEnvFilePath()): void {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
  const parsed = parseEnv(text);
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined || !key.startsWith("FACTROVE_")) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || env[key]?.trim()) {
      continue;
    }
    env[key] = trimmed;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
