export const ARTIFACT_ID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export type HelpCommand = "upload" | "get" | "share" | "configure";

export type CliFlagKind = "boolean" | "string" | "enum";

export type CliFlagSpec = {
  id: string;
  names: readonly string[];
  kind: CliFlagKind;
  values?: readonly string[];
  store: string;
  documented: boolean;
  description: string;
  appliesTo: readonly string[] | "*";
};

export type CliPositionalSpec = {
  name: string;
  required: boolean;
  description: string;
};

export type CliCommandSpec = {
  name: HelpCommand;
  summary: string;
  description: string;
  positionals: readonly CliPositionalSpec[];
  flags: readonly string[];
  helpText: string;
  docsSlug: string;
};

export const TOP_LEVEL_HELP = `Usage: factrove <command> [options]

Commands:
  upload <file>                    Upload an HTML file as a new artifact and print its id.
  upload <file> --artifactId <id>  Replace the content of an existing artifact.
  get <id>                         Print an artifact's content (HTML, or --format markdown).
  share <id>                       Create a public link. Add --password, --remove-password or --revoke.
  configure                        Save your API key and API URL.

Global options:
  --api-url <origin>   API origin (alias: --endpoint-url)
  --json               Print one JSON line (alias: --output json)
  -h, --help           Show help. Run \`factrove <command> --help\` for details.

Examples:
  factrove upload ./hey.html
  factrove upload ./hey.html --artifactId <artifact-id>
  factrove get <artifact-id> --format markdown
  factrove share <artifact-id> --password
  factrove configure
`;

export const UPLOAD_HELP = `Usage: factrove upload <file> [--artifactId <id>] [--access private|org_shared] [--json]

Uploads an HTML file. Without --artifactId it creates a new artifact and prints
only its id. With --artifactId it replaces that artifact's content and prints the same id.

Options:
  --artifactId <id>              Replace this artifact instead of creating a new one.
  --access <private|org_shared>  Who can see a new artifact (default: private).
  --json                         Print one JSON line.
`;

export const GET_HELP = `Usage: factrove get <id> [--format html|markdown] [--json]

Prints an artifact's content. HTML by default, or Markdown with --format markdown.

Options:
  --format <html|markdown>  Content to print (default: html).
  --json                    Print one JSON line.
`;

export const SHARE_HELP = `Usage: factrove share <id> [--password | --password-stdin | --remove-password | --revoke] [--json]

Creates a public link, or prints the existing one.

Options:
  --password         Prompt twice for a link password. Needs a terminal.
  --password-stdin   Read the link password from a pipe.
  --remove-password  Keep the link and remove its password.
  --revoke           Remove the public link and its password.
  --json             Print one JSON line.
`;

export const CONFIGURE_HELP = `Usage: factrove configure [--api-key <key>] [--api-url <origin>] [--profile <name>]

Saves an API key and API URL for a profile.

Options:
  --api-key <key>     API key. A prompt keeps it out of shell history.
  --api-url <origin>  API origin (alias: --endpoint-url).
  --profile <name>    Credentials profile (default: default).
`;

export const APPROVED_HELP = {
  top: TOP_LEVEL_HELP,
  upload: UPLOAD_HELP,
  get: GET_HELP,
  share: SHARE_HELP,
  configure: CONFIGURE_HELP,
} as const;

