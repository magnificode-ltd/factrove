import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import { apiKeyForInvocation, cliWantsJson, DEFAULT_API_URL, parseCliArgs } from "../src/parse-args.js";

const file = "./report.html";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";
const isolated = { FACTROVE_CONFIG_DIR: "/tmp/factrove-parse-missing-7044" };

describe("CLI argument parsing", () => {
  it("defaults access to private and the API origin to localhost", () => {
    expect(parseCliArgs(["upload", file], isolated)).toEqual({
      kind: "upload",
      path: file,
      access: "private",
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
    expect(parseCliArgs(["--help"], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["upload", "-h", file], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["help"], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["--not-real", "--help"], {})).toEqual({ kind: "help" });
  });

  it("keeps a path named help when it is the upload argument", () => {
    expect(upload(["upload", "help"])).toMatchObject({ path: "help" });
    expect(upload(["upload", "--", "--json"])).toMatchObject({ path: "--json" });
  });

  it("rejects incomplete and unknown invocations", () => {
    expect(failure([], {}).message).toMatch(/Missing command/);
    expect(failure(["list"], {}).message).toMatch(/Unknown command/);
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
  it("defaults format to html and the API origin to localhost", () => {
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
    expect(failure(["cp", "a.html", "factrove://mine/", "--password"], {}).message).toMatch(/only valid for the share command/);
    expect(parseCliArgs(["share", artifactId, "--output", "json"], isolated)).toMatchObject({ json: true, output: "json" });
    expect(failure(["get", artifactId, "--remove-password"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["configure", "--password-stdin"], {}).message).toMatch(/only valid for the share command/);
  });
});

describe("aws s3 command arguments", () => {
  it("maps endpoint-url, output, and profile the way flags override the environment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "factrove-s3-args-"));
    try {
      await writeFile(join(directory, "config"), "[profile dev]\nendpoint_url = https://from-endpoint.example\n");
      const env = { FACTROVE_CONFIG_DIR: directory };
      expect(parseCliArgs(["cp", "a.html", "factrove://mine/", "--profile", "dev"], env)).toMatchObject({
        kind: "cp",
        profile: "dev",
        profileExplicit: true,
        apiUrl: "https://from-endpoint.example",
      });
      expect(parseCliArgs(["cp", "a.html", "factrove://mine/", "--profile", "dev"], { ...env, FACTROVE_ENDPOINT_URL: "http://from-env" })).toMatchObject({
        apiUrl: "http://from-env",
      });
      expect(parseCliArgs(["upload", file], { ...env, FACTROVE_ENDPOINT_URL: "http://endpoint", FACTROVE_API_URL: "http://api" })).toMatchObject({
        apiUrl: "http://api",
      });
      expect(parseCliArgs(["get", artifactId, "--endpoint-url", "http://flag"], { ...env, FACTROVE_API_URL: "http://api" })).toMatchObject({
        apiUrl: "http://flag",
      });
      expect(parseCliArgs(["cp", "a.html", "factrove://mine/", "--api-url", "http://same", "--endpoint-url", "http://same"], env)).toMatchObject({
        kind: "cp",
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
    const directory = await mkdtemp(join(tmpdir(), "factrove-s3-profile-"));
    try {
      await writeFile(join(directory, "config"), "[default]\napi_url = https://api.example\nendpoint_url = https://endpoint.example\n");
      expect(parseCliArgs(["cp", "a.html", "factrove://mine/"], { FACTROVE_CONFIG_DIR: directory })).toMatchObject({
        apiUrl: "https://api.example",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("parses cp as the s3 name for upload and get", () => {
    expect(parseCliArgs(["s3", "cp", "./a.html", "factrove://org/", "--quiet"], isolated)).toEqual({
      kind: "cp",
      source: "./a.html",
      destination: "factrove://org/",
      format: "html",
      json: false,
      ...plainCommand(),
      quiet: true,
    });
    expect(parseCliArgs(["cp", "factrove://mine/" + artifactId, "-", "--format", "markdown", "--output", "json"], isolated)).toMatchObject({
      kind: "cp",
      source: `factrove://mine/${artifactId}`,
      destination: "-",
      format: "markdown",
      json: true,
      output: "json",
    });
    expect(parseCliArgs(["cp", `factrove://MINE/${artifactId}.html`, "./out.html"], isolated)).toMatchObject({
      source: `factrove://MINE/${artifactId}.html`,
      destination: "./out.html",
    });
    expect(parseCliArgs(["upload", file, "--output", "json", "--quiet"], isolated)).toMatchObject({
      kind: "upload",
      json: true,
      output: "json",
      quiet: true,
    });
    expect(parseCliArgs(["get", artifactId, "--output", "text"], isolated)).toMatchObject({
      kind: "get",
      json: false,
      output: "text",
    });
    expect(parseCliArgs(["s3", "help"], isolated)).toEqual({ kind: "help" });
  });

  it("rejects commands and flags the CLI does not have", () => {
    expect(failure(["ls"], {}).message).toMatch(/Unknown command 'ls'/);
    expect(failure(["rm", `factrove://mine/${artifactId}`], {}).message).toMatch(/Unknown command 'rm'/);
    expect(failure(["presign", `factrove://mine/${artifactId}`], {}).message).toMatch(/Unknown command 'presign'/);
    expect(failure(["mv", "a", "b"], {}).message).toMatch(/Unknown command 'mv'/);
    expect(failure(["cp"], {}).message).toMatch(/source and a destination/);
    expect(failure(["cp", "a.html", "factrove://mine/", "extra"], {}).message).toMatch(/extra arguments/);
    expect(failure(["cp", "a.html", "factrove://mine/", "--format", "markdown"], {}).message).toMatch(/only valid when copying an artifact/);
    expect(failure(["cp", "a.html", "factrove://mine/", "--access", "private"], {}).message).toMatch(/URI scope/);
    expect(failure(["cp", `factrove://mine/${artifactId}`, "-", "--revoke"], {}).message).toMatch(/only valid for the share command/);
    expect(failure(["upload", file, "--json", "--output", "text"], {}).message).toMatch(/conflicts/);
    expect(failure(["upload", file, "--output", "text", "--json"], {}).message).toMatch(/conflicts/);
    expect(failure(["upload", "-"], {}).message).toMatch(/Unknown option '-'/);
    expect(failure(["get", "-"], {}).message).toMatch(/Unknown option '-'/);
    expect(failure(["s3", "upload", file], {}).message).toMatch(/only accepts cp/);
    expect(failure(["s3", "get", artifactId], {}).message).toMatch(/only accepts cp/);
    expect(failure(["s3", "share", artifactId], {}).message).toMatch(/only accepts cp/);
    expect(failure(["cp", "--output", "table", "a.html", "factrove://mine/"], {}).message).toMatch(/json or text/);
    expect(failure(["cp", "--endpoint-url", "http://a", "--api-url", "http://b", "a.html", "factrove://mine/"], {}).message).toMatch(/different values/);
    expect(failure(["cp", "a.html", "factrove://mine/", "--query", "id"], {}).message).toMatch(/Unknown option/);
    expect(parseCliArgs(["upload", "--", "-"], isolated)).toMatchObject({ kind: "upload", path: "-" });
    expect(parseCliArgs(["cp", "-", "factrove://mine/"], isolated)).toMatchObject({ kind: "cp", source: "-", destination: "factrove://mine/" });
    expect(cliWantsJson(["cp", "--output", "json", "a.html", "factrove://mine/"])).toBe(true);
    expect(cliWantsJson(["cp", "--output", "text", "--json", "a.html", "factrove://mine/"])).toBe(true);
    expect(cliWantsJson(["cp", "--json", "--output", "text", "a.html", "factrove://mine/"])).toBe(true);
    expect(cliWantsJson(["cp", "--output", "text", "a.html", "factrove://mine/"])).toBe(false);
    expect(cliWantsJson(["cp", "--output=json", "a.html", "factrove://mine/"])).toBe(true);
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
