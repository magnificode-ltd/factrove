import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = dirname(scriptsDir);
export const composeFile = join(repoRoot, "compose.yaml");
export const apiEnvFile = join(repoRoot, "apps/api/.env");
export const rootEnvFile = join(repoRoot, ".env");
export const apiEntry = join(repoRoot, "apps/api/dist/main.js");

export const requiredApiSettings = ["DATABASE_URL", "S3_BUCKET", "S3_REGION"];

export const workspaceBuildArgs = ["--filter", "@factrove/api...", "--filter", "@factrove/cli...", "build"];
export const webAppDir = join(repoRoot, "apps/web");
export const webDevBin = join(webAppDir, "node_modules/.bin/next");
export const webDevArgs = ["dev", "--hostname", "127.0.0.1", "--port", "3000"];

const secretKeys = new Set(["DATABASE_URL", "BASE_URL"]);

export function readDotEnv(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
  return parseEnv(text);
}

export function invocationCwd(env, fallbackCwd) {
  const raw = env.INIT_CWD?.trim() ?? "";
  if (raw.length === 0) {
    return fallbackCwd;
  }
  const candidate = isAbsolute(raw) ? raw : resolve(fallbackCwd, raw);
  try {
    if (statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    return fallbackCwd;
  }
  return fallbackCwd;
}

export function withoutInfrastructureSecrets(env) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (secretKeys.has(key) || key.startsWith("AWS_") || key.startsWith("S3_")) {
      delete next[key];
    }
  }
  return next;
}

export function cliLaunch(env, launcherCwd, rootEnv) {
  const cwd = invocationCwd(env, launcherCwd);
  const childEnv = withoutInfrastructureSecrets(env);
  delete childEnv.INIT_CWD;
  if (!childEnv.FACTROVE_API_URL?.trim()) {
    const fromFile = rootEnv.FACTROVE_API_URL?.trim();
    if (fromFile) {
      childEnv.FACTROVE_API_URL = fromFile;
    }
  }
  return { cwd, env: childEnv };
}

export function webLaunchEnv(parent, rootEnv) {
  const env = withoutInfrastructureSecrets(parent);
  if (!env.NEXT_PUBLIC_API_URL?.trim()) {
    const fromFile = rootEnv.NEXT_PUBLIC_API_URL?.trim();
    if (fromFile) {
      env.NEXT_PUBLIC_API_URL = fromFile;
    }
  }
  return env;
}

export function effectiveApiSetting(fileEnv, processEnv, key) {
  const fromProcess = processEnv[key]?.trim() ?? "";
  if (fromProcess.length > 0) {
    return fromProcess;
  }
  return fileEnv[key]?.trim() ?? "";
}

export function missingApiSettings(fileEnv, processEnv) {
  return requiredApiSettings.filter((key) => effectiveApiSetting(fileEnv, processEnv, key).length === 0);
}

export function composeArgs(action) {
  const base = ["compose", "-f", composeFile, "--project-directory", repoRoot];
  if (action === "up") {
    return [...base, "up", "-d", "--wait", "--wait-timeout", "120"];
  }
  if (action === "down") {
    return [...base, "down", "--remove-orphans"];
  }
  if (action === "reset") {
    return [...base, "down", "--remove-orphans", "--volumes"];
  }
  throw new Error(`Unknown infra action: ${action}`);
}

export function infraFailureHint(stderr) {
  const text = stderr.toLowerCase();
  if (
    text.includes("cannot connect to the docker daemon") ||
    text.includes("is the docker daemon running") ||
    text.includes("error during connect")
  ) {
    return "The container runtime is not running. Start Docker Desktop, then run pnpm infra:up again.";
  }
  if (text.includes("address already in use") || text.includes("port is already allocated")) {
    return "127.0.0.1:5432 is already in use. Stop the other PostgreSQL process, or change the host port in compose.yaml and DATABASE_URL together.";
  }
  if (text.includes("pull access denied") || text.includes("manifest unknown") || text.includes("failed to resolve reference")) {
    return "Could not pull the pinned Postgres image. Check that this machine can reach Docker Hub.";
  }
  return "";
}

export function signalProcessGroup(child, signal) {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already exited.
    }
  }
}
