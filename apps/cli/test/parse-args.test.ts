import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCliReferencePages } from "../src/cli-docs.js";
import { APPROVED_HELP } from "../src/command-spec.js";
import { CliError } from "../src/cli-error.js";
import { apiKeyForInvocation, cliWantsJson, DEFAULT_API_URL, helpText, parseCliArgs } from "../src/parse-args.js";

const file = "./report.html";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const isolated = { FACTROVE_CONFIG_DIR: "/tmp/factrove-parse-missing-7044" };

describe("CLI argument parsing", () => {
  it("defaults access to private and the API origin to the hosted Factrove API", () => {
    expect(DEFAULT_API_URL).toBe("https://api.factrove.app");
    expect(parseCliArgs(["upload", file], isolated)).toEqual({
      kind: "upload",
      path: file,
      access: "private",
      artifactId: null,
      name: null,
      json: false,
      ...plainCommand(),
    });
  });

  it("uses FACTROVE_API_URL when --api-url is omitted", () => {
    expect(upload(["upload", file], { FACTROVE_API_URL: "http://127.0.0.1:4010" }).apiUrl).toBe(
      "http://127.0.0.1:4010",
    );
  });

  it("lets --api-url override FACTROVE_API_URL and ignores a blank environment value", () => {
    const env = { FACTROVE_API_URL: "http://127.0.0.1:4010" };
    expect(upload(["upload", file, "--api-url", "http://127.0.0.1:4020"], env).apiUrl).toBe("http://127.0.0.1:4020");
    expect(upload(["upload", file, "--api-url=http://127.0.0.1:4030"], env).apiUrl).toBe("http://127.0.0.1:4030");
    expect(upload(["upload", file], { FACTROVE_API_URL: "   " }).apiUrl).toBe(DEFAULT_API_URL);
  });

  it("uses a dev file URL only after the environment and the selected profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-parse-profile-"));
    try {
      await writeFile(join(directory, "config"), "[profile prod]\napi_url = https://prod.example\n");
      const env = { FACTROVE_CONFIG_DIR: directory, FACTROVE_DEV_API_URL: "http://127.0.0.1:9" };
      expect(upload(["upload", file, "--profile", "prod"], env).apiUrl).toBe("https://prod.example");
      expect(upload(["upload", file], { ...env, FACTROVE_PROFILE: "prod" }).apiUrl).toBe("https://prod.example");
      expect(upload(["upload", file], env).apiUrl).toBe("http://127.0.0.1:9");
      expect(upload(["upload", file], { ...env, FACTROVE_API_URL: "http://127.0.0.1:8" }).apiUrl).toBe("http://127.0.0.1:8");
      expect(upload(["upload", file, "--api-url", "http://127.0.0.1:7"], env).apiUrl).toBe("http://127.0.0.1:7");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts a library name and keeps it with a replace", () => {
    expect(upload(["upload", file, "--name", "X launch calendar"])).toMatchObject({
      name: "X launch calendar",
      artifactId: null,
    });
    expect(upload(["upload", file, "--name=Hello", "--artifactId", artifactId])).toMatchObject({
      name: "Hello",
      artifactId,
    });
    expect(upload(["upload", "--name", "  padded  ", file]).name).toBe("padded");
    expect(upload(["upload", file, "--name", "e\u0301"]).name).toBe("\u00e9");
    expect(failure(["upload", file, "--name", "a".repeat(121)], {}).message).toBe(
      "name must be one line of 1 to 120 characters.",
    );
    expect(failure(["upload", file, "--name", "hello\nthere"], {}).message).toBe(
      "name must be one line of 1 to 120 characters.",
    );
    expect(failure(["upload", file, "--name", "hello\n"], {}).message).toBe(
      "name must be one line of 1 to 120 characters.",
    );
    expect(failure(["upload", file, "--name", "hello\u2028"], {}).message).toBe(
      "name must be one line of 1 to 120 characters.",
    );
    expect(failure(["upload", file, "--name", "hello\u0085"], {}).message).toBe(
      "name must be one line of 1 to 120 characters.",
    );
    expect(failure(["upload", file, "--name", "   "], {}).message).toBe("Missing value for --name.");
    expect(failure(["upload", file, "--name"], {}).message).toBe("Missing value for --name.");
    expect(failure(["upload", file, "--name", "One", "--name", "Two"], {}).message).toMatch(/more than once/);
    expect(failure(["get", artifactId, "--name", "Nope"], {}).message).toBe(
      "--name is only valid for the upload and rename commands.",
    );
  });

  it("accepts org_shared, json, and flags around the path", () => {
    expect(upload(["--json", "upload", "--access", "org_shared", file])).toMatchObject({
      access: "org_shared",
      json: true,
      path: file,
    });
    expect(upload(["upload", "--access=private", file, "--json"])).toMatchObject({
      access: "private",
      json: true,
    });
  });

  it("treats help flags and the help command as help", () => {
    expect(parseCliArgs(["--help"], {})).toEqual({ kind: "help", command: null });
    expect(parseCliArgs(["upload", "-h", file], {})).toEqual({ kind: "help", command: "upload" });
    expect(parseCliArgs(["get", "--help"], {})).toEqual({ kind: "help", command: "get" });
    expect(parseCliArgs(["share", "--help"], {})).toEqual({ kind: "help", command: "share" });
    expect(parseCliArgs(["configure", "-h"], {})).toEqual({ kind: "help", command: "configure" });
    expect(parseCliArgs(["help"], {})).toEqual({ kind: "help", command: null });
    expect(parseCliArgs(["--not-real", "--help"], {})).toEqual({ kind: "help", command: null });
  });

  it("keeps a path named help when it is the upload argument", () => {
    expect(upload(["upload", "help"])).toMatchObject({ path: "help" });
    expect(upload(["upload", "--", "--json"])).toMatchObject({ path: "--json" });
  });

  it("rejects incomplete and unknown invocations", () => {
    expect(failure([], {}).message).toMatch(/Missing command/);
    expect(failure(["widgets"], {}).message).toMatch(/Unknown command/);
    expect(failure(["upload"], {}).message).toMatch(/Missing file path/);
    expect(failure(["upload", file, "extra.html"], {}).message).toMatch(/extra arguments/);
    expect(failure(["upload", file, "--access"], {}).message).toMatch(/Missing value for --access/);
    expect(failure(["upload", file, "--access", "public"], {}).code).toBe("INVALID_INPUT");
    expect(failure(["upload", file, "--access", "private", "--access", "org_shared"], {}).message).toMatch(/more than once/);
    expect(failure(["upload", file, "--api-url"], {}).message).toMatch(/Missing value for --api-url/);
    expect(failure(["upload", file, "--acl"], {}).message).toMatch(/Unknown option/);
  });

  it("detects --json without treating values or later positionals as flags", () => {
    expect(cliWantsJson(["upload", file, "--json"])).toBe(true);
    expect(cliWantsJson(["upload", file, "--api-url", "http://127.0.0.1:3001", "--json"])).toBe(true);
    expect(cliWantsJson(["upload", file, "--", "--json"])).toBe(false);
    expect(cliWantsJson(["upload", file])).toBe(false);
    expect(cliWantsJson(["get", artifactId, "--format", "markdown", "--json"])).toBe(true);
    expect(cliWantsJson(["get", artifactId, "--format", "markdown"])).toBe(false);
  });
});

