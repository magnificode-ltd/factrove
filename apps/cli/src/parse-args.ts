import { CliError } from "./cli-error.js";
import { readStoredProfileSync, resolveApiKey, selectedProfile } from "./credentials.js";

export const DEFAULT_API_URL = "http://localhost:3001";

export type AccessType = "private" | "org_shared";
export type ContentFormat = "html" | "markdown";

export type UploadInvocation = {
  kind: "upload";
  path: string;
  access: AccessType;
  json: boolean;
  apiUrl: string;
  profile: string;
  profileExplicit: boolean;
};

export type GetInvocation = {
  kind: "get";
  id: string;
  format: ContentFormat;
  json: boolean;
  apiUrl: string;
  profile: string;
  profileExplicit: boolean;
};

export type ConfigureInvocation = {
  kind: "configure";
  profile: string;
  apiKey: string | undefined;
  apiUrl: string | undefined;
  suggestedApiUrl: string;
};

export type ShareInvocation = {
  kind: "share";
  id: string;
  revoke: boolean;
  json: boolean;
  apiUrl: string;
  profile: string;
  profileExplicit: boolean;
};

export type CliInvocation = UploadInvocation | GetInvocation | ShareInvocation | ConfigureInvocation | { kind: "help" };

const HELP = `Upload HTML and print artifact content.

Usage:
  pnpm factrove upload <path> [--access private|org_shared] [--api-url <origin>] [--profile <name>] [--json]
  pnpm factrove get <id> [--format html|markdown] [--json] [--api-url <origin>] [--profile <name>]
  pnpm factrove share <id> [--revoke] [--json] [--api-url <origin>] [--profile <name>]
  pnpm factrove configure [--profile <name>] [--api-key <key>] [--api-url <origin>]

Commands:
  upload      Upload a local HTML file and print its viewer URL.
  get         Print an artifact's stored HTML, or Markdown converted from that HTML.
  share       Create a public link, or revoke it with --revoke.
  configure   Save an API key and API URL for a profile.

Options:
  --access <private|org_shared>  upload only. Defaults to private.
  --format <html|markdown>       get only. Defaults to html.
  --revoke                       share only. Remove the public link.
  --api-url <origin>             API origin. Overrides FACTROVE_API_URL and the profile.
  --api-key <key>                configure only. Prefer a prompt or stdin so the key stays out of shell history.
  --profile <name>               Credentials profile. Overrides FACTROVE_PROFILE. Defaults to default.
  --json                         Print one JSON line. upload prints the artifact envelope. get prints format, mediaType, and content. share prints the share envelope.
  -h, --help                     Show this help.

The API key is read from FACTROVE_API_KEY, then the selected profile in ~/.factrove/credentials.
An explicit --profile uses that profile's key and ignores FACTROVE_API_KEY. The API key is not printed.
pnpm factrove reads apps/cli/.env for unset FACTROVE_API_URL and FACTROVE_PROFILE. The built CLI does not read that file.
A URL from that file is used only when the environment and the selected profile have no API URL.
Precedence is flags, then environment variables, then profile files, then that file, then the default origin.

Examples:
  pnpm factrove configure --profile default
  pnpm factrove upload ./fixtures/hello.html
  pnpm factrove upload ./report.html --access org_shared --json
  pnpm factrove upload ./report.html --profile dev --api-url http://localhost:3001 --json
  pnpm factrove get 123e4567-e89b-42d3-a456-426614174000
  pnpm factrove get 123e4567-e89b-42d3-a456-426614174000 --format markdown --json
  pnpm factrove share 123e4567-e89b-42d3-a456-426614174000
  pnpm factrove share 123e4567-e89b-42d3-a456-426614174000 --revoke

Relative upload paths resolve from the directory where you ran pnpm.
Plain upload success prints only the viewer URL and a newline.
Plain share success prints only the public link and a newline.
Plain share --revoke prints a confirmation and does not print the old link.
Plain get success prints the content with no extra bytes.
JSON success prints one line.
Errors go to stderr and the process exits nonzero.
With --json, errors use {"error":{"code":"...","message":"..."}}.
Local error codes are FILE_NOT_FOUND, INVALID_INPUT, and NETWORK_ERROR.
API error codes are passed through.
`;

const OPTIONS_WITH_VALUES = new Set(["--access", "--api-url", "--api-key", "--format", "--profile"]);

