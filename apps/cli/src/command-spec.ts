export const ARTIFACT_ID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export type CliFlagKind = "boolean" | "string" | "enum";

export type CliFlagSpec = {
  id: string;
  names: readonly string[];
  kind: CliFlagKind;
  values?: readonly string[];
  store: string;
  booleanValue?: string | boolean;
  onceGroup?: string;
  onceGroupName?: string;
  repeatable?: boolean;
  rejectInlineValue?: boolean;
  rejectInlineValueError?: string;
  parseError?: string;
  description: string;
  help: string;
  appliesTo: readonly string[] | "*";
  wrongCommandError?: string;
};

export type CliPositionalSpec = {
  name: string;
  required: boolean;
  description: string;
  missingError: string;
  validate?: "uuid";
};

export type CliExample = {
  command: string;
  description?: string;
};

export type CliExitCode = {
  code: number;
  description: string;
};

export type CliCommandSpec = {
  name: string;
  invocations: readonly (readonly string[])[];
  aliases: readonly string[];
  summary: string;
  description: string;
  usage: readonly string[];
  positionals: readonly CliPositionalSpec[];
  flags: readonly string[];
  exclusiveStores?: readonly string[];
  exclusiveFlagError?: string;
  extraArgsError: string;
  extraArgsErrorWhenStore?: Record<string, string>;
  configureAcceptsError?: string;
  examples: readonly CliExample[];
  exitCodes: readonly CliExitCode[];
  notes: readonly string[];
  docsSlug: string;
};

const defaultExitCodes: CliExitCode[] = [
  { code: 0, description: "Success." },
  { code: 1, description: "The command failed. Errors go to stderr. With --json, the body is {\"error\":{\"code\":\"...\",\"message\":\"...\"}}." }
];

export const cliFlags: readonly CliFlagSpec[] = [
  {
    id: "json",
    names: ["--json"],
    kind: "boolean",
    store: "json",
    booleanValue: true,
    repeatable: true,
    description: "Print one JSON line instead of the plain-text success output.",
    help: "Print one JSON line. upload prints the artifact envelope. get prints format, mediaType, and content. share prints the share envelope.",
    appliesTo: ["upload", "get", "share"]
  },
  {
    id: "revoke",
    names: ["--revoke"],
    kind: "boolean",
    store: "revoke",
    booleanValue: true,
    description: "Remove the public link and its password.",
    help: "share only. Remove the public link and its password.",
    appliesTo: ["share"],
    wrongCommandError: "--revoke is only valid for the share command."
  },
  {
    id: "password",
    names: ["--password"],
    kind: "boolean",
    store: "password",
    booleanValue: "prompt",
    onceGroup: "password",
    onceGroupName: "A password option",
    rejectInlineValue: true,
    rejectInlineValueError: "Passwords are not accepted as arguments. Use --password to be prompted, or --password-stdin.",
    description: "Prompt twice for a link password without echoing it. Needs a terminal.",
    help: "share only. Prompt twice for a link password without echoing it. Needs a terminal.",
    appliesTo: ["share"],
    wrongCommandError: "Password options are only valid for the share command."
  },
  {
    id: "passwordStdin",
    names: ["--password-stdin"],
    kind: "boolean",
    store: "password",
    booleanValue: "stdin",
    onceGroup: "password",
    onceGroupName: "A password option",
    rejectInlineValue: true,
    rejectInlineValueError: "Passwords are not accepted as arguments. Use --password to be prompted, or --password-stdin.",
    description: "Read the link password from stdin. One trailing newline is removed.",
    help: "share only. Read the link password from stdin. One trailing newline is removed.",
    appliesTo: ["share"],
    wrongCommandError: "Password options are only valid for the share command."
  },
  {
    id: "removePassword",
    names: ["--remove-password"],
    kind: "boolean",
    store: "removePassword",
    booleanValue: true,
    description: "Keep the public link and remove its password.",
    help: "share only. Keep the link and remove its password.",
    appliesTo: ["share"],
    wrongCommandError: "Password options are only valid for the share command."
  },
  {
    id: "access",
    names: ["--access"],
    kind: "enum",
    values: ["private", "org_shared"],
    store: "access",
    parseError: "access must be private or org_shared.",
    description: "Upload access type. Defaults to private.",
    help: "upload only. Defaults to private.",
    appliesTo: ["upload"],
    wrongCommandError: "--access is only valid for the upload command."
  },
  {
    id: "format",
    names: ["--format"],
    kind: "enum",
    values: ["html", "markdown"],
    store: "format",
    parseError: "format must be html or markdown.",
    description: "Content format for get. Defaults to html.",
    help: "get only. Defaults to html.",
    appliesTo: ["get"],
    wrongCommandError: "--format is only valid for the get command."
  },
  {
    id: "apiUrl",
    names: ["--api-url"],
    kind: "string",
    store: "apiUrl",
    description: "API origin for this command. Overrides FACTROVE_API_URL and the profile.",
    help: "API origin. Overrides FACTROVE_API_URL and the profile.",
    appliesTo: "*"
  },
  {
    id: "apiKey",
    names: ["--api-key"],
    kind: "string",
    store: "apiKey",
    description: "API key to store. Prefer a prompt or stdin so the key stays out of shell history.",
    help: "configure only. Prefer a prompt or stdin so the key stays out of shell history.",
    appliesTo: ["configure"],
    wrongCommandError: "--api-key is only valid for the configure command."
  },
  {
    id: "profile",
    names: ["--profile"],
    kind: "string",
    store: "profile",
    description: "Credentials profile. Overrides FACTROVE_PROFILE. Defaults to default.",
    help: "Credentials profile. Overrides FACTROVE_PROFILE. Defaults to default.",
    appliesTo: "*"
  },
  {
    id: "help",
    names: ["-h", "--help"],
    kind: "boolean",
    store: "help",
    booleanValue: true,
    repeatable: true,
    description: "Show help.",
    help: "Show this help.",
    appliesTo: "*"
  }
];

