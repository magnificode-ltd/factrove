import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const webDir = dirname(fileURLToPath(import.meta.url));

export function defaultAppEnvFile() {
  return join(webDir, "../api/.env");
}

// Copies NEXT_PUBLIC_API_URL when the process value is blank. Other names stay out of the client bundle.
export function applyNextPublicApiUrl(env, filePath = defaultAppEnvFile()) {
  if (env.NEXT_PUBLIC_API_URL?.trim()) {
    return;
  }
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  const value = parseEnv(text).NEXT_PUBLIC_API_URL?.trim() ?? "";
  if (value.length > 0) {
    env.NEXT_PUBLIC_API_URL = value;
  }
}
