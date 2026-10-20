import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = dirname(scriptsDir);
export const composeFile = join(repoRoot, "compose.yaml");
export const apiEnvFile = join(repoRoot, "apps/api/.env");
export const apiEntry = join(repoRoot, "apps/api/dist/main.js");

export const requiredApiSettings = ["DATABASE_URL", "S3_BUCKET", "S3_REGION"];

export const workspaceBuildArgs = ["--filter", "@factrove/api...", "--filter", "@factrove/cli...", "build"];
export const webAppDir = join(repoRoot, "apps/web");
export const webDevBin = join(webAppDir, "node_modules/.bin/next");
export const webDevArgs = ["dev", "--hostname", "127.0.0.1", "--port", "3000"];

export const e2eProjectName = "factrove-e2e";
export const e2ePostgresPort = "5433";
export const e2eGaragePort = "3910";
export const e2eWebPort = "3100";
export const e2eApiPort = "3101";
export const localGarageBucket = "factrove";
export const localGarageRegion = "us-east-1";
export const localGarageAccessKey = "factrove-local";
export const localGarageSecretKey = "factrove-local-secret";

const preservedStorageKeys = new Set(["S3_INTEGRATION"]);

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

export function webLaunchEnv(parent, apiEnv) {
  const env = withoutInfrastructureSecrets(parent);
  if (!env.NEXT_PUBLIC_API_URL?.trim()) {
    const fromFile = apiEnv.NEXT_PUBLIC_API_URL?.trim();
    if (fromFile) {
      env.NEXT_PUBLIC_API_URL = fromFile;
    }
  }
  return env;
}

const cliDevEnvKeys = ["FACTROVE_API_URL", "FACTROVE_PROFILE"];
const optionsWithValues = new Set(["--access", "--api-url", "--api-key", "--format", "--profile"]);

export function cliEnvFilePath(env) {
  const override = env.FACTROVE_CLI_ENV_FILE?.trim() ?? "";
  if (override.length > 0) {
    return override;
  }
  return join(repoRoot, "apps/cli/.env");
}

export function readCliEnvFile(filePath) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { ok: true, values: {} };
    }
    return {
      ok: false,
      message: `Could not read the CLI environment file at ${filePath}.`,
    };
  }
  return { ok: true, values: cliDevEnvValues(parseEnv(text)) };
}

export function cliLaunch(env, launcherCwd, fileValues = {}) {
  const cwd = invocationCwd(env, launcherCwd);
  const childEnv = withoutInfrastructureSecrets(applyCliDevEnv(env, fileValues));
  delete childEnv.INIT_CWD;
  return { cwd, env: childEnv };
}

export function launcherSkipsEnvFile(argv) {
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return true;
    }
    if (optionsWithValues.has(arg)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    positionals.push(arg);
  }
  return positionals[0] === "help";
}

export function launcherWantsJson(argv) {
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      break;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (optionsWithValues.has(arg)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        index += 1;
      }
    }
  }
  return json;
}

export function legacyRootEnvWarning(rootEnvPath) {
  if (!existsSync(rootEnvPath)) {
    return "";
  }
  return "A root .env is no longer read. Application settings belong in apps/api/.env. CLI settings for pnpm factrove belong in apps/cli/.env.\n";
}

function applyCliDevEnv(env, fileValues) {
  const next = { ...env };
  const profile = fileValues.FACTROVE_PROFILE?.trim() ?? "";
  if (profile.length > 0 && !next.FACTROVE_PROFILE?.trim()) {
    next.FACTROVE_PROFILE = profile;
  }
  if (!next.FACTROVE_API_URL?.trim()) {
    const fileUrl = fileValues.FACTROVE_API_URL?.trim() ?? "";
    if (fileUrl.length > 0) {
      next.FACTROVE_DEV_API_URL = fileUrl;
    } else {
      delete next.FACTROVE_DEV_API_URL;
    }
  }
  return next;
}