export const cliCommands: readonly CliCommandSpec[] = [
  {
    name: "configure",
    invocations: [["configure"]],
    aliases: [],
    summary: "Save an API key and API URL for a profile.",
    description:
      "Writes ~/.factrove/credentials and ~/.factrove/config with mode 0600. Directories Factrove creates for those files are mode 0700. The command does not print the key. An explicit --profile uses that profile's stored key later and ignores FACTROVE_API_KEY.",
    usage: ["pnpm factrove configure [--profile <name>] [--api-key <key>] [--api-url <origin>]"],
    positionals: [],
    flags: ["profile", "apiKey", "apiUrl"],
    extraArgsError: "Unexpected extra arguments.",
    configureAcceptsError: "configure accepts --profile, --api-key, and --api-url.",
    examples: [
      { command: "pnpm factrove configure --profile default" },
      { command: "pnpm factrove configure --profile dev --api-url http://localhost:3001" }
    ],
    exitCodes: defaultExitCodes,
    notes: [
      "FACTROVE_CONFIG_DIR, FACTROVE_SHARED_CREDENTIALS_FILE, and FACTROVE_CONFIG_FILE override the file paths.",
      "When stdin is a terminal, the command prompts for a missing key and URL. Otherwise it reads the key and URL from two stdin lines."
    ],
    docsSlug: "configure"
  },
  {
    name: "upload",
    invocations: [["upload"]],
    aliases: [],
    summary: "Upload a local HTML file and print its viewer URL.",
    description:
      "Sends one HTML file to POST /api/v1/artifacts. Access defaults to private. Relative paths resolve from the directory where you ran pnpm. Each successful run creates a new artifact.",
    usage: ["pnpm factrove upload <path> [--access private|org_shared] [--api-url <origin>] [--profile <name>] [--json]"],
    positionals: [
      {
        name: "path",
        required: true,
        description: "Local .html or .htm file.",
        missingError: "Missing file path. Run: pnpm factrove upload <path>"
      }
    ],
    flags: ["access", "apiUrl", "profile", "json"],
    extraArgsError: "Unexpected extra arguments.",
    examples: [
      { command: "pnpm factrove upload ./fixtures/hello.html" },
      { command: "pnpm factrove upload ./report.html --access org_shared --json" },
      { command: "pnpm factrove upload ./report.html --profile dev --api-url http://localhost:3001 --json" }
    ],
    exitCodes: defaultExitCodes,
    notes: [
      "Plain success prints only the viewer URL and a newline.",
      "JSON success prints the { artifact } envelope on one line."
    ],
    docsSlug: "upload"
  },
  {
    name: "get",
    invocations: [["get"]],
    aliases: [],
    summary: "Print an artifact's stored HTML, or Markdown converted from that HTML.",
    description:
      "Calls GET /api/v1/artifacts/{id}/content. The default format is html, the stored bytes. --format markdown asks the API to convert that HTML on the way out. Markdown is not saved.",
    usage: ["pnpm factrove get <id> [--format html|markdown] [--json] [--api-url <origin>] [--profile <name>]"],
    positionals: [
      {
        name: "id",
        required: true,
        description: "Artifact UUID.",
        missingError: "Missing artifact id. Run: pnpm factrove get <id>",
        validate: "uuid"
      }
    ],
    flags: ["format", "json", "apiUrl", "profile"],
    extraArgsError: "Unexpected extra arguments.",
    examples: [
      { command: "pnpm factrove get 123e4567-e89b-42d3-a456-426614174000" },
      { command: "pnpm factrove get 123e4567-e89b-42d3-a456-426614174000 --format markdown --json" }
    ],
    exitCodes: defaultExitCodes,
    notes: [
      "Plain success prints the content with no extra bytes.",
      "JSON success prints one line with format, mediaType, and content."
    ],
    docsSlug: "get"
  },
  {
    name: "share",
    invocations: [["share"]],
    aliases: [],
    summary: "Create a public link, set or remove its password, or revoke it with --revoke.",
    description:
      "Creates a public share for the artifact you own, or prints the existing one. --password prompts twice. --password-stdin reads a pipe. --remove-password keeps the URL and clears the password. --revoke removes the link. Use only one of those actions.",
    usage: [
      "pnpm factrove share <id> [--password | --password-stdin | --remove-password | --revoke] [--json] [--api-url <origin>] [--profile <name>]"
    ],
    positionals: [
      {
        name: "id",
        required: true,
        description: "Artifact UUID.",
        missingError: "Missing artifact id. Run: pnpm factrove share <id>",
        validate: "uuid"
      }
    ],
    flags: ["password", "passwordStdin", "removePassword", "revoke", "json", "apiUrl", "profile"],
    exclusiveStores: ["password", "removePassword", "revoke"],
    exclusiveFlagError: "Use only one of --password, --password-stdin, --remove-password, and --revoke.",
    extraArgsError: "Unexpected extra arguments.",
    extraArgsErrorWhenStore: {
      password:
        "--password takes no value. It prompts for the password, so the password stays out of shell history."
    },
    examples: [
      { command: "pnpm factrove share 123e4567-e89b-42d3-a456-426614174000" },
      { command: "pnpm factrove share 123e4567-e89b-42d3-a456-426614174000 --password" },
      {
        command: "printf '%s' \"$LINK_PASSWORD\" | pnpm factrove share 123e4567-e89b-42d3-a456-426614174000 --password-stdin"
      },
      { command: "pnpm factrove share 123e4567-e89b-42d3-a456-426614174000 --remove-password" },
      { command: "pnpm factrove share 123e4567-e89b-42d3-a456-426614174000 --revoke" }
    ],
    exitCodes: defaultExitCodes,
    notes: [
      "Plain success prints the public link, whether it is password protected, and a newline.",
      "Plain --revoke prints a confirmation and does not print the old link.",
      "Plain --remove-password prints a confirmation. Passwords are 10 to 128 NFC characters and are never printed."
    ],
    docsSlug: "share"
  }
];

