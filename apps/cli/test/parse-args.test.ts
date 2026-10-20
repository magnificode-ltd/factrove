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
      apiUrl: DEFAULT_API_URL,
      profile: "default",
      profileExplicit: false,
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
    expect(failure(["upload", file, "--quiet"], {}).message).toMatch(/Unknown option/);
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
      apiUrl: DEFAULT_API_URL,
      profile: "default",
      profileExplicit: false,
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
      json: false,
      apiUrl: DEFAULT_API_URL,
      profile: "default",
      profileExplicit: false,
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
  });
});

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
