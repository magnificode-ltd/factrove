import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
  const apiUrl = config.get(configSection(profile))?.get(URL_FIELD) ?? config.get(profile)?.get(URL_FIELD);
  return {
    apiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    apiUrl: apiUrl && apiUrl.length > 0 ? apiUrl : undefined,
  };
}

export function resolveApiKey(env: NodeJS.ProcessEnv, stored: StoredProfile): string | undefined {
  const fromEnv = env.FACTROVE_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
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
  const existing = await readIni(path);
  const bucket = existing.get(section) ?? new Map<string, string>();
  bucket.set(key, value);
  existing.set(section, bucket);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, serializeIni(existing), { mode: 0o600 });
  await chmod(path, 0o600);
  await chmod(dirname(path), 0o700);
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