export const cliSpec = {
  title: "Upload HTML and print artifact content.",
  notes: [
    "The API key is read from FACTROVE_API_KEY, then the selected profile in ~/.factrove/credentials.",
    "An explicit --profile uses that profile's key and ignores FACTROVE_API_KEY. The API key is not printed.",
    "pnpm factrove reads apps/cli/.env for unset FACTROVE_API_URL and FACTROVE_PROFILE. The built CLI does not read that file.",
    "A URL from that file is used only when the environment and the selected profile have no API URL.",
    "Precedence is flags, then environment variables, then profile files, then that file, then the default origin.",
    "Relative upload paths resolve from the directory where you ran pnpm.",
    "JSON success prints one line.",
    "Errors go to stderr and the process exits nonzero.",
    "With --json, errors use {\"error\":{\"code\":\"...\",\"message\":\"...\"}}.",
    "Local error codes are FILE_NOT_FOUND, INVALID_INPUT, and NETWORK_ERROR.",
    "API error codes are passed through."
  ]
};

export function flagTakesValue(flag: CliFlagSpec): boolean {
  return flag.kind === "string" || flag.kind === "enum";
}

export function optionNamesWithValues(): ReadonlySet<string> {
  return new Set(cliFlags.filter(flagTakesValue).flatMap((flag) => flag.names));
}