export const cliFlags: readonly CliFlagSpec[] = [
  {
    id: "artifactId",
    names: ["--artifactId"],
    kind: "string",
    store: "artifactId",
    documented: true,
    description: "Replace this artifact instead of creating a new one.",
    appliesTo: ["upload"],
  },
  {
    id: "access",
    names: ["--access"],
    kind: "enum",
    values: ["private", "org_shared"],
    store: "access",
    documented: true,
    description: "Who can see a new artifact (default: private).",
    appliesTo: ["upload"],
  },
  {
    id: "format",
    names: ["--format"],
    kind: "enum",
    values: ["html", "markdown"],
    store: "format",
    documented: true,
    description: "Content to print (default: html).",
    appliesTo: ["get"],
  },
  {
    id: "password",
    names: ["--password"],
    kind: "boolean",
    store: "password",
    documented: true,
    description: "Prompt twice for a link password. Needs a terminal.",
    appliesTo: ["share"],
  },
  {
    id: "passwordStdin",
    names: ["--password-stdin"],
    kind: "boolean",
    store: "password",
    documented: true,
    description: "Read the link password from a pipe.",
    appliesTo: ["share"],
  },
  {
    id: "removePassword",
    names: ["--remove-password"],
    kind: "boolean",
    store: "removePassword",
    documented: true,
    description: "Keep the link and remove its password.",
    appliesTo: ["share"],
  },
  {
    id: "revoke",
    names: ["--revoke"],
    kind: "boolean",
    store: "revoke",
    documented: true,
    description: "Remove the public link and its password.",
    appliesTo: ["share"],
  },
  {
    id: "json",
    names: ["--json"],
    kind: "boolean",
    store: "json",
    documented: true,
    description: "Print one JSON line (alias: --output json).",
    appliesTo: ["upload", "get", "share"],
  },
  {
    id: "output",
    names: ["--output"],
    kind: "enum",
    values: ["json", "text"],
    store: "output",
    documented: true,
    description: "Print one JSON line when the value is json. --output text is the plain output.",
    appliesTo: ["upload", "get", "share"],
  },
  {
    id: "apiUrl",
    names: ["--api-url", "--endpoint-url"],
    kind: "string",
    store: "apiUrl",
    documented: true,
    description: "API origin (alias: --endpoint-url).",
    appliesTo: "*",
  },
  {
    id: "apiKey",
    names: ["--api-key"],
    kind: "string",
    store: "apiKey",
    documented: true,
    description: "API key. A prompt keeps it out of shell history.",
    appliesTo: ["configure"],
  },
  {
    id: "profile",
    names: ["--profile"],
    kind: "string",
    store: "profile",
    documented: true,
    description: "Credentials profile (default: default). Accepted on every command. Help lists it on configure.",
    appliesTo: "*",
  },
  {
    id: "quiet",
    names: ["--quiet"],
    kind: "boolean",
    store: "quiet",
    documented: false,
    description: "Accepted on upload, get, and share. It does not hide their output. Help does not list it. configure rejects it.",
    appliesTo: ["upload", "get", "share"],
  },
  {
    id: "help",
    names: ["-h", "--help"],
    kind: "boolean",
    store: "help",
    documented: true,
    description: "Show help.",
    appliesTo: "*",
  },
];

export const cliCommands: readonly CliCommandSpec[] = [
  {
    name: "upload",
    summary: "Upload an HTML file as a new artifact and print its id.",
    description:
      "Without --artifactId it creates a new artifact and prints only its id. With --artifactId it replaces that artifact's content and prints the same id.",
    positionals: [{ name: "file", required: true, description: "Local .html or .htm file." }],
    flags: ["artifactId", "access", "json", "output", "apiUrl", "profile"],
    helpText: UPLOAD_HELP,
    docsSlug: "upload",
  },
  {
    name: "get",
    summary: "Print an artifact's content (HTML, or --format markdown).",
    description: "Prints an artifact's content. HTML by default, or Markdown with --format markdown.",
    positionals: [{ name: "id", required: true, description: "Artifact UUID." }],
    flags: ["format", "json", "output", "apiUrl", "profile"],
    helpText: GET_HELP,
    docsSlug: "get",
  },
  {
    name: "share",
    summary: "Create a public link. Add --password, --remove-password or --revoke.",
    description: "Creates a public link, or prints the existing one.",
    positionals: [{ name: "id", required: true, description: "Artifact UUID." }],
    flags: ["password", "passwordStdin", "removePassword", "revoke", "json", "output", "apiUrl", "profile"],
    helpText: SHARE_HELP,
    docsSlug: "share",
  },
  {
    name: "configure",
    summary: "Save your API key and API URL.",
    description: "Saves an API key and API URL for a profile.",
    positionals: [],
    flags: ["apiKey", "apiUrl", "profile"],
    helpText: CONFIGURE_HELP,
    docsSlug: "configure",
  },
];

