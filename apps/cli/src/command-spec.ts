export const ARTIFACT_ID =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

export type HelpCommand = "upload" | "get" | "share" | "list" | "rename" | "delete" | "configure";

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
  list                             List your artifacts. --view org lists organization-shared ones.
  get <id>                         Print an artifact's content (HTML, or --format markdown).
  share <id>                       Create a public link. Add --password, --remove-password or --revoke.
  rename <id> --name <name>        Change the name shown in the library.
  delete <id>                      Delete an artifact. --yes skips the confirmation.
  configure                        Save your API key and API URL.

Global options:
  --api-url <origin>   API origin (alias: --endpoint-url)
  --json               Print one JSON line (alias: --output json)
  -h, --help           Show help. Run \`factrove <command> --help\` for details.

Examples:
  factrove upload ./hey.html
  factrove upload ./hey.html --name "X launch calendar"
  factrove upload ./hey.html --artifactId <artifact-id>
  factrove list --json
  factrove get <artifact-id> --format markdown
  factrove share <artifact-id> --password
  factrove rename <artifact-id> --name "X launch calendar"
  factrove delete <artifact-id> --yes
  factrove configure
`;

export const UPLOAD_HELP = `Usage: factrove upload <file> [--name <name>] [--artifactId <id>] [--access private|org_shared] [--json]

Uploads an HTML file. Without --artifactId it creates a new artifact and prints
only its id. With --artifactId it replaces that artifact's content and prints the same id.
--name sets the name shown in the library. Omit it and the name is the file name
without .html or .htm. On replace, omit --name to keep the current name.

Options:
  --name <name>                  Name shown in the library. One line, up to 120 characters.
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

export const LIST_HELP = `Usage: factrove list [--view mine|org] [--json]

Lists artifacts. The default is the caller's own artifacts. --view org lists
organization-shared artifacts in the caller's current organization.

Options:
  --view <mine|org>  Which artifacts to list (default: mine).
  --json             Print one JSON line.
`;

export const RENAME_HELP = `Usage: factrove rename <id> --name <name> [--json]

Changes the name shown in the library. The stored HTML is left as it is.
Quote a name that contains spaces.

Options:
  --name <name>  Name shown in the library. One line, up to 120 characters.
  --json         Print one JSON line.
`;

export const DELETE_HELP = `Usage: factrove delete <id> [--yes | --force] [--json]

Deletes an artifact, its stored HTML, and any public link. A terminal asks
for confirmation. --yes and --force skip that prompt.

Options:
  --yes    Delete without a confirmation prompt.
  --force  Same as --yes.
  --json   Print one JSON line.
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
  list: LIST_HELP,
  rename: RENAME_HELP,
  delete: DELETE_HELP,
  configure: CONFIGURE_HELP,
} as const;

