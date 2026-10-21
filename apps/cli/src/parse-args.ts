import { CliError } from "./cli-error.js";
import { readStoredProfileSync, resolveApiKey, selectedProfile } from "./credentials.js";
import { isFactroveUri } from "./uri.js";

export const DEFAULT_API_URL = "http://localhost:3001";

export type AccessType = "private" | "org_shared";
export type ContentFormat = "html" | "markdown";
export type OutputFormat = "json" | "text";

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

export type CpInvocation = CommandOptions & {
  kind: "cp";
  source: string;
  destination: string;
  format: ContentFormat;
};

export type CliInvocation = UploadInvocation | GetInvocation | ShareInvocation | CpInvocation | ConfigureInvocation | { kind: "help" };

const HELP = `Upload HTML and print artifact content.

Usage:
  pnpm factrove cp <path> factrove://mine/ [--quiet] [--output json|text] [--endpoint-url <origin>] [--profile <name>]
  pnpm factrove cp <path> factrove://org/[name.html]
  pnpm factrove cp factrove://mine/<artifact-id> <path|-> [--format html|markdown]
  pnpm factrove s3 cp <source> <destination>
  pnpm factrove upload <path> [--access private|org_shared] [--api-url <origin>] [--profile <name>] [--json]
  pnpm factrove get <id> [--format html|markdown] [--json] [--api-url <origin>] [--profile <name>]
  pnpm factrove share <id> [--password | --password-stdin | --remove-password | --revoke] [--json] [--api-url <origin>] [--profile <name>]
  pnpm factrove configure [--profile <name>] [--api-key <key>] [--api-url <origin>]

Commands:
  cp          Copy a local HTML file into Factrove, or copy an artifact to a file or to -. This is the aws s3 name for upload and get.
  upload      Alias for uploading one file. Prints only the viewer URL.
  get         Alias for printing one artifact. Prints the content and no other bytes.
  share       Create a public link, set or remove its password, or revoke it with --revoke.
  configure   Save an API key and API URL for a profile.

factrove://mine/ uploads are private. factrove://org/ uploads are org_shared.
A download key is the artifact id, or that id plus .html. Upload names are not stored. A key cannot end with /. factrove://mine/ is the scope. factrove://mine/prefix/ is not a prefix.
An upload destination is the scope, or a .html or .htm name used only as the multipart filename. The server assigns the id.
A directory download uses <id>.html, or <id>.md when --format markdown.
share stays share. An aws s3 presign URL expires and has no password. A Factrove share link lasts until revoke, and its password flags stay on share.
cp follows aws s3 cp and does not read stdin. - is a download destination only. factrove s3 accepts cp only.
put-object and get-object are s3api names for object keys and metadata this library does not store.

Options:
  --access <private|org_shared>  upload only. Defaults to private. cp uses the URI scope instead.
  --format <html|markdown>       get, and cp when the source is a factrove:// URI. Defaults to html.
  --revoke                       share only. Remove the public link and its password.
  --password                     share only. Prompt twice for a link password without echoing it. Needs a terminal.
  --password-stdin               share only. Read the link password from stdin. One trailing newline is removed.
  --remove-password              share only. Keep the link and remove its password.
  --endpoint-url <origin>        API origin. Same as --api-url.
  --api-url <origin>             API origin. Overrides FACTROVE_API_URL, FACTROVE_ENDPOINT_URL, and the profile.
  --api-key <key>                configure only. Prefer a prompt or stdin so the key stays out of shell history.
  --profile <name>               Credentials profile. Overrides FACTROVE_PROFILE. Defaults to default.
  --output <json|text>           json is one line. text is the default.
  --json                         Same as --output json.
  --quiet                        Hide cp upload: and download: lines. upload, get, and share output stays the same.
  -h, --help                     Show this help.

The API key is read from FACTROVE_API_KEY, then the selected profile in ~/.factrove/credentials.
An explicit --profile uses that profile's key and ignores FACTROVE_API_KEY. The API key is not printed.
pnpm factrove reads apps/cli/.env for unset FACTROVE_API_URL and FACTROVE_PROFILE. The built CLI does not read that file.
A URL from that file is used only when the environment and the selected profile have no API URL.
FACTROVE_ENDPOINT_URL is a process-environment alias of FACTROVE_API_URL and applies only when FACTROVE_API_URL is unset.
~/.factrove/config may set api_url or endpoint_url. api_url wins when both are set. configure stores the origin as api_url.
Precedence is flags, then FACTROVE_API_URL, then FACTROVE_ENDPOINT_URL, then the profile, then the dev file, then the default origin.

Examples:
  pnpm factrove configure --profile default
  pnpm factrove cp ./fixtures/hello.html factrove://mine/
  pnpm factrove cp ./report.html factrove://org/ --output json
  pnpm factrove cp factrove://mine/<artifact-id> -
  pnpm factrove cp factrove://org/<artifact-id>.html ./report.html --quiet
  pnpm factrove upload ./fixtures/hello.html
  pnpm factrove get <artifact-id> --format markdown --json
  pnpm factrove share <artifact-id>
  pnpm factrove share <artifact-id> --password
  printf '%s' "$LINK_PASSWORD" | pnpm factrove share <artifact-id> --password-stdin
  pnpm factrove share <artifact-id> --remove-password
  pnpm factrove share <artifact-id> --revoke

Relative paths resolve from the directory where you ran pnpm.
cp text success prints upload: <path> to factrove://<scope>/<id> or download: factrove://<scope>/<id> to <path>.
Download to - writes the content to stdout and the download line to stderr.
--output json on cp prints the same JSON as upload --json or get --json.
Plain upload success prints only the viewer URL and a newline.
Plain share success prints the public link and whether it is password protected. A protected link also says to revoke, then share again, if visitors are locked out.
Plain share --revoke prints a confirmation and does not print the old link.
Plain share --remove-password prints a confirmation. Passwords are 10 to 128 NFC characters and are never printed.
Plain get success prints the content with no extra bytes.
JSON success prints one line.
Errors go to stderr and the process exits 1. Success exits 0.
With --json or --output json, errors use {"error":{"code":"...","message":"..."}}.
Local error codes are FILE_NOT_FOUND, INVALID_INPUT, and NETWORK_ERROR.
API error codes are passed through.
`;

