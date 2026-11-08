import { ARTIFACT_NAME_MESSAGE, artifactNameHasForbiddenCharacter, normalizeArtifactName } from "@factrove/contracts";
import { CliError } from "./cli-error.js";
import { ARTIFACT_ID, helpPage, type HelpCommand } from "./command-spec.js";
import { readStoredProfileSync, resolveApiKey, selectedProfile } from "./credentials.js";

export const DEFAULT_API_URL = "https://api.factrove.app";

export type AccessType = "private" | "org_shared";
export type ContentFormat = "html" | "markdown";
export type OutputFormat = "json" | "text";
export type { HelpCommand };

type CommandOptions = {
  json: boolean;
  output: OutputFormat;
  quiet: boolean;
  apiUrl: string;
  profile: string;
  profileExplicit: boolean;
};

export type UploadInvocation = CommandOptions & {
  kind: "upload";
  path: string;
  access: AccessType;
  artifactId: string | null;
  name: string | null;
};

export type GetInvocation = CommandOptions & {
  kind: "get";
  id: string;
  format: ContentFormat;
};

export type ConfigureInvocation = {
  kind: "configure";
  profile: string;
  apiKey: string | undefined;
  apiUrl: string | undefined;
  suggestedApiUrl: string;
};

export type SharePasswordSource = "prompt" | "stdin";

export type ShareInvocation = CommandOptions & {
  kind: "share";
  id: string;
  revoke: boolean;
  password: SharePasswordSource | null;
  removePassword: boolean;
};

export type ArtifactListView = "mine" | "org";

export type ListInvocation = CommandOptions & {
  kind: "list";
  view: ArtifactListView;
};

export type RenameInvocation = CommandOptions & {
  kind: "rename";
  id: string;
  name: string;
};

export type DeleteInvocation = CommandOptions & {
  kind: "delete";
  id: string;
  skipConfirm: boolean;
};

export type HelpInvocation = {
  kind: "help";
  command: HelpCommand | null;
};

export type CliInvocation =
  | UploadInvocation
  | GetInvocation
  | ShareInvocation
  | ListInvocation
  | RenameInvocation
  | DeleteInvocation
  | ConfigureInvocation
  | HelpInvocation;

const OPTIONS_WITH_VALUES = new Set([
  "--access",
  "--api-url",
  "--api-key",
  "--artifactId",
  "--endpoint-url",
  "--name",
  "--format",
  "--output",
  "--profile",
  "--view",
]);