function cliDevEnvValues(parsed) {
  const values = {};
  for (const key of cliDevEnvKeys) {
    const value = parsed[key]?.trim() ?? "";
    if (value.length > 0) {
      values[key] = value;
    }
  }
  return values;
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
  return composeCommand(composeBase(), action);
}

export function e2eComposeBase() {
  return ["compose", "-p", e2eProjectName, "-f", composeFile, "--project-directory", repoRoot];
}

export function e2eComposeArgs(action) {
  return composeCommand(e2eComposeBase(), action);
}

export function e2eInfraEnv(parent) {
  return {
    ...parent,
    FACTROVE_POSTGRES_PORT: e2ePostgresPort,
    FACTROVE_GARAGE_PORT: e2eGaragePort,
  };
}

export function assertLoopbackHttpEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("The effective S3 endpoint must be an http loopback origin.");
  }
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The effective S3 endpoint must be an http loopback origin.");
  }
  return url.origin;
}

export function prepareLocalGarageEnv(env, options = {}) {
  const endpoint = assertLoopbackHttpEndpoint(`http://127.0.0.1:${garagePort(env, options)}`);
  for (const key of Object.keys(env)) {
    if (isStorageOverride(key)) {
      delete env[key];
    }
  }
  env.S3_BUCKET = localGarageBucket;
  env.S3_REGION = localGarageRegion;
  env.S3_ENDPOINT = endpoint;
  env.S3_FORCE_PATH_STYLE = "true";
  env.AWS_ACCESS_KEY_ID = localGarageAccessKey;
  env.AWS_SECRET_ACCESS_KEY = localGarageSecretKey;
  return endpoint;
}

export function localGarageEnv(parent, options = {}) {
  const env = { ...parent };
  prepareLocalGarageEnv(env, options);
  return env;
}

function composeBase() {
  return ["compose", "-f", composeFile, "--project-directory", repoRoot];
}

function composeCommand(base, action) {
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

function garagePort(env, options) {
  const requested = options.garagePort?.trim() || env.FACTROVE_GARAGE_PORT?.trim() || "3900";
  if (!/^[0-9]+$/.test(requested)) {
    throw new Error("Garage port must be an integer from 1 to 65535.");
  }
  const port = Number(requested);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Garage port must be an integer from 1 to 65535.");
  }
  return String(port);
}

function isStorageOverride(key) {
  if (preservedStorageKeys.has(key)) {
    return false;
  }
  return key.startsWith("AWS_") || key.startsWith("S3_");
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
    if (text.includes("3900")) {
      return "127.0.0.1:3900 is already in use. Stop the other process, or change the Garage host port in compose.yaml and S3_ENDPOINT together.";
    }
    if (text.includes("5433")) {
      return "127.0.0.1:5433 is already in use. Stop the other PostgreSQL process. pnpm e2e publishes its database on that port.";
    }
    if (text.includes("5432")) {
      return "127.0.0.1:5432 is already in use. Stop the other PostgreSQL process, or change the host port in compose.yaml and DATABASE_URL together.";
    }
    if (text.includes("3910")) {
      return "127.0.0.1:3910 is already in use. Stop the other process. pnpm e2e publishes Garage on that port.";
    }
    return "A host port in compose.yaml is already in use. Stop the other process, or change that port and the matching API setting together.";
  }
  if (text.includes("pull access denied") || text.includes("manifest unknown") || text.includes("failed to resolve reference")) {
    return "Could not pull a pinned container image. Check that this machine can reach Docker Hub.";
  }
  return "";
}

export function resetDecision(args, isTTY) {
  if (args.includes("--yes")) {
    return "run";
  }
  if (isTTY) {
    return "prompt";
  }
  return "refuse";
}

export function snapshotFile(filePath) {
  try {
    return readFileSync(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function restoreFileSnapshot(filePath, snapshot) {
  if (snapshot === null) {
    return;
  }
  let current = null;
  try {
    current = readFileSync(filePath);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  if (current && current.equals(snapshot)) {
    return;
  }
  writeFileSync(filePath, snapshot);
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