describe("factrove get arguments", () => {
  it("defaults format to html and the API origin to the hosted Factrove API", () => {
    expect(parseCliArgs(["get", artifactId], isolated)).toEqual({
      kind: "get",
      id: artifactId,
      format: "html",
      json: false,
      ...plainCommand(),
    });
  });

  it("accepts markdown, json, and the same API origin precedence as upload", () => {
    expect(parseCliArgs(["--json", "get", "--format", "markdown", artifactId], isolated)).toMatchObject({
      kind: "get",
      id: artifactId,
      format: "markdown",
      json: true,
      apiUrl: DEFAULT_API_URL,
    });
    expect(parseCliArgs(["get", artifactId, "--format=html", "--api-url", "http://127.0.0.1:4020"], {
      ...isolated,
      FACTROVE_API_URL: "http://127.0.0.1:4010",
    })).toMatchObject({
      format: "html",
      apiUrl: "http://127.0.0.1:4020",
    });
    expect(parseCliArgs(["get", artifactId.toUpperCase()], { ...isolated, FACTROVE_API_URL: "http://127.0.0.1:4010" })).toMatchObject({
      id: artifactId.toUpperCase(),
      apiUrl: "http://127.0.0.1:4010",
    });
  });

  it("rejects incomplete, conflicting, and unknown get invocations", () => {
    expect(failure(["get"], {}).message).toMatch(/Missing artifact id/);
    expect(failure(["get", "not-a-uuid"], {}).message).toMatch(/UUID/);
    expect(failure(["get", artifactId, "extra"], {}).message).toMatch(/extra arguments/);
    expect(failure(["get", artifactId, "--format"], {}).message).toMatch(/Missing value for --format/);
    expect(failure(["get", artifactId, "--format", "md"], {}).message).toMatch(/html or markdown/);
    expect(failure(["get", artifactId, "--format", "markdown", "--format", "html"], {}).message).toMatch(/more than once/);
    expect(failure(["get", artifactId, "--access", "private"], {}).message).toMatch(/only valid for the upload command/);
    expect(failure(["upload", file, "--format", "markdown"], {}).message).toMatch(/only valid for the get command/);
    expect(failure(["--format", "help"], {}).message).toMatch(/html or markdown/);
  });
});