// Same shape as the API UUID check: RFC 4122 versions 1-8, plus the nil and max UUIDs.
const ARTIFACT_ID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export function helpText(): string {
  return HELP;
}

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliInvocation {
  if (requestsHelp(argv)) {
    return { kind: "help" };
  }

  const positionals: string[] = [];
  let json = false;
  let revoke: boolean | undefined;
  let access: AccessType | undefined;
  let format: ContentFormat | undefined;
  let apiUrlFlag: string | undefined;
  let apiKeyFlag: string | undefined;
  let profileFlag: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--revoke") {
      if (revoke !== undefined) {
        throw new CliError("INVALID_INPUT", "--revoke was provided more than once.");
      }
      revoke = true;
      continue;
    }
    if (arg === "--access" || arg.startsWith("--access=")) {
      const inline = arg.startsWith("--access=");
      const value = readOption(argv, arg, "--access", index);
      if (!inline) {
        index += 1;
      }
      access = assignOnce(access, parseAccess(value), "--access");
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const inline = arg.startsWith("--format=");
      const value = readOption(argv, arg, "--format", index);
      if (!inline) {
        index += 1;
      }
      format = assignOnce(format, parseFormat(value), "--format");
      continue;
    }
    if (arg === "--api-url" || arg.startsWith("--api-url=")) {
      const inline = arg.startsWith("--api-url=");
      const value = readOption(argv, arg, "--api-url", index);
      if (!inline) {
        index += 1;
      }
      apiUrlFlag = assignOnce(apiUrlFlag, value, "--api-url");
      continue;
    }
    if (arg === "--api-key" || arg.startsWith("--api-key=")) {
      const inline = arg.startsWith("--api-key=");
      const value = readOption(argv, arg, "--api-key", index);
      if (!inline) {
        index += 1;
      }
      apiKeyFlag = assignOnce(apiKeyFlag, value, "--api-key");
      continue;
    }
    if (arg === "--profile" || arg.startsWith("--profile=")) {
      const inline = arg.startsWith("--profile=");
      const value = readOption(argv, arg, "--profile", index);
      if (!inline) {
        index += 1;
      }
      profileFlag = assignOnce(profileFlag, value, "--profile");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliError("INVALID_INPUT", `Unknown option '${arg}'. Run: pnpm factrove --help`);
    }
    positionals.push(arg);
  }

  const command = positionals[0];
  if (command === undefined) {
    throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
  }
  const profile = selectedProfile(profileFlag, env);
  const stored = readStoredProfileSync(profile, env);
  const apiUrl = resolveApiUrl(apiUrlFlag, env, stored.apiUrl);
  if (command === "configure") {
    if (positionals.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (access !== undefined || format !== undefined || json || revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "configure accepts --profile, --api-key, and --api-url.");
    }
    return {
      kind: "configure",
      profile,
      apiKey: apiKeyFlag,
      apiUrl: apiUrlFlag,
      suggestedApiUrl: apiUrl,
    };
  }
  if (apiKeyFlag !== undefined) {
    throw new CliError("INVALID_INPUT", "--api-key is only valid for the configure command.");
  }
  if (command === "upload") {
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const filePath = positionals[1];
    if (filePath === undefined) {
      throw new CliError("INVALID_INPUT", "Missing file path. Run: pnpm factrove upload <path>");
    }
    if (positionals.length > 2) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    return {
      kind: "upload",
      path: filePath,
      access: access ?? "private",
      json,
      apiUrl,
      profile,
      profileExplicit: profileFlag !== undefined,
    };
  }
  if (command === "get") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const id = positionals[1];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: pnpm factrove get <id>");
    }
    if (positionals.length > 2) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    return {
      kind: "get",
      id,
      format: format ?? "html",
      json,
      apiUrl,
      profile,
      profileExplicit: profileFlag !== undefined,
    };
  }
  if (command === "share") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    const id = positionals[1];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: pnpm factrove share <id>");
    }
    if (positionals.length > 2) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    return {
      kind: "share",
      id,
      revoke: revoke ?? false,
      json,
      apiUrl,
      profile,
      profileExplicit: profileFlag !== undefined,
    };
  }
  throw new CliError("INVALID_INPUT", `Unknown command '${command}'. Run: pnpm factrove --help`);
}

export function apiKeyForInvocation(invocation: CliInvocation, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (invocation.kind === "help" || invocation.kind === "configure") {
    return undefined;
  }
  return resolveApiKey(env, readStoredProfileSync(invocation.profile, env), invocation.profileExplicit);
}

export function cliWantsJson(argv: readonly string[]): boolean {
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (OPTIONS_WITH_VALUES.has(arg)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("-")) {
        index += 1;
      }
    }
  }
  return json;
}

export function safeApiOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "the configured API origin";
    }
    return url.origin;
  } catch {
    return "the configured API origin";
  }
}

function requestsHelp(argv: readonly string[]): boolean {
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      break;
    }
    if (arg === "--help" || arg === "-h") {
      return true;
    }
    if (OPTIONS_WITH_VALUES.has(arg)) {
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

function readOption(argv: readonly string[], arg: string, name: string, index: number): string {
  const inlinePrefix = `${name}=`;
  const raw = arg.startsWith(inlinePrefix) ? arg.slice(inlinePrefix.length) : argv[index + 1];
  if (raw === undefined || (!arg.startsWith(inlinePrefix) && raw.startsWith("-"))) {
    throw new CliError("INVALID_INPUT", `Missing value for ${name}.`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new CliError("INVALID_INPUT", `Missing value for ${name}.`);
  }
  return value;
}

function parseAccess(value: string): AccessType {
  if (value === "private" || value === "org_shared") {
    return value;
  }
  throw new CliError("INVALID_INPUT", "access must be private or org_shared.");
}

function parseFormat(value: string): ContentFormat {
  if (value === "html" || value === "markdown") {
    return value;
  }
  throw new CliError("INVALID_INPUT", "format must be html or markdown.");
}

function assignOnce<T>(current: T | undefined, next: T, name: string): T {
  if (current !== undefined) {
    throw new CliError("INVALID_INPUT", `${name} was provided more than once.`);
  }
  return next;
}

function resolveApiUrl(flag: string | undefined, env: NodeJS.ProcessEnv, stored: string | undefined): string {
  if (flag !== undefined) {
    return flag;
  }
  const fromEnv = env.FACTROVE_API_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (stored) {
    return stored;
  }
  const fromDevFile = env.FACTROVE_DEV_API_URL?.trim();
  if (fromDevFile) {
    return fromDevFile;
  }
  return DEFAULT_API_URL;
}