export const cliReferenceNotes: Record<string, string> = {
  help: [
    "## Where to go",
    "",
    "Each command page repeats that command's help text, then lists every flag the command accepts. Help text omits `--api-url`, `--endpoint-url`, `--output`, and `--profile`.",
    "",
    "Install and build steps are in [CLI overview](/cli-reference/overview). Precedence and a copyable workflow are in [CLI](/guides/cli).",
  ].join("\n"),
  upload: [
    "## Behavior",
    "",
    "Plain success prints only the new id. `--json` prints one `{ artifact }` line.",
    "",
    "`--artifactId` replaces content and prints the same id. The API keeps the current access and any share token. `--access` with `--artifactId` is rejected before a request is sent. Only the owner can replace. Anyone else gets `404 ARTIFACT_NOT_FOUND`.",
    "",
    "The file must be non-empty UTF-8 `.html` or `.htm` and at most 10,485,760 bytes. `--access org_shared` requires a current organization membership. Signup does not create one. See [Concepts](/concepts#organization-membership).",
    "",
    "Another replace of the same revision returns `409 CONTENT_CONFLICT`. A replace can return `500` after the new object is already committed. GET the artifact before retrying. Replacement does not keep version history and normally deletes the previous object.",
    "",
    "## Related",
    "",
    "- [CLI](/guides/cli)",
    "- [Upload an HTML file](/api-reference/artifacts/upload-an-html-file)",
    "- [Replace an artifact's stored HTML](/api-reference/artifacts/replace-an-artifacts-stored-html)",
  ].join("\n"),
  get: [
    "## Behavior",
    "",
    "Plain success prints the content bytes. `--json` prints one line with `format`, `mediaType`, and `content`.",
    "",
    "`--format markdown` asks the API to convert the stored HTML. Markdown is not saved. The converter does not run JavaScript. It drops scripts, styles, SVG, MathML, and several other elements, and it cannot preserve layout or content that JavaScript would have generated. Limits are 10,485,760 input bytes, 16 MiB of output, and five seconds. Failures use `413 CONTENT_TOO_LARGE`, `422 CONTENT_TOO_COMPLEX`, and `503 CONVERSION_UNAVAILABLE`. See [Concepts](/concepts#markdown-conversion).",
    "",
    "## Related",
    "",
    "- [CLI](/guides/cli)",
    "- [Download artifact HTML or converted Markdown](/api-reference/artifacts/download-artifact-html-or-converted-markdown)",
  ].join("\n"),
  share: [
    "## Behavior",
    "",
    "Plain success prints the public URL and then a status line that says whether the link is password protected. `--json` prints one `{ share }` line. Upload is the command that prints only an id.",
    "",
    "`--password` prompts twice and needs a terminal. `--password-stdin` reads a pipe and removes one trailing newline. An agent can run `printf '%s' \"$LINK_PASSWORD\" | factrove share \"$artifact_id\" --password-stdin`.",
    "",
    "`--revoke` removes the link and its password. Sharing again without a password creates an unprotected link. Pass the password again to keep protection. See [Sharing links](/guides/sharing-links#lockout-recovery).",
    "",
    "## Related",
    "",
    "- [Sharing links](/guides/sharing-links)",
    "- [Create or update a public share](/api-reference/shares/create-or-update-a-public-share)",
  ].join("\n"),
  configure: [
    "## Behavior",
    "",
    "The command writes `~/.factrove/credentials` and `~/.factrove/config` mode 0600 and does not print the key. `--api-key` prompts when it is omitted.",
    "",
    "Create the key in the web app at `/account/api-keys`, or follow [Create an API key from a session](/api-reference/overview#create-an-api-key-from-a-session). Key management uses the session cookie and an allowed `Origin`. It rejects `Authorization`.",
    "",
    "Precedence for later commands is in [CLI](/guides/cli). When a command cannot reach the API, see [Troubleshooting](/guides/troubleshooting).",
  ].join("\n"),
};

export function helpPage(command: HelpCommand | null = null): string {
  if (command === null) {
    return TOP_LEVEL_HELP;
  }
  const spec = cliCommands.find((entry) => entry.name === command);
  if (spec === undefined) {
    return TOP_LEVEL_HELP;
  }
  return spec.helpText;
}

export function flagLabel(flag: CliFlagSpec): string {
  const names = flag.names.join(", ");
  if (flag.kind === "enum" && flag.values) {
    return `${names} <${flag.values.join("|")}>`;
  }
  if (flag.kind === "string") {
    return `${names} <${flag.store === "apiUrl" ? "origin" : flag.store === "apiKey" ? "key" : flag.store === "artifactId" ? "id" : "name"}>`;
  }
  return names || flag.id;
}
