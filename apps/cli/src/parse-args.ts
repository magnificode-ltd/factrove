import { CliError } from "./cli-error.js";
import {
  ARTIFACT_ID,
  cliFlags,
  commandAllowsFlag,
  findFlagByArg,
  flagTakesValue,
  matchCommand,
  optionNamesWithValues,
  renderHelpText,
  type CliCommandSpec,
  type CliFlagSpec,
} from "./command-spec.js";
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

export type SharePasswordSource = "prompt" | "stdin";

export type ShareInvocation = {
  kind: "share";
  id: string;
  revoke: boolean;
  password: SharePasswordSource | null;
  removePassword: boolean;
  json: boolean;
  apiUrl: string;
  profile: string;
  profileExplicit: boolean;
};

export type CliInvocation = UploadInvocation | GetInvocation | ShareInvocation | ConfigureInvocation | { kind: "help" };

type ParsedStores = {
  json?: boolean;
  revoke?: boolean;
  password?: SharePasswordSource;
  removePassword?: boolean;
  access?: AccessType;
  format?: ContentFormat;
  apiUrl?: string;
  apiKey?: string;
  profile?: string;
};

const OPTIONS_WITH_VALUES = optionNamesWithValues();

export function helpText(): string {
  return renderHelpText();
}

export function parseCliArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliInvocation {
  if (requestsHelp(argv)) {
    return { kind: "help" };
  }

  const { positionals, stores } = collectArgs(argv);
  if (positionals[0] === undefined) {
    throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
  }

  const matched = matchCommand(positionals);
  const passwordUsed = stores.password !== undefined || stores.removePassword === true;
  if ((matched === undefined || matched.command.name !== "share") && passwordUsed) {
    throw new CliError("INVALID_INPUT", "Password options are only valid for the share command.");
  }

  const profile = selectedProfile(stores.profile, env);
  const stored = readStoredProfileSync(profile, env);
  const apiUrl = resolveApiUrl(stores.apiUrl, env, stored.apiUrl);
  const profileExplicit = stores.profile !== undefined;

  if (matched?.command.extraArgsBeforeFlags) {
    const rest = positionals.slice(matched.consumed);
    if (rest.length > 0) {
      throw new CliError("INVALID_INPUT", matched.command.extraArgsError);
    }
    rejectConfigureFlags(matched.command, stores);
    return {
      kind: "configure",
      profile,
      apiKey: stores.apiKey,
      apiUrl: stores.apiUrl,
      suggestedApiUrl: apiUrl,
    };
  }

  if (stores.apiKey !== undefined) {
    throw new CliError("INVALID_INPUT", "--api-key is only valid for the configure command.");
  }

  if (matched === undefined) {
    throw new CliError("INVALID_INPUT", `Unknown command '${positionals[0]}'. Run: pnpm factrove --help`);
  }

  const command = matched.command;
  const rest = positionals.slice(matched.consumed);
  rejectWrongCommandFlags(command, stores);
  const values = readPositionals(command, rest, stores);
  if (command.name === "upload") {
    return {
      kind: "upload",
      path: requiredValue(values.path, command.positionals[0]?.missingError ?? command.extraArgsError),
      access: stores.access ?? "private",
      json: stores.json === true,
      apiUrl,
      profile,
      profileExplicit,
    };
  }
  if (command.name === "get") {
    return {
      kind: "get",
      id: requiredValue(values.id, command.positionals[0]?.missingError ?? command.extraArgsError),
      format: stores.format ?? "html",
      json: stores.json === true,
      apiUrl,
      profile,
      profileExplicit,
    };
  }
  if (command.name === "share") {
    rejectExclusiveFlags(command, stores);
    return {
      kind: "share",
      id: requiredValue(values.id, command.positionals[0]?.missingError ?? command.extraArgsError),
      revoke: stores.revoke === true,
      password: stores.password ?? null,
      removePassword: stores.removePassword === true,
      json: stores.json === true,
      apiUrl,
      profile,
      profileExplicit,
    };
  }

  throw new CliError("INVALID_INPUT", `Unknown command '${command.name}'. Run: pnpm factrove --help`);
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

function collectArgs(argv: readonly string[]): { positionals: string[]; stores: ParsedStores } {
  const positionals: string[] = [];
  const stores: ParsedStores = {};
  const assigned = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith("-")) {
      const matched = findFlagByArg(arg);
      if (matched === undefined) {
        throw new CliError("INVALID_INPUT", `Unknown option '${arg}'. Run: pnpm factrove --help`);
      }
      const { flag, inlineValue } = matched;
      if (flag.rejectInlineValue && inlineValue !== undefined) {
        throw new CliError("INVALID_INPUT", flag.rejectInlineValueError ?? `Missing value for ${flag.names[0]}.`);
      }
      let value: string | boolean;
      if (flagTakesValue(flag)) {
        const raw = inlineValue ?? argv[index + 1];
        if (inlineValue === undefined) {
          index += 1;
        }
        value = readOptionValue(flag, raw, inlineValue !== undefined);
      } else {
        value = flag.booleanValue ?? true;
      }
      writeStore(stores, assigned, flag, value);
      continue;
    }
    positionals.push(arg);
  }

  return { positionals, stores };
}

