import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, readlink, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CliError } from "./cli-error.js";

const KEY_FIELD = "factrove_api_key";
const URL_FIELD = "api_url";

export type StoredProfile = {
  apiKey?: string;
  apiUrl?: string;
};

export function configDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.FACTROVE_CONFIG_DIR?.trim();
  if (configured) {
    return configured;
  }
  return join(homedir(), ".factrove");
}

export function credentialsPath(env: NodeJS.ProcessEnv): string {
  const override = env.FACTROVE_SHARED_CREDENTIALS_FILE?.trim();
  if (override) {
    return override;
  }
  return join(configDirectory(env), "credentials");
}

export function configPath(env: NodeJS.ProcessEnv): string {
  const override = env.FACTROVE_CONFIG_FILE?.trim();
  if (override) {
    return override;
  }
  return join(configDirectory(env), "config");
}

export function selectedProfile(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const name = flag ?? env.FACTROVE_PROFILE?.trim() ?? "default";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) {
    throw new CliError("INVALID_INPUT", "Profile names use letters, numbers, dots, underscores, and hyphens.");
  }
  return name;
}

export function readStoredProfileSync(profile: string, env: NodeJS.ProcessEnv): StoredProfile {
  const credentials = readIniSync(credentialsPath(env));
  const config = readIniSync(configPath(env));
  const apiKey = credentials.get(profile)?.get(KEY_FIELD);
  const apiUrl = readProfileUrl(config, profile);
  return {
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    apiUrl: apiUrl && apiUrl.length > 0 ? apiUrl : undefined,
  };
}

export function resolveApiKey(
  env: NodeJS.ProcessEnv,
  stored: StoredProfile,
  explicitProfile = false,
): string | undefined {
  if (!explicitProfile) {
    const fromEnv = env.FACTROVE_API_KEY?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }
  return stored.apiKey;
}

export async function saveProfile(input: {
  profile: string;
  env: NodeJS.ProcessEnv;
  apiKey?: string;
  apiUrl?: string;
}): Promise<void> {
  if (input.apiKey !== undefined) {
    await writeIniKey(credentialsPath(input.env), input.profile, KEY_FIELD, input.apiKey);
  }
  if (input.apiUrl !== undefined) {
    await writeIniKey(configPath(input.env), configSection(input.profile), URL_FIELD, input.apiUrl);
  }
}

function configSection(profile: string): string {
  return profile === "default" ? "default" : `profile ${profile}`;
}

function readProfileUrl(config: Map<string, Map<string, string>>, profile: string): string | undefined {
  const sections = [config.get(configSection(profile)), config.get(profile)];
  for (const section of sections) {
    const apiUrl = section?.get(URL_FIELD);
    if (apiUrl && apiUrl.length > 0) {
      return apiUrl;
    }
  }
  for (const section of sections) {
    const endpoint = section?.get("endpoint_url");
    if (endpoint && endpoint.length > 0) {
      return endpoint;
    }
  }
  return undefined;
}

function readIniSync(path: string): Map<string, Map<string, string>> {
  try {
    return parseIni(readFileSync(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return new Map();
    }
    throw error;
  }
}

async function readIni(path: string): Promise<Map<string, Map<string, string>>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return new Map();
    }
    throw error;
  }
  return parseIni(text);
}

export function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = "default";
  sections.set(current, new Map());
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const section = /^\[([^\]]+)\]$/.exec(trimmed);
    if (section?.[1]) {
      current = section[1].trim();
      if (!sections.has(current)) {
        sections.set(current, new Map());
      }
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!sections.has(current)) {
      sections.set(current, new Map());
    }
    sections.get(current)?.set(key, value);
  }
  return sections;
}

async function writeIniKey(path: string, section: string, key: string, value: string): Promise<void> {
  const destination = await resolveWritablePath(path);
  const existing = await readIni(destination);
  const bucket = existing.get(section) ?? new Map<string, string>();
  bucket.set(key, value);
  existing.set(section, bucket);
  const directory = dirname(destination);
  const created = await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${basename(destination)}.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serializeIni(existing));
    await handle.chmod(0o600);
  } catch (error) {
    await handle.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  if (typeof created === "string" && created.length > 0) {
    await restrictCreatedDirectories(created, directory);
  }
}

async function resolveWritablePath(path: string): Promise<string> {
  let current = path;
  for (let hop = 0; hop < 8; hop += 1) {
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (isMissing(error)) {
        return current;
      }
      throw error;
    }
    if (!info.isSymbolicLink()) {
      return current;
    }
    const link = await readlink(current);
    current = isAbsolute(link) ? link : resolve(dirname(current), link);
  }
  throw new CliError("INVALID_INPUT", "The credentials path is a symlink loop.");
}

async function restrictCreatedDirectories(firstCreated: string, leaf: string): Promise<void> {
  const fromCreated = relative(firstCreated, leaf);
  if (fromCreated === "..") {
    return;
  }
  if (fromCreated.startsWith(`..${sep}`) || fromCreated.startsWith(sep) || isAbsolute(fromCreated)) {
    return;
  }
  const segments = fromCreated.length === 0 ? [] : fromCreated.split(sep).filter((segment) => segment.length > 0 && segment !== ".");
  let current = firstCreated;
  await chmod(current, 0o700);
  for (const segment of segments) {
    current = join(current, segment);
    await chmod(current, 0o700);
  }
}

function serializeIni(sections: Map<string, Map<string, string>>): string {
  const blocks: string[] = [];
  for (const [section, values] of sections) {
    if (values.size === 0) {
      continue;
    }
    const lines = [`[${section}]`];
    for (const [key, value] of values) {
      lines.push(`${key} = ${value}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