describe("factrove configure arguments", () => {
  it("suggests the hosted API when no profile or URL is configured", () => {
    expect(parseCliArgs(["configure"], isolated)).toMatchObject({
      kind: "configure",
      apiUrl: undefined,
      suggestedApiUrl: "https://api.factrove.app",
    });
    expect(parseCliArgs(["configure", "--api-url", "http://127.0.0.1:3001"], isolated)).toMatchObject({
      apiUrl: "http://127.0.0.1:3001",
      suggestedApiUrl: "http://127.0.0.1:3001",
    });
    expect(upload(["upload", file], { FACTROVE_API_URL: "http://127.0.0.1:3001" }).apiUrl).toBe(
      "http://127.0.0.1:3001",
    );
    expect(upload(["upload", file], { FACTROVE_ENDPOINT_URL: "http://127.0.0.1:3002" }).apiUrl).toBe(
      "http://127.0.0.1:3002",
    );
  });

  it("keeps the key flag off the resolved upload command", () => {
    expect(failure(["upload", file, "--api-key", "ftrv_secret"], {}).message).toMatch(/only valid for the configure command/);
    const configured = parseCliArgs(["configure", "--profile", "dev", "--api-key", "ftrv_secret"], isolated);
    expect(configured).toMatchObject({ kind: "configure", profile: "dev", apiKey: "ftrv_secret" });
    expect(apiKeyForInvocation(configured, isolated)).toBeUndefined();
  });

  it("lets an explicit --profile beat FACTROVE_API_KEY", () => {
    const explicit = upload(["upload", file, "--profile", "dev"]);
    expect(explicit.profileExplicit).toBe(true);
    expect(apiKeyForInvocation(explicit, { ...isolated, FACTROVE_API_KEY: "ftrv_from_env" })).toBeUndefined();
    const fromEnv = upload(["upload", file]);
    expect(fromEnv.profileExplicit).toBe(false);
    expect(apiKeyForInvocation(fromEnv, { ...isolated, FACTROVE_API_KEY: "ftrv_from_env" })).toBe("ftrv_from_env");
  });
});

