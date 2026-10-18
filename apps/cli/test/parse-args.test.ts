import { describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import { cliWantsJson, DEFAULT_API_URL, parseCliArgs } from "../src/parse-args.js";

const file = "./report.html";
const artifactId = "123e4567-e89b-42d3-a456-426614174000";

describe("CLI argument parsing", () => {
  it("defaults access to private and the API origin to localhost", () => {
    expect(parseCliArgs(["upload", file], {})).toEqual({
      kind: "upload",
      path: file,
      access: "private",
      json: false,
      apiUrl: DEFAULT_API_URL,
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
    expect(parseCliArgs(["get", artifactId], {})).toEqual({
      kind: "get",
      id: artifactId,
      format: "html",
      json: false,
      apiUrl: DEFAULT_API_URL,
    });
  });

  it("accepts markdown, json, and the same API origin precedence as upload", () => {
    expect(parseCliArgs(["--json", "get", "--format", "markdown", artifactId], {})).toMatchObject({
      kind: "get",
      id: artifactId,
      format: "markdown",
      json: true,
      apiUrl: DEFAULT_API_URL,
    });
    expect(parseCliArgs(["get", artifactId, "--format=html", "--api-url", "http://127.0.0.1:4020"], {
      FACTROVE_API_URL: "http://127.0.0.1:4010",
    })).toMatchObject({
      format: "html",
      apiUrl: "http://127.0.0.1:4020",
    });
    expect(parseCliArgs(["get", artifactId.toUpperCase()], { FACTROVE_API_URL: "http://127.0.0.1:4010" })).toMatchObject({
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

function upload(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const parsed = parseCliArgs(argv, env);
  if (parsed.kind !== "upload") {
    throw new Error("expected an upload invocation");
  }
  return parsed;
}

function failure(argv: string[], env: NodeJS.ProcessEnv): CliError {
  try {
    parseCliArgs(argv, env);
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error("expected the arguments to be rejected");
}
