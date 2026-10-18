import { CliError } from "./cli-error.js";

export const DEFAULT_API_URL = "http://localhost:3001";

export type AccessType = "private" | "org_shared";

export type UploadInvocation = {
  kind: "upload";
  path: string;
  access: AccessType;
  json: boolean;
  apiUrl: string;
};

export type CliInvocation = UploadInvocation | { kind: "help" };

const HELP = `Upload a local HTML file and print its viewer URL.

Usage:
  pnpm factrove upload <path> [--access private|org_shared] [--api-url <origin>] [--json]

Options:
  --access <private|org_shared>  Library classification. Defaults to private.
  --api-url <origin>             API origin. Overrides FACTROVE_API_URL. Defaults to http://localhost:3001.
  --json                         Print the artifact response envelope as one JSON line.
  -h, --help                     Show this help.

Examples:
  pnpm factrove upload ./fixtures/hello.html
  pnpm factrove upload ./report.html --access org_shared --json
  pnpm factrove upload ./report.html --api-url http://localhost:3001 --json

Plain success prints only the viewer URL and a newline.
JSON success prints the artifact response envelope on one line.
Errors go to stderr and the process exits nonzero.
With --json, errors use {"error":{"code":"...","message":"..."}}.
Local error codes are FILE_NOT_FOUND, INVALID_INPUT, and NETWORK_ERROR.
API error codes are passed through.
`;

export function helpText(): string {
  return HELP;
}

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliInvocation {
  if (requestsHelp(argv)) {
    return { kind: "help" };
  }

  const positionals: string[] = [];
  let json = false;
  let access: AccessType | undefined;
  let apiUrlFlag: string | undefined;

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
    if (arg === "--access" || arg.startsWith("--access=")) {
      const inline = arg.startsWith("--access=");
      const value = readOption(argv, arg, "--access", index);
      if (!inline) {
        index += 1;
      }
      access = assignOnce(access, parseAccess(value), "--access");
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
    if (arg.startsWith("-")) {
      throw new CliError("INVALID_INPUT", `Unknown option '${arg}'. Run: pnpm factrove upload --help`);
    }
    positionals.push(arg);
  }

  const command = positionals[0];
  if (command === undefined) {
    throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove upload --help");
  }
  if (command !== "upload") {
    throw new CliError("INVALID_INPUT", `Unknown command '${command}'. Run: pnpm factrove upload --help`);
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
    apiUrl: resolveApiUrl(apiUrlFlag, env),
  };
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
    if (arg === "--access" || arg === "--api-url") {
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
    if (arg === "--access" || arg === "--api-url") {
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

function assignOnce<T>(current: T | undefined, next: T, name: string): T {
  if (current !== undefined) {
    throw new CliError("INVALID_INPUT", `${name} was provided more than once.`);
  }
  return next;
}

function resolveApiUrl(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  if (flag !== undefined) {
    return flag;
  }
  const fromEnv = env.FACTROVE_API_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_API_URL;
}