export function helpText(command: HelpCommand | null = null): string {
  return helpPage(command);
}

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliInvocation {
  const help = requestedHelp(argv);
  if (help) {
    return { kind: "help", command: help.command };
  }

  const positionals: string[] = [];
  let json = false;
  let quiet = false;
  let revoke: boolean | undefined;
  let password: SharePasswordSource | undefined;
  let removePassword: boolean | undefined;
  let access: AccessType | undefined;
  let format: ContentFormat | undefined;
  let outputFlag: OutputFormat | undefined;
  let apiUrlFlag: string | undefined;
  let endpointFlag: string | undefined;
  let apiKeyFlag: string | undefined;
  let profileFlag: string | undefined;
  let artifactId: string | undefined;
  let name: string | undefined;
  let view: ArtifactListView | undefined;
  let yes = false;
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg === "-") {
      throw new CliError("INVALID_INPUT", "Unknown option '-'. Run: factrove --help");
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--quiet") {
      if (quiet) {
        throw new CliError("INVALID_INPUT", "--quiet was provided more than once.");
      }
      quiet = true;
      continue;
    }
    if (arg === "--revoke") {
      if (revoke !== undefined) {
        throw new CliError("INVALID_INPUT", "--revoke was provided more than once.");
      }
      revoke = true;
      continue;
    }
    if (arg === "--password" || arg === "--password-stdin") {
      password = assignOnce(password, arg === "--password" ? "prompt" : "stdin", "A password option");
      continue;
    }
    if (arg.startsWith("--password=") || arg.startsWith("--password-stdin=")) {
      throw new CliError(
        "INVALID_INPUT",
        "Passwords are not accepted as arguments. Use --password to be prompted, or --password-stdin.",
      );
    }
    if (arg === "--remove-password") {
      removePassword = assignOnce(removePassword, true, "--remove-password");
      continue;
    }
    if (arg === "--yes") {
      if (yes) {
        throw new CliError("INVALID_INPUT", "--yes was provided more than once.");
      }
      yes = true;
      continue;
    }
    if (arg === "--force") {
      if (force) {
        throw new CliError("INVALID_INPUT", "--force was provided more than once.");
      }
      force = true;
      continue;
    }
    if (arg === "--view" || arg.startsWith("--view=")) {
      const inline = arg.startsWith("--view=");
      const value = readOption(argv, arg, "--view", index);
      if (!inline) {
        index += 1;
      }
      view = assignOnce(view, parseView(value), "--view");
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
    if (arg === "--output" || arg.startsWith("--output=")) {
      const inline = arg.startsWith("--output=");
      const value = readOption(argv, arg, "--output", index);
      if (!inline) {
        index += 1;
      }
      outputFlag = assignOnce(outputFlag, parseOutput(value), "--output");
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
    if (arg === "--endpoint-url" || arg.startsWith("--endpoint-url=")) {
      const inline = arg.startsWith("--endpoint-url=");
      const value = readOption(argv, arg, "--endpoint-url", index);
      if (!inline) {
        index += 1;
      }
      endpointFlag = assignOnce(endpointFlag, value, "--endpoint-url");
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
    if (arg === "--name" || arg.startsWith("--name=")) {
      const inline = arg.startsWith("--name=");
      const raw = readOptionValue(argv, arg, "--name", index);
      if (!inline) {
        index += 1;
      }
      if (artifactNameHasForbiddenCharacter(raw)) {
        throw new CliError("INVALID_INPUT", ARTIFACT_NAME_MESSAGE);
      }
      if (raw.trim().length === 0) {
        throw new CliError("INVALID_INPUT", "Missing value for --name.");
      }
      const normalized = normalizeArtifactName(raw);
      if (normalized === null) {
        throw new CliError("INVALID_INPUT", ARTIFACT_NAME_MESSAGE);
      }
      name = assignOnce(name, normalized, "--name");
      continue;
    }
    if (arg === "--artifactId" || arg.startsWith("--artifactId=")) {
      const inline = arg.startsWith("--artifactId=");
      const value = readOption(argv, arg, "--artifactId", index);
      if (!inline) {
        index += 1;
      }
      artifactId = assignOnce(artifactId, value, "--artifactId");
      continue;
    }
    if (arg.startsWith("-")) {
      throw new CliError("INVALID_INPUT", `Unknown option '${arg}'. Run: factrove --help`);
    }
    positionals.push(arg);
  }

  if (json && outputFlag !== undefined && outputFlag !== "json") {
    throw new CliError("INVALID_INPUT", `--json conflicts with --output ${outputFlag}.`);
  }
  if (apiUrlFlag !== undefined && endpointFlag !== undefined && apiUrlFlag !== endpointFlag) {
    throw new CliError("INVALID_INPUT", "--endpoint-url and --api-url were given different values.");
  }

  const command = positionals[0];
  const args = positionals.slice(1);
  if (command === undefined) {
    throw new CliError("INVALID_INPUT", "Missing command. Run: factrove --help");
  }
  if (command !== "share" && (password !== undefined || removePassword !== undefined)) {
    throw new CliError("INVALID_INPUT", "Password options are only valid for the share command.");
  }
  if (command !== "upload" && artifactId !== undefined) {
    throw new CliError("INVALID_INPUT", "--artifactId is only valid for the upload command.");
  }
  if (command !== "upload" && command !== "rename" && name !== undefined) {
    throw new CliError("INVALID_INPUT", "--name is only valid for the upload and rename commands.");
  }
  if (command !== "list" && view !== undefined) {
    throw new CliError("INVALID_INPUT", "--view is only valid for the list command.");
  }
  if (command !== "delete" && (yes || force)) {
    throw new CliError("INVALID_INPUT", "--yes and --force are only valid for the delete command.");
  }
  const profile = selectedProfile(profileFlag, env);
  const stored = readStoredProfileSync(profile, env);
  const originFlag = apiUrlFlag ?? endpointFlag;
  const apiUrl = resolveApiUrl(originFlag, env, stored.apiUrl);
  const options: CommandOptions = {
    json: json || outputFlag === "json",
    output: json || outputFlag === "json" ? "json" : "text",
    quiet,
    apiUrl,
    profile,
    profileExplicit: profileFlag !== undefined,
  };

  if (command === "configure") {
    if (args.length > 0) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (
      access !== undefined
      || format !== undefined
      || view !== undefined
      || json
      || outputFlag !== undefined
      || quiet
      || revoke !== undefined
      || yes
      || force
    ) {
      throw new CliError("INVALID_INPUT", "configure accepts --profile, --api-key, --api-url, and --endpoint-url.");
    }
    return {
      kind: "configure",
      profile,
      apiKey: apiKeyFlag,
      apiUrl: originFlag,
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
    if (artifactId !== undefined && access !== undefined) {
      throw new CliError(
        "INVALID_INPUT",
        "--access cannot be used with --artifactId. Replacing content keeps the current access.",
      );
    }
    if (artifactId !== undefined && !ARTIFACT_ID.test(artifactId)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    const filePath = args[0];
    if (filePath === undefined) {
      throw new CliError("INVALID_INPUT", "Missing file path. Run: factrove upload <file>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    return {
      kind: "upload",
      path: filePath,
      access: access ?? "private",
      artifactId: artifactId ?? null,
      name: name ?? null,
      ...options,
    };
  }
  if (command === "get") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const id = args[0];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: factrove get <id>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    return { kind: "get", id, format: format ?? "html", ...options };
  }
  if (command === "list") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    if (args.length > 0) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    return { kind: "list", view: view ?? "mine", ...options };
  }
  if (command === "rename") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const id = args[0];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: factrove rename <id> --name <name>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    if (name === undefined) {
      throw new CliError("INVALID_INPUT", "Missing --name. Run: factrove rename <id> --name <name>");
    }
    return { kind: "rename", id, name, ...options };
  }
  if (command === "delete") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const id = args[0];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: factrove delete <id>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    return { kind: "delete", id, skipConfirm: yes || force, ...options };
  }
  if (command === "share") {
    if (access !== undefined) {
      throw new CliError("INVALID_INPUT", "--access is only valid for the upload command.");
    }
    if (format !== undefined) {
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command.");
    }
    const id = args[0];
    if (id === undefined) {
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: factrove share <id>");
    }
    if (args.length > 1) {
      throw new CliError(
        "INVALID_INPUT",
        password === "prompt"
          ? "--password takes no value. It prompts for the password, so the password stays out of shell history."
          : "Unexpected extra arguments.",
      );
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    const actions = [revoke, password, removePassword].filter((value) => value !== undefined).length;
    if (actions > 1) {
      throw new CliError(
        "INVALID_INPUT",
        "Use only one of --password, --password-stdin, --remove-password, and --revoke.",
      );
    }
    return {
      kind: "share",
      id,
      revoke: revoke ?? false,
      password: password ?? null,
      removePassword: removePassword ?? false,
      ...options,
    };
  }
  throw new CliError("INVALID_INPUT", `Unknown command '${command}'. Run: factrove --help`);
}

export function apiKeyForInvocation(invocation: CliInvocation, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (invocation.kind === "help" || invocation.kind === "configure") {
    return undefined;
  }
  return resolveApiKey(env, readStoredProfileSync(invocation.profile, env), invocation.profileExplicit);
}

export function cliWantsJson(argv: readonly string[]): boolean {
  let json = false;
  let explicitJson = false;
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
      explicitJson = true;
      continue;
    }
    if (arg === "--output" || arg.startsWith("--output=")) {
      const inline = arg.startsWith("--output=");
      const value = inline ? arg.slice("--output=".length) : argv[index + 1];
      if (!inline && value !== undefined && !value.startsWith("-")) {
        index += 1;
      }
      if (value === "json") {
        json = true;
      } else if (value === "text" && !explicitJson) {
        json = false;
      }
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

function requestedHelp(argv: readonly string[]): HelpInvocation | undefined {
  let sawHelp = false;
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
      sawHelp = true;
      continue;
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
  if (positionals[0] === "help") {
    sawHelp = true;
    positionals.shift();
  }
  if (!sawHelp) {
    return undefined;
  }
  const command = positionals[0];
  if (
    command === "upload"
    || command === "get"
    || command === "share"
    || command === "list"
    || command === "rename"
    || command === "delete"
    || command === "configure"
  ) {
    return { kind: "help", command };
  }
  return { kind: "help", command: null };
}

function readOptionValue(argv: readonly string[], arg: string, name: string, index: number): string {
  const inlinePrefix = `${name}=`;
  const raw = arg.startsWith(inlinePrefix) ? arg.slice(inlinePrefix.length) : argv[index + 1];
  if (raw === undefined || (!arg.startsWith(inlinePrefix) && raw.startsWith("-"))) {
    throw new CliError("INVALID_INPUT", `Missing value for ${name}.`);
  }
  return raw;
}

function readOption(argv: readonly string[], arg: string, name: string, index: number): string {
  const value = readOptionValue(argv, arg, name, index).trim();
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

function parseView(value: string): ArtifactListView {
  if (value === "mine" || value === "org") {
    return value;
  }
  throw new CliError("INVALID_INPUT", "view must be mine or org.");
}

function parseFormat(value: string): ContentFormat {
  if (value === "html" || value === "markdown") {
    return value;
  }
  throw new CliError("INVALID_INPUT", "format must be html or markdown.");
}

function parseOutput(value: string): OutputFormat {
  if (value === "json" || value === "text") {
    return value;
  }
  throw new CliError("INVALID_INPUT", "output must be json or text.");
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
  const fromEndpoint = env.FACTROVE_ENDPOINT_URL?.trim();
  if (fromEndpoint) {
    return fromEndpoint;
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