function writeStore(
  stores: ParsedStores,
  assigned: Map<string, string>,
  flag: CliFlagSpec,
  value: string | boolean,
): void {
  const key = flag.onceGroup ?? flag.store;
  const label = flag.onceGroupName ?? flag.names[0] ?? flag.id;
  if (!flag.repeatable && assigned.has(key)) {
    throw new CliError("INVALID_INPUT", `${label} was provided more than once.`);
  }
  assigned.set(key, label);
  if (flag.store === "json") {
    stores.json = Boolean(value);
    return;
  }
  if (flag.store === "revoke") {
    stores.revoke = Boolean(value);
    return;
  }
  if (flag.store === "removePassword") {
    stores.removePassword = Boolean(value);
    return;
  }
  if (flag.store === "password") {
    stores.password = value === "stdin" ? "stdin" : "prompt";
    return;
  }
  if (flag.store === "access") {
    stores.access = value === "org_shared" ? "org_shared" : "private";
    return;
  }
  if (flag.store === "format") {
    stores.format = value === "markdown" ? "markdown" : "html";
    return;
  }
  if (flag.store === "apiUrl" && typeof value === "string") {
    stores.apiUrl = value;
    return;
  }
  if (flag.store === "apiKey" && typeof value === "string") {
    stores.apiKey = value;
    return;
  }
  if (flag.store === "profile" && typeof value === "string") {
    stores.profile = value;
  }
}

function readOptionValue(flag: CliFlagSpec, raw: string | undefined, inline: boolean): string {
  const name = flag.names[0] ?? flag.id;
  if (raw === undefined || (!inline && raw.startsWith("-"))) {
    throw new CliError("INVALID_INPUT", `Missing value for ${name}.`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new CliError("INVALID_INPUT", `Missing value for ${name}.`);
  }
  if (flag.kind === "enum" && flag.values && !flag.values.includes(value)) {
    throw new CliError("INVALID_INPUT", flag.parseError ?? `Invalid value for ${name}.`);
  }
  return value;
}

function rejectConfigureFlags(command: CliCommandSpec, stores: ParsedStores): void {
  if (stores.access !== undefined || stores.format !== undefined || stores.json === true || stores.revoke !== undefined) {
    throw new CliError(
      "INVALID_INPUT",
      command.configureAcceptsError ?? "configure accepts --profile, --api-key, and --api-url.",
    );
  }
}

function rejectWrongCommandFlags(command: CliCommandSpec, stores: ParsedStores): void {
  const seen = new Set<string>();
  for (const id of command.rejectFlagIds ?? []) {
    const flag = cliFlags.find((entry) => entry.id === id);
    if (flag === undefined || !storeIsSet(stores, flag) || commandAllowsFlag(command, flag)) {
      continue;
    }
    seen.add(flag.id);
    if (flag.wrongCommandError !== undefined) {
      throw new CliError("INVALID_INPUT", flag.wrongCommandError);
    }
  }
  for (const flag of cliFlags) {
    if (seen.has(flag.id) || !storeIsSet(stores, flag) || commandAllowsFlag(command, flag) || flag.wrongCommandError === undefined) {
      continue;
    }
    throw new CliError("INVALID_INPUT", flag.wrongCommandError);
  }
}

function storeIsSet(stores: ParsedStores, flag: CliFlagSpec): boolean {
  return storeValueIsSet(stores, flag.store);
}

function readPositionals(
  command: CliCommandSpec,
  rest: readonly string[],
  stores: ParsedStores,
): Record<string, string> {
  const values: Record<string, string> = {};
  const required = command.positionals.filter((positional) => positional.required);
  if (rest[0] === undefined && required[0] !== undefined) {
    throw new CliError("INVALID_INPUT", required[0].missingError);
  }
  if (rest.length > command.positionals.length) {
    throw new CliError("INVALID_INPUT", extraArgsMessage(command, stores));
  }
  for (const [index, positional] of command.positionals.entries()) {
    const value = rest[index];
    if (value === undefined) {
      if (positional.required) {
        throw new CliError("INVALID_INPUT", positional.missingError);
      }
      continue;
    }
    if (positional.validate === "uuid" && !ARTIFACT_ID.test(value)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    values[positional.name] = value;
  }
  return values;
}

function extraArgsMessage(command: CliCommandSpec, stores: ParsedStores): string {
  if (command.extraArgsErrorWhenStore?.password !== undefined && stores.password === "prompt") {
    return command.extraArgsErrorWhenStore.password;
  }
  return command.extraArgsError;
}

function rejectExclusiveFlags(command: CliCommandSpec, stores: ParsedStores): void {
  const exclusive = command.exclusiveStores;
  if (exclusive === undefined || exclusive.length === 0) {
    return;
  }
  const used = exclusive.filter((store) => storeValueIsSet(stores, store));
  if (used.length > 1) {
    throw new CliError("INVALID_INPUT", command.exclusiveFlagError ?? "Conflicting options.");
  }
}

function storeValueIsSet(stores: ParsedStores, store: string): boolean {
  if (store === "json") {
    return stores.json === true;
  }
  if (store === "revoke") {
    return stores.revoke !== undefined;
  }
  if (store === "removePassword") {
    return stores.removePassword !== undefined;
  }
  if (store === "password") {
    return stores.password !== undefined;
  }
  if (store === "access") {
    return stores.access !== undefined;
  }
  if (store === "format") {
    return stores.format !== undefined;
  }
  if (store === "apiUrl") {
    return stores.apiUrl !== undefined;
  }
  if (store === "apiKey") {
    return stores.apiKey !== undefined;
  }
  if (store === "profile") {
    return stores.profile !== undefined;
  }
  return false;
}

function requiredValue(value: string | undefined, missing: string): string {
  if (value === undefined) {
    throw new CliError("INVALID_INPUT", missing);
  }
  return value;
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