export function findFlagByArg(arg: string): { flag: CliFlagSpec; inlineValue: string | undefined } | undefined {
  for (const flag of cliFlags) {
    for (const name of flag.names) {
      if (arg === name) {
        return { flag, inlineValue: undefined };
      }
      if (arg.startsWith(`${name}=`) && (flagTakesValue(flag) || flag.rejectInlineValue === true)) {
        return { flag, inlineValue: arg.slice(name.length + 1) };
      }
    }
  }
  return undefined;
}

export function matchCommand(positionals: readonly string[]): { command: CliCommandSpec; consumed: number } | undefined {
  let best: { command: CliCommandSpec; consumed: number } | undefined;
  for (const command of cliCommands) {
    for (const invocation of command.invocations) {
      if (invocation.length === 0 || invocation.length > positionals.length) {
        continue;
      }
      if (invocation.every((token, index) => positionals[index] === token)) {
        if (best === undefined || invocation.length > best.consumed) {
          best = { command, consumed: invocation.length };
        }
      }
    }
  }
  return best;
}

export function commandAllowsFlag(command: CliCommandSpec, flag: CliFlagSpec): boolean {
  if (flag.appliesTo === "*") {
    return true;
  }
  return command.flags.includes(flag.id) || flag.appliesTo.includes(command.name);
}

export function flagLabel(flag: CliFlagSpec): string {
  if (flag.kind === "enum" && flag.values) {
    return `${flag.names[0]} <${flag.values.join("|")}>`;
  }
  if (flag.kind === "string") {
    return `${flag.names[0]} <${flag.store === "apiUrl" ? "origin" : flag.store === "apiKey" ? "key" : "name"}>`;
  }
  return flag.names[0] ?? flag.id;
}

export function renderHelpText(): string {
  const usage = cliCommands.flatMap((command) => command.usage);
  const commandLines = cliCommands.map((command) => `  ${command.name.padEnd(11)}${command.summary}`);
  const optionLines = cliFlags.map((flag) => {
    const label = flagLabel(flag);
    return `  ${label.padEnd(28)} ${flag.help}`;
  });
  const examples = cliCommands.flatMap((command) => command.examples.map((example) => `  ${example.command}`));
  const commandNotes = cliCommands.flatMap((command) => command.notes);
  return [
    cliSpec.title,
    "",
    "Usage:",
    ...usage.map((line) => `  ${line}`),
    "",
    "Commands:",
    ...commandLines,
    "",
    "Options:",
    ...optionLines,
    "",
    ...cliSpec.notes.slice(0, 5),
    "",
    "Examples:",
    ...examples,
    "",
    ...commandNotes,
    ...cliSpec.notes.slice(5),
    ""
  ].join("\n");
}