export const cliFlags: readonly CliFlagSpec[] = [
  {
    id: "name",
    names: ["--name"],
    kind: "string",
    store: "name",
    documented: true,
    description: "Name shown in the library. One line, up to 120 characters.",
    appliesTo: ["upload", "rename"],
  },
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
    id: "view",
    names: ["--view"],
    kind: "enum",
    values: ["mine", "org"],
    store: "view",
    documented: true,
    description: "Which artifacts to list (default: mine).",
    appliesTo: ["list"],
  },
  {
    id: "yes",
    names: ["--yes"],
    kind: "boolean",
    store: "yes",
    documented: true,
    description: "Delete without a confirmation prompt.",
    appliesTo: ["delete"],
  },
  {
    id: "force",
    names: ["--force"],
    kind: "boolean",
    store: "force",
    documented: true,
    description: "Same as --yes. Delete without a confirmation prompt.",
    appliesTo: ["delete"],
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
    appliesTo: ["upload", "get", "share", "list", "rename", "delete"],
  },
  {
    id: "output",
    names: ["--output"],
    kind: "enum",
    values: ["json", "text"],
    store: "output",
    documented: true,
    description: "Print one JSON line when the value is json. --output text is the plain output.",
    appliesTo: ["upload", "get", "share", "list", "rename", "delete"],
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
    description:
      "Accepted on upload, get, share, list, rename, and delete. It does not hide their output. Help does not list it. configure rejects it.",
    appliesTo: ["upload", "get", "share", "list", "rename", "delete"],
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
      "Without --artifactId it creates a new artifact and prints only its id. With --artifactId it replaces that artifact's content and prints the same id. --name sets the name shown in the library. Omit it and the name is the file name without .html or .htm. On replace, omit --name to keep the current name.",
    positionals: [{ name: "file", required: true, description: "Local .html or .htm file." }],
    flags: ["name", "artifactId", "access", "json", "output", "apiUrl", "profile"],
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
    name: "list",
    summary: "List your artifacts. --view org lists organization-shared ones.",
    description:
      "Lists artifacts. The default is the caller's own artifacts. --view org lists organization-shared artifacts in the caller's current organization.",
    positionals: [],
    flags: ["view", "json", "output", "apiUrl", "profile"],
    helpText: LIST_HELP,
    docsSlug: "list",
  },
  {
    name: "rename",
    summary: "Change the name shown in the library.",
    description: "Changes the name shown in the library. The stored HTML is left as it is. Quote a name that contains spaces.",
    positionals: [{ name: "id", required: true, description: "Artifact UUID." }],
    flags: ["name", "json", "output", "apiUrl", "profile"],
    helpText: RENAME_HELP,
    docsSlug: "rename",
  },
  {
    name: "delete",
    summary: "Delete an artifact. --yes skips the confirmation.",
    description:
      "Deletes an artifact, its stored HTML, and any public link. A terminal asks for confirmation. --yes and --force skip that prompt.",
    positionals: [{ name: "id", required: true, description: "Artifact UUID." }],
    flags: ["yes", "force", "json", "output", "apiUrl", "profile"],
    helpText: DELETE_HELP,
    docsSlug: "delete",
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
  list: [
    "## Behavior",
    "",
    "Plain success prints one line per artifact: id, access (`private` or `org_shared`), then the library name. A null name uses the public filename `{id}.html`. An empty list prints nothing. `--json` prints one `{ items }` line.",
    "",
    "`--view mine` is the default and lists artifacts the caller created. `--view org` lists organization-shared artifacts in the caller's current organization. With no current organization that list is empty.",
    "",
    "The CLI does not keep a local index. List reads the API.",
    "",
    "## Related",
    "",
    "- [CLI](/guides/cli)",
    "- [List artifacts for the caller](/api-reference/artifacts/list-artifacts-for-the-caller)",
  ].join("\n"),
  rename: [
    "## Behavior",
    "",
    "Plain success prints `Renamed {id}.` `--json` prints one `{ artifact }` line. The stored HTML, access, and any public link stay as they are. There is no way to clear a name.",
    "",
    "`--name` uses the same one-line, 120-character rule as upload. Only the owner can rename. Anyone else gets `404 ARTIFACT_NOT_FOUND`, including an organization admin.",
    "",
    "## Related",
    "",
    "- [CLI](/guides/cli)",
    "- [Rename an artifact](/api-reference/artifacts/rename-an-artifact)",
  ].join("\n"),
  delete: [
    "## Behavior",
    "",
    "Plain success prints `Deleted {id}.` `--json` prints one line, `{\"deleted\":true,\"id\":\"…\"}`. The API response itself is empty.",
    "",
    "A terminal asks `Delete artifact {id}?` and continues only for `y` or `yes`. Anything else cancels. When stdin is not a terminal, pass `--yes` or `--force`. Those two flags do the same thing.",
    "",
    "Delete removes the artifact row and the current HTML object. A public link stops working. The CLI does not keep a local index such as `factrove.md`, so there is no local file to update. Only the owner can delete. Anyone else gets `404 ARTIFACT_NOT_FOUND`, including an organization admin. A storage failure keeps the artifact row. The stored HTML may already be gone, so retry the delete.",
    "",
    "## Related",
    "",
    "- [CLI](/guides/cli)",
    "- [Delete an artifact](/api-reference/artifacts/delete-an-artifact)",
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