describe("factrove share arguments", () => {
  it("shares an artifact and can revoke that link", () => {
    expect(parseCliArgs(["share", artifactId], isolated)).toEqual({
      kind: "share",
      id: artifactId,
      revoke: false,
      password: null,
      removePassword: false,
      json: false,
      ...plainCommand(),
    });
    expect(parseCliArgs(["share", artifactId, "--revoke", "--json"], isolated)).toMatchObject({
      kind: "share",
      revoke: true,
      json: true,
    });
  });

  it("rejects share flags on the other commands", () => {
    expect(failure(["share"], {}).message).toMatch(/Missing artifact id/);
    expect(failure(["share", "not-a-uuid"], {}).message).toMatch(/UUID/);
    expect(failure(["share", artifactId, "--revoke", "--revoke"], {}).message).toMatch(/more than once/);
    expect(failure(["upload", file, "--revoke"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["get", artifactId, "--revoke"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["share", artifactId, "--access", "private"], {}).message).toMatch(/only valid for the upload command/);
    expect(failure(["configure", "--revoke"], {}).message).toMatch(/configure accepts/);
    expect(failure(["configure", "--endpoint-url", "http://127.0.0.1:9", "--quiet"], {}).message).toMatch(/configure accepts/);
  });

  it("reads link passwords from a prompt or stdin, never from an argument", () => {
    expect(parseCliArgs(["share", artifactId, "--password"], isolated)).toMatchObject({
      password: "prompt",
      removePassword: false,
      revoke: false,
    });
    expect(parseCliArgs(["share", artifactId, "--password-stdin", "--json"], isolated)).toMatchObject({
      password: "stdin",
      json: true,
    });
    expect(parseCliArgs(["share", artifactId, "--remove-password"], isolated)).toMatchObject({
      password: null,
      removePassword: true,
    });

    const inline = failure(["share", artifactId, "--password=hunter2hunter2"], {});
    expect(inline.message).toMatch(/not accepted as arguments/);
    expect(inline.message).not.toContain("hunter2");
    const spaced = failure(["share", artifactId, "--password", "hunter2hunter2"], {});
    expect(spaced.message).toMatch(/--password takes no value/);
    expect(spaced.message).not.toContain("hunter2");
  });

  it("rejects conflicting or misplaced password options", () => {
    expect(failure(["share", artifactId, "--password", "--password-stdin"], {}).message).toMatch(/more than once/);
    expect(failure(["share", artifactId, "--remove-password", "--remove-password"], {}).message).toMatch(/more than once/);
    expect(failure(["share", artifactId, "--password", "--revoke"], {}).message).toMatch(/only one of/);
    expect(failure(["share", artifactId, "--password-stdin", "--remove-password"], {}).message).toMatch(/only one of/);
    expect(failure(["share", artifactId, "--remove-password", "--revoke"], {}).message).toMatch(/only one of/);
    expect(failure(["upload", file, "--password"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["upload", file, "--artifactId", "not-a-uuid"], {}).message).toMatch(/UUID/);
    expect(failure(["upload", file, "--artifactId", artifactId, "--access", "private"], {}).message).toMatch(/cannot be used with --artifactId/);
    expect(failure(["get", artifactId, "--artifactId", artifactId], {}).message).toMatch(/only valid for the upload command/);
    expect(parseCliArgs(["upload", file, "--artifactId", artifactId, "--json"], isolated)).toMatchObject({
      kind: "upload",
      artifactId,
      access: "private",
      json: true,
    });
    expect(parseCliArgs(["share", artifactId, "--output", "json"], isolated)).toMatchObject({ json: true, output: "json" });
    expect(failure(["get", artifactId, "--remove-password"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["configure", "--password-stdin"], {}).message).toMatch(/only valid for the share command/);
  });
});

describe("endpoint and output flags", () => {
  it("maps endpoint-url, output, and profile the way flags override the environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-endpoint-args-"));
    try {
      await writeFile(join(directory, "config"), "[profile dev]\nendpoint_url = https://from-endpoint.example\n");
      const env = { FACTROVE_CONFIG_DIR: directory };
      expect(parseCliArgs(["upload", file, "--profile", "dev"], env)).toMatchObject({
        kind: "upload",
        profile: "dev",
        profileExplicit: true,
        apiUrl: "https://from-endpoint.example",
      });
      expect(parseCliArgs(["upload", file, "--profile", "dev"], { ...env, FACTROVE_ENDPOINT_URL: "http://from-env" })).toMatchObject({
        apiUrl: "http://from-env",
      });
      expect(parseCliArgs(["upload", file], { ...env, FACTROVE_ENDPOINT_URL: "http://endpoint", FACTROVE_API_URL: "http://api" })).toMatchObject({
        apiUrl: "http://api",
      });
      expect(parseCliArgs(["get", artifactId, "--endpoint-url", "http://flag"], { ...env, FACTROVE_API_URL: "http://api" })).toMatchObject({
        apiUrl: "http://flag",
      });
      expect(parseCliArgs(["upload", file, "--api-url", "http://same", "--endpoint-url", "http://same"], env)).toMatchObject({
        kind: "upload",
        apiUrl: "http://same",
      });
      expect(parseCliArgs(["configure", "--endpoint-url", "http://127.0.0.1:9", "--api-key", "ftrv_secret"], env)).toMatchObject({
        kind: "configure",
        apiUrl: "http://127.0.0.1:9",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prefers api_url over endpoint_url in the same profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-endpoint-profile-"));
    try {
      await writeFile(join(directory, "config"), "[default]\napi_url = https://api.example\nendpoint_url = https://endpoint.example\n");
      expect(parseCliArgs(["upload", file], { FACTROVE_CONFIG_DIR: directory })).toMatchObject({
        apiUrl: "https://api.example",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats --output json as --json and still accepts --quiet", () => {
    expect(parseCliArgs(["upload", file, "--output", "json", "--quiet"], isolated)).toMatchObject({
      kind: "upload",
      json: true,
      output: "json",
      quiet: true,
      artifactId: null,
    });
    expect(parseCliArgs(["get", artifactId, "--output", "text"], isolated)).toMatchObject({
      kind: "get",
      json: false,
      output: "text",
    });
    expect(cliWantsJson(["upload", "--output", "json", file])).toBe(true);
    expect(cliWantsJson(["upload", "--output", "text", "--json", file])).toBe(true);
    expect(cliWantsJson(["upload", "--json", "--output", "text", file])).toBe(true);
    expect(cliWantsJson(["upload", "--output", "text", file])).toBe(false);
    expect(cliWantsJson(["upload", "--output=json", file])).toBe(true);
  });

  it("rejects commands and flags the CLI does not have", () => {
    expect(failure(["ls"], {}).message).toMatch(/Unknown command 'ls'/);
    expect(failure(["rm", artifactId], {}).message).toMatch(/Unknown command 'rm'/);
    expect(failure(["presign", artifactId], {}).message).toMatch(/Unknown command 'presign'/);
    expect(failure(["cp", file, "dest"], {}).message).toMatch(/Unknown command 'cp'/);
    expect(failure(["s3", "cp", file, "dest"], {}).message).toMatch(/Unknown command 's3'/);
    expect(failure(["mv", "a", "b"], {}).message).toMatch(/Unknown command 'mv'/);
    expect(failure(["upload", file, "--json", "--output", "text"], {}).message).toMatch(/conflicts/);
    expect(failure(["upload", file, "--output", "text", "--json"], {}).message).toMatch(/conflicts/);
    expect(failure(["upload", "-"], {}).message).toMatch(/Unknown option '-'/);
    expect(failure(["get", "-"], {}).message).toMatch(/Unknown option '-'/);
    expect(failure(["upload", "--output", "table", file], {}).message).toMatch(/json or text/);
    expect(failure(["upload", "--endpoint-url", "http://a", "--api-url", "http://b", file], {}).message).toMatch(/different values/);
    expect(failure(["upload", file, "--query", "id"], {}).message).toMatch(/Unknown option/);
    expect(parseCliArgs(["upload", "--", "-"], isolated)).toMatchObject({ kind: "upload", path: "-" });
  });

  it("parses list, rename, and delete", () => {
    expect(parseCliArgs(["list"], isolated)).toMatchObject({ kind: "list", view: "mine", json: false });
    expect(parseCliArgs(["list", "--view", "org", "--json"], isolated)).toMatchObject({
      kind: "list",
      view: "org",
      json: true,
    });
    expect(parseCliArgs(["list", "--view=mine"], isolated)).toMatchObject({ kind: "list", view: "mine" });
    expect(parseCliArgs(["rename", artifactId, "--name", "  Launch notes  "], isolated)).toEqual({
      kind: "rename",
      id: artifactId,
      name: "Launch notes",
      json: false,
      ...plainCommand(),
    });
    expect(parseCliArgs(["delete", artifactId, "--yes"], isolated)).toMatchObject({
      kind: "delete",
      id: artifactId,
      skipConfirm: true,
    });
    expect(parseCliArgs(["delete", artifactId, "--force"], isolated)).toMatchObject({ skipConfirm: true });
    expect(parseCliArgs(["delete", artifactId], isolated)).toMatchObject({ skipConfirm: false });
    expect(parseCliArgs(["list", "--help"], isolated)).toEqual({ kind: "help", command: "list" });
    expect(parseCliArgs(["rename", "--help"], isolated)).toEqual({ kind: "help", command: "rename" });
    expect(parseCliArgs(["delete", "-h"], isolated)).toEqual({ kind: "help", command: "delete" });
    expect(failure(["list", "--view", "public"], {}).message).toBe("view must be mine or org.");
    expect(failure(["list", "extra"], {}).message).toMatch(/extra arguments/);
    expect(failure(["upload", file, "--view", "mine"], {}).message).toBe("--view is only valid for the list command.");
    expect(failure(["rename", artifactId], {}).message).toMatch(/Missing --name/);
    expect(failure(["rename", "not-a-uuid", "--name", "Notes"], {}).message).toBe("Artifact id must be a UUID.");
    expect(failure(["delete"], {}).message).toMatch(/Missing artifact id/);
    expect(failure(["get", artifactId, "--yes"], {}).message).toBe(
      "--yes and --force are only valid for the delete command.",
    );
    expect(failure(["delete", artifactId, "--yes", "--yes"], {}).message).toMatch(/more than once/);
  });
});

function plainCommand() {
  return {
    output: "text" as const,
    quiet: false,
    apiUrl: DEFAULT_API_URL,
    profile: "default",
    profileExplicit: false,
  };
}

describe("approved help text", () => {
  it("matches Tom's factrove --help pages word for word", () => {
    expect(helpText()).toBe(TOM_APPROVED_HELP.top);
    expect(helpText("upload")).toBe(TOM_APPROVED_HELP.upload);
    expect(helpText("get")).toBe(TOM_APPROVED_HELP.get);
    expect(helpText("share")).toBe(TOM_APPROVED_HELP.share);
    expect(helpText("list")).toBe(TOM_APPROVED_HELP.list);
    expect(helpText("rename")).toBe(TOM_APPROVED_HELP.rename);
    expect(helpText("delete")).toBe(TOM_APPROVED_HELP.delete);
    expect(helpText("configure")).toBe(TOM_APPROVED_HELP.configure);
    expect(APPROVED_HELP).toEqual(TOM_APPROVED_HELP);
  });

  it("reprints those pages in the generated CLI reference", () => {
    const pages = Object.fromEntries(renderCliReferencePages().map((page) => [page.slug, page.mdx]));
    expect(helpFence(pages.help)).toBe(TOM_APPROVED_HELP.top);
    expect(helpFence(pages.upload)).toBe(TOM_APPROVED_HELP.upload);
    expect(helpFence(pages.get)).toBe(TOM_APPROVED_HELP.get);
    expect(helpFence(pages.share)).toBe(TOM_APPROVED_HELP.share);
    expect(helpFence(pages.list)).toBe(TOM_APPROVED_HELP.list);
    expect(helpFence(pages.rename)).toBe(TOM_APPROVED_HELP.rename);
    expect(helpFence(pages.delete)).toBe(TOM_APPROVED_HELP.delete);
    expect(helpFence(pages.configure)).toBe(TOM_APPROVED_HELP.configure);
    expect(pages.upload).toContain("--api-url");
    expect(pages.upload).toContain("CONTENT_CONFLICT");
    expect(pages.configure).toContain("create-an-api-key-from-a-session");
  });
});

const TOM_APPROVED_HELP = {
  top: `Usage: factrove <command> [options]

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
`,
  upload: `Usage: factrove upload <file> [--name <name>] [--artifactId <id>] [--access private|org_shared] [--json]

Uploads an HTML file. Without --artifactId it creates a new artifact and prints
only its id. With --artifactId it replaces that artifact's content and prints the same id.
--name sets the name shown in the library. Omit it and the name is the file name
without .html or .htm. On replace, omit --name to keep the current name.

Options:
  --name <name>                  Name shown in the library. One line, up to 120 characters.
  --artifactId <id>              Replace this artifact instead of creating a new one.
  --access <private|org_shared>  Who can see a new artifact (default: private).
  --json                         Print one JSON line.
`,
  get: `Usage: factrove get <id> [--format html|markdown] [--json]

Prints an artifact's content. HTML by default, or Markdown with --format markdown.

Options:
  --format <html|markdown>  Content to print (default: html).
  --json                    Print one JSON line.
`,
  share: `Usage: factrove share <id> [--password | --password-stdin | --remove-password | --revoke] [--json]

Creates a public link, or prints the existing one.

Options:
  --password         Prompt twice for a link password. Needs a terminal.
  --password-stdin   Read the link password from a pipe.
  --remove-password  Keep the link and remove its password.
  --revoke           Remove the public link and its password.
  --json             Print one JSON line.
`,
  list: `Usage: factrove list [--view mine|org] [--json]

Lists artifacts. The default is the caller's own artifacts. --view org lists
organization-shared artifacts in the caller's current organization.

Options:
  --view <mine|org>  Which artifacts to list (default: mine).
  --json             Print one JSON line.
`,
  rename: `Usage: factrove rename <id> --name <name> [--json]

Changes the name shown in the library. The stored HTML is left as it is.
Quote a name that contains spaces.

Options:
  --name <name>  Name shown in the library. One line, up to 120 characters.
  --json         Print one JSON line.
`,
  delete: `Usage: factrove delete <id> [--yes | --force] [--json]

Deletes an artifact, its stored HTML, and any public link. A terminal asks
for confirmation. --yes and --force skip that prompt.

Options:
  --yes    Delete without a confirmation prompt.
  --force  Same as --yes.
  --json   Print one JSON line.
`,
  configure: `Usage: factrove configure [--api-key <key>] [--api-url <origin>] [--profile <name>]

Saves an API key and API URL for a profile. The key belongs to the
organization it was created for. Keys created before that change stopped
working and must be created again at /account/api-keys.

Options:
  --api-key <key>     API key. A prompt keeps it out of shell history.
  --api-url <origin>  API origin (alias: --endpoint-url).
  --profile <name>    Credentials profile (default: default).
`,
} as const;

function helpFence(mdx: string | undefined): string {
  const match = mdx?.match(/```text\n([\s\S]*?)\n```/);
  if (match?.[1] === undefined) {
    throw new Error("generated CLI page is missing a text help fence");
  }
  return `${match[1]}\n`;
}

function upload(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const parsed = parseCliArgs(argv, { ...isolated, ...env });
  if (parsed.kind !== "upload") {
    throw new Error("expected an upload invocation");
  }
  return parsed;
}

function failure(argv: string[], env: NodeJS.ProcessEnv): CliError {
  try {
    parseCliArgs(argv, { ...isolated, ...env });
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error("expected the arguments to be rejected");
}