const OPTIONS_WITH_VALUES = new Set(["--access", "--api-url", "--api-key", "--endpoint-url", "--format", "--output", "--profile"]);

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
      const command = positionals[0] === "s3" ? positionals[1] : positionals[0];
      if (command === "cp") {
        positionals.push(arg);
        continue;
      }
      throw new CliError("INVALID_INPUT", "Unknown option '-'. Run: pnpm factrove --help");
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
    if (arg.startsWith("-")) {
      throw new CliError("INVALID_INPUT", `Unknown option '${arg}'. Run: pnpm factrove --help`);
    }
    positionals.push(arg);
  }

  if (json && outputFlag !== undefined && outputFlag !== "json") {
    throw new CliError("INVALID_INPUT", `--json conflicts with --output ${outputFlag}.`);
  }
  if (apiUrlFlag !== undefined && endpointFlag !== undefined && apiUrlFlag !== endpointFlag) {
    throw new CliError("INVALID_INPUT", "--endpoint-url and --api-url were given different values.");
  }

  let command = positionals[0];
  let args = positionals.slice(1);
  if (command === "s3") {
    command = args[0];
    args = args.slice(1);
    if (command !== "cp") {
      throw new CliError(
        "INVALID_INPUT",
        command === undefined
          ? "Missing command. Run: pnpm factrove s3 cp <source> <destination>"
          : "factrove s3 only accepts cp. Run: pnpm factrove s3 cp <source> <destination>",
      );
    }
  }
  if (command === undefined) {
    throw new CliError("INVALID_INPUT", "Missing command. Run: pnpm factrove --help");
  }
  if (command !== "share" && (password !== undefined || removePassword !== undefined)) {
    throw new CliError("INVALID_INPUT", "Password options are only valid for the share command.");
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
    if (access !== undefined || format !== undefined || json || outputFlag !== undefined || quiet || revoke !== undefined) {
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
      throw new CliError("INVALID_INPUT", "--format is only valid for the get command, and for cp when the source is a factrove:// URI.");
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const filePath = args[0];
    if (filePath === undefined) {
      throw new CliError("INVALID_INPUT", "Missing file path. Run: pnpm factrove upload <path>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    return { kind: "upload", path: filePath, access: access ?? "private", ...options };
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
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: pnpm factrove get <id>");
    }
    if (args.length > 1) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (!ARTIFACT_ID.test(id)) {
      throw new CliError("INVALID_INPUT", "Artifact id must be a UUID.");
    }
    return { kind: "get", id, format: format ?? "html", ...options };
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
      throw new CliError("INVALID_INPUT", "Missing artifact id. Run: pnpm factrove share <id>");
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
  if (command === "cp") {
    if (access !== undefined) {
      throw new CliError(
        "INVALID_INPUT",
        "--access is only valid for the upload command. cp uses the URI scope: factrove://mine/ is private and factrove://org/ is org_shared.",
      );
    }
    if (revoke !== undefined) {
      throw new CliError("INVALID_INPUT", "--revoke is only valid for the share command.");
    }
    const source = args[0];
    const destination = args[1];
    if (source === undefined || destination === undefined) {
      throw new CliError("INVALID_INPUT", "cp needs a source and a destination. Run: pnpm factrove cp <source> <destination>");
    }
    if (args.length > 2) {
      throw new CliError("INVALID_INPUT", "Unexpected extra arguments.");
    }
    if (format !== undefined && !isFactroveUri(source)) {
      throw new CliError("INVALID_INPUT", "--format is only valid when copying an artifact to a local path or -.");
    }
    return { kind: "cp", source, destination, format: format ?? "html", ...options };
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
  return positionals[0] === "help" || (positionals[0] === "s3" && positionals[1] === "help");
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
