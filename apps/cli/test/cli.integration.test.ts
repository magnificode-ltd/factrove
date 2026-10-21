import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { chmod, lstat, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { helpText } from "../src/parse-args.js";

const cliPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const launcherPath = fileURLToPath(new URL("../../../scripts/factrove.mjs", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixturePath = join(repoRoot, "fixtures", "hello.html");

const artifactId = "123e4567-e89b-42d3-a456-426614174000";

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  contentType: string;
  authorization: string;
  body: Buffer;
};

type Stub = {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
};

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("factrove upload", () => {
  it("uploads the file basename and bytes and prints only the artifact id", async () => {
    const fixture = await readFile(fixturePath);
    const stub = await startStub(() => accepted(fixture.byteLength));
    const result = await runCli(["upload", "fixtures/hello.html"], { cwd: repoRoot, env: { FACTROVE_API_URL: stub.url } });

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe(`${artifactId}\n`);
    expect(result.stderr).toBe("");
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("/api/v1/artifacts");
    expect(request?.authorization).toBe("Bearer ftrv_test_key");
    expect(result.stdout).not.toContain("ftrv_test_key");
    expect(request?.contentType).toMatch(/^multipart\/form-data;\s*boundary=/i);
    const parts = multipartParts(request?.contentType ?? "", request?.body ?? Buffer.alloc(0));
    const file = parts.find((part) => part.name === "file");
    const access = parts.find((part) => part.name === "accessType");
    expect(file?.filename).toBe("hello.html");
    expect(file?.data.equals(fixture)).toBe(true);
    expect(access?.data.toString("utf8")).toBe("private");
    expect(request?.body.includes(Buffer.from("fixtures/hello.html"))).toBe(false);
    expect(result.stdout).not.toMatch(/Nest|ERROR|LOG/);
  });

  it("replaces an existing artifact and prints the same id", async () => {
    const fixture = await readFile(fixturePath);
    const stub = await startStub(() => ({ status: 200, body: created(fixture.byteLength) }));
    const result = await runCli(
      ["upload", "fixtures/hello.html", "--artifactId", artifactId, "--output", "text"],
      { cwd: repoRoot, env: { FACTROVE_API_URL: stub.url } },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${artifactId}\n`);
    expect(result.stderr).toBe("");
    expect(stub.requests).toHaveLength(1);
    const request = stub.requests[0];
    expect(request?.method).toBe("PUT");
    expect(request?.url).toBe(`/api/v1/artifacts/${artifactId}/content`);
    const parts = multipartParts(request?.contentType ?? "", request?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "file")?.data.equals(fixture)).toBe(true);
    expect(parts.find((part) => part.name === "accessType")).toBeUndefined();

    const json = await runCli(
      ["upload", "fixtures/hello.html", "--artifactId", artifactId, "--json", "--api-url", stub.url],
      { cwd: repoRoot },
    );
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout).artifact.id).toBe(artifactId);

    const rejected = await runCli(
      ["upload", "fixtures/hello.html", "--artifactId", artifactId, "--access", "org_shared", "--api-url", stub.url],
      { cwd: repoRoot },
    );
    expect(rejected.code).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toMatch(/cannot be used with --artifactId/);
    expect(stub.requests).toHaveLength(2);
  });

  it("sends --name on create and on replace, and omits it when the flag is absent", async () => {
    const stub = await startStub(() => accepted(12));
    const named = await runCli(["upload", fixturePath, "--name", "X launch calendar", "--api-url", stub.url]);
    expect(named.code).toBe(0);
    const createdParts = multipartParts(stub.requests[0]?.contentType ?? "", stub.requests[0]?.body ?? Buffer.alloc(0));
    expect(createdParts.find((part) => part.name === "name")?.data.toString("utf8")).toBe("X launch calendar");

    const replaced = await runCli([
      "upload",
      fixturePath,
      "--artifactId",
      artifactId,
      "--name",
      "Renamed calendar",
      "--api-url",
      stub.url,
    ]);
    expect(replaced.code).toBe(0);
    const replacedParts = multipartParts(stub.requests[1]?.contentType ?? "", stub.requests[1]?.body ?? Buffer.alloc(0));
    expect(stub.requests[1]?.method).toBe("PUT");
    expect(replacedParts.find((part) => part.name === "name")?.data.toString("utf8")).toBe("Renamed calendar");

    const kept = await runCli(["upload", fixturePath, "--artifactId", artifactId, "--api-url", stub.url]);
    expect(kept.code).toBe(0);
    const keptParts = multipartParts(stub.requests[2]?.contentType ?? "", stub.requests[2]?.body ?? Buffer.alloc(0));
    expect(keptParts.find((part) => part.name === "name")).toBeUndefined();
  });

  it("sends org_shared and prints the response envelope on one line", async () => {
    const directory = await makeTemp();
    const source = join(directory, "my report.html");
    const contents = Buffer.from("<h1>Report</h1>");
    await writeFile(source, contents);
    const body = created(contents.byteLength, "org_shared");
    const stub = await startStub(() => ({ status: 201, body }));
    const result = await runCli(["upload", source, "--access", "org_shared", "--json", "--api-url", stub.url]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${JSON.stringify(body)}\n`);
    expect(JSON.parse(result.stdout)).toEqual(body);
    const request = stub.requests[0];
    const parts = multipartParts(request?.contentType ?? "", request?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "file")).toMatchObject({ filename: "my report.html" });
    expect(parts.find((part) => part.name === "file")?.data.equals(contents)).toBe(true);
    expect(parts.find((part) => part.name === "accessType")?.data.toString("utf8")).toBe("org_shared");
    expect(parts.find((part) => part.name === "name")).toBeUndefined();
    expect(request?.body.includes(Buffer.from(directory))).toBe(false);
  });

  it("prefers --api-url over FACTROVE_API_URL and accepts an origin that already includes /api/v1", async () => {
    const selected = await startStub(() => accepted(1));
    const ignored = await startStub(() => {
      throw new Error("FACTROVE_API_URL was used instead of --api-url");
    });
    const preferred = await runCli(
      ["upload", fixturePath, "--api-url", `${selected.url}/api/v1`],
      { env: { FACTROVE_API_URL: ignored.url } },
    );
    expect(preferred.code).toBe(0);
    expect(selected.requests).toHaveLength(1);
    expect(selected.requests[0]?.url).toBe("/api/v1/artifacts");
    expect(ignored.requests).toHaveLength(0);

    const fromEnv = await runCli(["upload", fixturePath], { env: { FACTROVE_API_URL: selected.url } });
    expect(fromEnv.code).toBe(0);
    expect(selected.requests).toHaveLength(2);
  });

  it("sends an explicit profile's key to that profile's origin when the dev env file names another origin", async () => {
    const profileStub = await startStub(() => accepted(1));
    const fileStub = await startStub(() => {
      throw new Error("the dev env file origin received the profile key");
    });
    const directory = await makeTemp();
    await writeProfile(directory, "prod", "ftrv_PROD_SECRET", profileStub.url);
    const envFile = await writeCliEnvFile(
      [
        `FACTROVE_API_URL=${fileStub.url}`,
        "FACTROVE_API_KEY=ftrv_from_file",
        "FACTROVE_PROFILE=default",
        "FACTROVE_CONFIG_DIR=/tmp/should-not-redirect",
        "DATABASE_URL=postgresql://secret",
      ].join("\n"),
    );
    const result = await runLauncher(["upload", fixturePath, "--profile", "prod"], {
      env: devFileEnv(envFile, directory, { FACTROVE_API_KEY: "ftrv_from_env" }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("ftrv_PROD_SECRET");
    expect(result.stdout).not.toContain("ftrv_from_file");
    expect(profileStub.requests).toHaveLength(1);
    expect(profileStub.requests[0]?.authorization).toBe("Bearer ftrv_PROD_SECRET");
    expect(fileStub.requests).toHaveLength(0);
  });

  it("keeps a profile selected by FACTROVE_PROFILE ahead of the dev env file origin", async () => {
    const profileStub = await startStub(() => accepted(1));
    const fileStub = await startStub(() => {
      throw new Error("the dev env file origin received the profile key");
    });
    const directory = await makeTemp();
    await writeProfile(directory, "prod", "ftrv_PROD_SECRET", profileStub.url);
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${fileStub.url}\nFACTROVE_PROFILE=default\nFACTROVE_API_KEY=ftrv_from_file\n`);
    const result = await runLauncher(["upload", fixturePath], {
      env: devFileEnv(envFile, directory, { FACTROVE_PROFILE: "prod", FACTROVE_API_KEY: "" }),
    });

    expect(result.code).toBe(0);
    expect(profileStub.requests).toHaveLength(1);
    expect(profileStub.requests[0]?.authorization).toBe("Bearer ftrv_PROD_SECRET");
    expect(fileStub.requests).toHaveLength(0);
  });

  it("lets FACTROVE_PROFILE from the dev env file select a profile whose api_url wins over that file", async () => {
    const profileStub = await startStub(() => accepted(1));
    const fileStub = await startStub(() => {
      throw new Error("the dev env file origin received the profile key");
    });
    const directory = await makeTemp();
    await writeProfile(directory, "prod", "ftrv_PROD_SECRET", profileStub.url);
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${fileStub.url}\nFACTROVE_PROFILE=prod\nFACTROVE_API_KEY=ftrv_from_file\n`);
    const result = await runLauncher(["upload", fixturePath], {
      env: devFileEnv(envFile, directory, { FACTROVE_API_KEY: "" }),
    });

    expect(result.code).toBe(0);
    expect(profileStub.requests).toHaveLength(1);
    expect(profileStub.requests[0]?.authorization).toBe("Bearer ftrv_PROD_SECRET");
    expect(fileStub.requests).toHaveLength(0);
  });

  it("uses the dev env file origin when the selected profile has no api_url", async () => {
    const stub = await startStub(() => accepted(1));
    const directory = await makeTemp();
    await writeProfile(directory, "default", "ftrv_from_profile");
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${stub.url}\nFACTROVE_API_KEY=ftrv_from_file\nDATABASE_URL=postgresql://secret\n`);
    const result = await runLauncher(["upload", fixturePath], {
      env: devFileEnv(envFile, directory, { FACTROVE_API_KEY: "" }),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain("ftrv_from_profile");
    expect(result.stdout).not.toContain("ftrv_from_file");
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.authorization).toBe("Bearer ftrv_from_profile");
  });

  it("lets --api-url and FACTROVE_API_URL win over the dev env file", async () => {
    const selected = await startStub(() => accepted(1));
    const fromFile = await startStub(() => {
      throw new Error("the dev env file was used instead of the flag or the environment");
    });
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${fromFile.url}\nFACTROVE_API_KEY=ftrv_from_file\n`);
    const flagged = await runLauncher(["upload", fixturePath, "--api-url", selected.url], {
      env: devFileEnv(envFile, undefined, {}),
    });
    expect(flagged.code).toBe(0);
    expect(selected.requests).toHaveLength(1);
    expect(selected.requests[0]?.authorization).toBe("Bearer ftrv_test_key");
    expect(fromFile.requests).toHaveLength(0);

    const fromEnv = await runLauncher(["upload", fixturePath], {
      env: devFileEnv(envFile, undefined, { FACTROVE_API_URL: selected.url, FACTROVE_API_KEY: "ftrv_from_env" }),
    });
    expect(fromEnv.code).toBe(0);
    expect(selected.requests).toHaveLength(2);
    expect(selected.requests[1]?.authorization).toBe("Bearer ftrv_from_env");
    expect(fromFile.requests).toHaveLength(0);
  });

  it("ignores an API key in the dev env file", async () => {
    const stub = await startStub(() => {
      throw new Error("the dev env file supplied an API key");
    });
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${stub.url}\nFACTROVE_API_KEY=ftrv_from_file\n`);
    const result = await runLauncher(["upload", fixturePath], {
      env: devFileEnv(envFile, undefined, { FACTROVE_API_KEY: "" }),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("An API key is required");
    expect(result.stderr).not.toContain("ftrv_from_file");
    expect(stub.requests).toHaveLength(0);
  });

  it("ignores the dev env file when the built CLI is started directly", async () => {
    const profileStub = await startStub(() => accepted(1));
    const fileStub = await startStub(() => {
      throw new Error("dist/main.js read the dev env file");
    });
    const directory = await makeTemp();
    await writeProfile(directory, "prod", "ftrv_PROD_SECRET", profileStub.url);
    const envFile = await writeCliEnvFile(`FACTROVE_API_URL=${fileStub.url}\nFACTROVE_API_KEY=ftrv_from_file\nFACTROVE_PROFILE=default\n`);
    const built = await readFile(cliPath, "utf8");
    expect(built).not.toContain("loadCliEnv");
    expect(built).not.toContain("parseEnv");
    const result = await runCli(["upload", fixturePath, "--profile", "prod"], {
      env: devFileEnv(envFile, directory, { FACTROVE_API_KEY: "ftrv_from_env" }),
    });

    expect(result.code).toBe(0);
    expect(profileStub.requests).toHaveLength(1);
    expect(profileStub.requests[0]?.authorization).toBe("Bearer ftrv_PROD_SECRET");
    expect(fileStub.requests).toHaveLength(0);
  });

  it("prints help when the dev env file cannot be read", async () => {
    const unreadable = await unreadableEnvPath();
    const help = await runLauncher(["--help"], { env: { FACTROVE_CLI_ENV_FILE: unreadable } });
    expect(help.code).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toBe(helpText(null));

    const commandHelp = await runLauncher(["upload", "--help"], { env: { FACTROVE_CLI_ENV_FILE: unreadable } });
    expect(commandHelp.code).toBe(0);
    expect(commandHelp.stdout).toBe(helpText("upload"));
  });

  it("reports an unreadable dev env file as a CLI error and honors --json", async () => {
    const unreadable = await unreadableEnvPath();
    const json = await runLauncher(["upload", fixturePath, "--json"], {
      env: { FACTROVE_CLI_ENV_FILE: unreadable, FACTROVE_API_KEY: "" },
    });
    expect(json.code).toBe(1);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: `Could not read the CLI environment file at ${unreadable}.`,
      },
    });

    const plain = await runLauncher(["upload", fixturePath], {
      env: { FACTROVE_CLI_ENV_FILE: unreadable, FACTROVE_API_KEY: "" },
    });
    expect(plain.code).toBe(1);
    expect(plain.stderr).toBe(`INVALID_INPUT: Could not read the CLI environment file at ${unreadable}.\n`);
  });

  it("resolves a relative path from the process directory and ignores INIT_CWD", async () => {
    const directory = await makeTemp();
    await writeFile(join(directory, "note.html"), "<p>here</p>");
    const stub = await startStub(() => accepted(1));
    const result = await runCli(["upload", "./note.html", "--api-url", stub.url], {
      cwd: directory,
      env: { INIT_CWD: repoRoot },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${artifactId}\n`);
    const parts = multipartParts(stub.requests[0]?.contentType ?? "", stub.requests[0]?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "file")?.filename).toBe("note.html");

    const ignored = await runCli(["upload", "./fixtures/hello.html", "--api-url", stub.url], {
      cwd: directory,
      env: { INIT_CWD: repoRoot },
    });
    expect(ignored.code).toBe(1);
    expect(ignored.stderr).toBe(`FILE_NOT_FOUND: No such file: ${resolve(directory, "fixtures/hello.html")}\n`);
    expect(stub.requests).toHaveLength(1);
  });

  it("prints help and exits without an error", async () => {
    const result = await runCli(["upload", "--help"]);
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(helpText("upload"));
  });

  it("writes local failures to stderr and does not call the API", async () => {
    const directory = await makeTemp();
    const empty = join(directory, "empty.html");
    const text = join(directory, "notes.txt");
    const oversize = join(directory, "big.html");
    await writeFile(empty, "");
    await writeFile(text, "<p>notes</p>");
    await writeFile(oversize, Buffer.alloc(10_485_761, 0x61));
    const port = await closedPort();
    const apiUrl = `http://127.0.0.1:${port}`;

    const missing = await runCli(["upload", "missing.html", "--api-url", apiUrl], { cwd: directory });
    expect(missing).toMatchObject({ code: 1, stdout: "", signal: null });
    expect(missing.stderr).toBe(`FILE_NOT_FOUND: No such file: ${resolve(directory, "missing.html")}\n`);

    const jsonMissing = await runCli(["upload", join(directory, "missing.html"), "--json", "--api-url", apiUrl]);
    expect(jsonMissing.code).toBe(1);
    expect(jsonMissing.stdout).toBe("");
    expect(JSON.parse(jsonMissing.stderr)).toEqual({
      error: { code: "FILE_NOT_FOUND", message: `No such file: ${join(directory, "missing.html")}` },
    });

    const directoryResult = await runCli(["upload", directory, "--api-url", apiUrl]);
    expect(directoryResult.stderr).toBe(`INVALID_INPUT: Path is a directory: ${directory}\n`);

    const extension = await runCli(["upload", text, "--api-url", apiUrl]);
    expect(extension.stderr).toBe("INVALID_INPUT: Only .html and .htm files are supported.\n");

    const tooBig = await runCli(["upload", oversize, "--json", "--api-url", apiUrl]);
    expect(JSON.parse(tooBig.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "The file exceeds the 10 MiB limit." },
    });

    const blank = await runCli(["upload", empty, "--api-url", apiUrl]);
    expect(blank.stderr).toBe("INVALID_INPUT: The HTML file is empty.\n");

    const badUrl = await runCli(["upload", fixturePath, "--api-url", "localhost:3001"]);
    expect(badUrl.code).toBe(1);
    expect(badUrl.stdout).toBe("");
    expect(badUrl.stderr).toMatch(/^INVALID_INPUT: API URL must be an absolute HTTP or HTTPS URL\./);
  });

  it("preserves API error codes and does not retry a failed upload", async () => {
    let calls = 0;
    const stub = await startStub(() => {
      calls += 1;
      return {
        status: 503,
        body: { error: { code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." } },
      };
    });
    const plain = await runCli(["upload", fixturePath, "--api-url", stub.url]);
    expect(plain.code).toBe(1);
    expect(plain.stdout).toBe("");
    expect(plain.stderr).toBe("STORAGE_UNAVAILABLE: Object storage is unavailable.\n");
    expect(calls).toBe(1);

    const json = await runCli(["upload", fixturePath, "--api-url", stub.url, "--json"]);
    expect(json.stdout).toBe("");
    expect(json.stderr).toBe(
      `${JSON.stringify({ error: { code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." } })}\n`,
    );
    expect(calls).toBe(2);
  });

  it("reports an unreachable API as NETWORK_ERROR", async () => {
    const port = await closedPort();
    const result = await runCli(["upload", fixturePath, "--api-url", `http://127.0.0.1:${port}`, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toEqual({
      error: {
        code: "NETWORK_ERROR",
        message: `Could not reach the Factrove API at http://127.0.0.1:${port}.`,
      },
    });
  });

  it("runs the launcher with the caller directory as the CLI working directory", async () => {
    const elsewhere = await makeTemp();
    const stub = await startStub(() => accepted(1));
    const result = await runCommand(
      process.execPath,
      [launcherPath, "upload", "./fixtures/hello.html", "--api-url", stub.url],
      elsewhere,
      { INIT_CWD: repoRoot },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${artifactId}\n`);
    expect(result.stderr).toBe("");
    const parts = multipartParts(stub.requests[0]?.contentType ?? "", stub.requests[0]?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "file")?.filename).toBe("hello.html");
  });

  it("runs from the repository root through pnpm factrove", async () => {
    const stub = await startStub(() => accepted(1, "org_shared"));
    const result = await runCommand(
      "pnpm",
      ["factrove", "upload", "./fixtures/hello.html", "--access", "org_shared", "--api-url", stub.url, "--json"],
      repoRoot,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(created(1, "org_shared"))}\n`);
    expect(result.stderr.split("\n").filter((line) => line.length > 0).every((line) => line.startsWith("$ "))).toBe(true);
    expect(result.stderr).not.toMatch(/\[Nest\]|ERROR|NETWORK_ERROR/);
    const parts = multipartParts(stub.requests[0]?.contentType ?? "", stub.requests[0]?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "accessType")?.data.toString("utf8")).toBe("org_shared");
    expect(parts.find((part) => part.name === "file")?.filename).toBe("hello.html");
    expect(stub.requests[0]?.body.includes(Buffer.from("fixtures/hello.html"))).toBe(false);
  });

  it("explains how to build the CLI when dist is missing", async () => {
    const hidden = `${cliPath}.hidden-for-test`;
    await rename(cliPath, hidden);
    try {
      const result = await runCommand(process.execPath, [launcherPath, "upload", "./fixtures/hello.html"], repoRoot);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("The CLI is not built. From the repository root, run: pnpm --filter @factrove/cli build\n");
    } finally {
      await rename(hidden, cliPath);
    }
  });
});

describe("factrove get", () => {
  const html = "<h1>Hi</h1>";
  const markdown = "# Hi\n";

  it("prints a leading HTML byte order mark", async () => {
    const html = "\uFEFF<p>Hi</p>";
    const stub = await startStub(() => ({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    }));
    const stdout = await runCliBytes(["get", artifactId, "--api-url", stub.url]);
    expect(stdout.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(stdout.subarray(3).toString("utf8")).toBe("<p>Hi</p>");
  });

  it("prints stored HTML exactly and does not add a trailing newline", async () => {
    const stub = await startStub((request) => {
      expect(request.method).toBe("GET");
      expect(request.url).toBe(`/api/v1/artifacts/${artifactId}/content`);
      return { status: 200, contentType: "text/html; charset=utf-8", body: html };
    });
    const result = await runCli(["get", artifactId, "--api-url", stub.url]);

    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(html);
    expect(result.stdout).not.toMatch(/Nest|ERROR|LOG/);
    expect(stub.requests).toHaveLength(1);
  });

  it("requests Markdown and prints one JSON line when asked", async () => {
    const stub = await startStub((request) => {
      expect(request.url).toBe(`/api/v1/artifacts/${artifactId}/content?format=markdown`);
      return { status: 200, contentType: "text/markdown; charset=utf-8", body: markdown };
    });
    const plain = await runCli(["get", artifactId, "--format", "markdown", "--api-url", stub.url]);
    expect(plain.code).toBe(0);
    expect(plain.stderr).toBe("");
    expect(plain.stdout).toBe(markdown);

    const json = await runCli(["--json", "get", artifactId, "--format=markdown", "--api-url", stub.url]);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    expect(json.stdout).toBe(
      `${JSON.stringify({ format: "markdown", mediaType: "text/markdown", content: markdown })}\n`,
    );
    expect(JSON.parse(json.stdout)).toEqual({ format: "markdown", mediaType: "text/markdown", content: markdown });
    expect(stub.requests).toHaveLength(2);
  });

  it("prefers --api-url over FACTROVE_API_URL", async () => {
    const selected = await startStub(() => ({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: html,
    }));
    const ignored = await startStub(() => {
      throw new Error("FACTROVE_API_URL was used instead of --api-url");
    });
    const result = await runCli(["get", artifactId, "--api-url", `${selected.url}/api/v1`], {
      env: { FACTROVE_API_URL: ignored.url },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(html);
    expect(selected.requests).toHaveLength(1);
    expect(ignored.requests).toHaveLength(0);
  });

  it("passes API errors through and reports an unreachable API", async () => {
    let calls = 0;
    const stub = await startStub(() => {
      calls += 1;
      return {
        status: 404,
        body: { error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } },
      };
    });
    const missing = await runCli(["get", artifactId, "--api-url", stub.url]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toBe("ARTIFACT_NOT_FOUND: Artifact was not found.\n");
    expect(calls).toBe(1);

    const json = await runCli(["get", artifactId, "--json", "--api-url", stub.url, "--format", "markdown"]);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr)).toEqual({
      error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." },
    });
    expect(calls).toBe(2);

    const port = await closedPort();
    const offline = await runCli(["get", artifactId, "--api-url", `http://127.0.0.1:${port}`]);
    expect(offline.stdout).toBe("");
    expect(offline.stderr).toBe(`NETWORK_ERROR: Could not reach the Factrove API at http://127.0.0.1:${port}.\n`);
  });

  it("rejects a bad id locally and runs through pnpm factrove", async () => {
    const port = await closedPort();
    const invalid = await runCli(["get", "not-a-uuid", "--api-url", `http://127.0.0.1:${port}`, "--json"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toBe("");
    expect(JSON.parse(invalid.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "Artifact id must be a UUID." },
    });

    const stub = await startStub(() => ({
      status: 200,
      contentType: "text/markdown; charset=utf-8",
      body: markdown,
    }));
    const result = await runCommand(
      "pnpm",
      ["factrove", "get", artifactId, "--format", "markdown", "--api-url", stub.url],
      repoRoot,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(markdown);
    expect(result.stderr.split("\n").filter((line) => line.length > 0).every((line) => line.startsWith("$ "))).toBe(true);
    expect(stub.requests[0]?.url).toBe(`/api/v1/artifacts/${artifactId}/content?format=markdown`);
  });
});

describe("factrove share", () => {
  const token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const shareUrl = `https://factrove.app/share/${artifactId}/${token}`;

  it("prints only the public link and does not print it again on revoke", async () => {
    const stub = await startStub((request) => {
      if (request.method === "DELETE") {
        return { status: 200, body: { share: { shared: false, shareUrl: null, passwordProtected: false } } };
      }
      return { status: 200, body: { share: { shared: true, shareUrl, passwordProtected: false } } };
    });
    const created = await runCli(["share", artifactId, "--api-url", stub.url]);
    expect(created.code).toBe(0);
    expect(created.stdout).toBe(`${shareUrl}\nThis link is not password protected.\n`);
    expect(created.stderr).toBe("");
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe(`/api/v1/artifacts/${artifactId}/share`);
    expect(created.stdout).not.toContain("ftrv_test_key");

    const revoked = await runCli(["share", artifactId, "--revoke", "--api-url", stub.url]);
    expect(revoked.code).toBe(0);
    expect(revoked.stdout).toBe(`Revoked the public link for ${artifactId}.\n`);
    expect(revoked.stdout).not.toContain(token);
    expect(revoked.stderr).not.toContain(token);
    expect(stub.requests[1]?.method).toBe("DELETE");
  });

  it("prints the share envelope on one line", async () => {
    const body = { share: { shared: true, shareUrl, passwordProtected: false } };
    const stub = await startStub(() => ({ status: 200, body }));
    const result = await runCli(["share", artifactId, "--json", "--api-url", stub.url]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(body)}\n`);
    expect(result.stderr).toBe("");
  });

  it("sends a password from stdin without printing it", async () => {
    const password = "correct horse battery";
    const stub = await startStub(() => ({
      status: 200,
      body: { share: { shared: true, shareUrl, passwordProtected: true } },
    }));
    const result = await runCliInput(["share", artifactId, "--password-stdin", "--api-url", stub.url], `${password}\n`);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      `${shareUrl}\nThis link is password protected.\nIf visitors are locked out after too many wrong guesses, revoke, then share again.\n`,
    );
    expect(result.stdout).not.toContain(password);
    expect(result.stderr).toBe("");
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe(`/api/v1/artifacts/${artifactId}/share`);
    expect(stub.requests[0]?.contentType).toContain("application/json");
    expect(JSON.parse(stub.requests[0]?.body.toString("utf8") ?? "")).toEqual({ password });
  });

  it("keeps inner whitespace and strips only one trailing newline from stdin", async () => {
    const stub = await startStub(() => ({
      status: 200,
      body: { share: { shared: true, shareUrl, passwordProtected: true } },
    }));
    const result = await runCliInput(
      ["share", artifactId, "--password-stdin", "--api-url", stub.url],
      "  spaced out  \r\n",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(stub.requests[0]?.body.toString("utf8") ?? "")).toEqual({ password: "  spaced out  " });
  });

  it("rejects a short stdin password before calling the API", async () => {
    const stub = await startStub(() => ({ status: 500, body: {} }));
    const result = await runCliInput(["share", artifactId, "--password-stdin", "--api-url", stub.url, "--json"], "short\n");
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "The password must be at least 10 characters." },
    });
    expect(result.stderr).not.toContain("short\n");
    expect(stub.requests).toHaveLength(0);
  });

  it("rejects whitespace and low-entropy stdin passwords before calling the API", async () => {
    const stub = await startStub(() => ({ status: 500, body: {} }));
    const spaces = await runCliInput(
      ["share", artifactId, "--password-stdin", "--api-url", stub.url, "--json"],
      "          \n",
    );
    expect(spaces.code).not.toBe(0);
    expect(JSON.parse(spaces.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "Choose a password with letters or numbers." },
    });
    const repeated = await runCliInput(
      ["share", artifactId, "--password-stdin", "--api-url", stub.url, "--json"],
      "ababababab\n",
    );
    expect(repeated.code).not.toBe(0);
    expect(JSON.parse(repeated.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "Use at least 4 different characters." },
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("rejects a common stdin password before calling the API", async () => {
    const stub = await startStub(() => ({ status: 500, body: {} }));
    const result = await runCliInput(
      ["share", artifactId, "--password-stdin", "--api-url", stub.url, "--json"],
      "password123\n",
    );
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stderr)).toEqual({
      error: { code: "INVALID_INPUT", message: "Choose a less common password." },
    });
    expect(result.stderr).not.toContain("password123");
    expect(stub.requests).toHaveLength(0);
  });

  it("refuses to prompt for --password without a terminal", async () => {
    const stub = await startStub(() => ({ status: 500, body: {} }));
    const result = await runCliInput(["share", artifactId, "--password", "--api-url", stub.url], "piped password\n");
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("--password needs a terminal");
    expect(stub.requests).toHaveLength(0);
  });

  it("removes the password and keeps the link", async () => {
    const stub = await startStub((request) => {
      if (request.method === "DELETE") {
        return { status: 200, body: { share: { shared: true, shareUrl, passwordProtected: false } } };
      }
      return { status: 200, body: { share: { shared: true, shareUrl, passwordProtected: true } } };
    });
    const result = await runCli(["share", artifactId, "--remove-password", "--api-url", stub.url]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`Removed the password for ${artifactId}.\n`);
    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.url).toBe(`/api/v1/artifacts/${artifactId}/share`);
    expect(stub.requests[1]?.method).toBe("DELETE");
    expect(stub.requests[1]?.url).toBe(`/api/v1/artifacts/${artifactId}/share/password`);
  });

  it("does not claim to remove a password that was not set", async () => {
    const missing = await startStub(() => ({
      status: 200,
      body: { share: { shared: false, shareUrl: null, passwordProtected: false } },
    }));
    const missingResult = await runCli(["share", artifactId, "--remove-password", "--api-url", missing.url]);
    expect(missingResult.code).toBe(0);
    expect(missingResult.stdout).toBe("This artifact is not shared.\n");
    expect(missing.requests).toHaveLength(1);
    expect(missing.requests[0]?.method).toBe("GET");

    const open = await startStub(() => ({
      status: 200,
      body: { share: { shared: true, shareUrl, passwordProtected: false } },
    }));
    const openResult = await runCli(["share", artifactId, "--remove-password", "--api-url", open.url]);
    expect(openResult.code).toBe(0);
    expect(openResult.stdout).toBe("This link has no password.\n");
    expect(open.requests).toHaveLength(1);
    expect(open.requests[0]?.method).toBe("GET");
  });
});

function accepted(sizeBytes: number, accessType: "private" | "org_shared" = "private") {
  return { status: 201, body: created(sizeBytes, accessType) };
}

function created(sizeBytes: number, accessType: "private" | "org_shared" = "private") {
  return {
    artifact: {
      id: artifactId,
      creatorUserId: "local-user",
      organizationId: "local-org",
      accessType,
      filename: `${artifactId}.html`,
      name: null,
      mimeType: "text/html" as const,
      sizeBytes,
      createdAt: "2026-10-18T12:00:00.000Z",
      updatedAt: "2026-10-18T12:00:00.000Z",
      uploadedAt: "2026-10-18T12:00:00.000Z",
      viewerUrl: `http://localhost:3000/artifacts/${artifactId}`,
      contentUrl: `http://localhost:3001/api/v1/artifacts/${artifactId}/content`,
      shared: false,
      passwordProtected: false,
    },
  };
}

describe("factrove configure", () => {
  it("stores a profile from stdin without printing the key", async () => {
    const directory = await makeTemp();
    const key = "ftrv_configure_secret_value";
    const result = await runCliInput(
      ["configure", "--profile", "dev"],
      `${key}\nhttp://127.0.0.1:3999\n`,
      { FACTROVE_CONFIG_DIR: directory, FACTROVE_API_KEY: "" },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('Configured profile "dev" for http://127.0.0.1:3999.\n');
    expect(result.stdout).not.toContain(key);
    expect(result.stderr).not.toContain(key);
    const credentials = await readFile(join(directory, "credentials"), "utf8");
    expect(credentials).toContain(`[dev]\nfactrove_api_key = ${key}\n`);
    const config = await readFile(join(directory, "config"), "utf8");
    expect(config).toContain("api_url = http://127.0.0.1:3999");
    expect((await stat(join(directory, "credentials"))).mode & 0o777).toBe(0o600);
  });

  it("lets an explicit --profile beat FACTROVE_API_KEY", async () => {
    const directory = await makeTemp();
    await writeFile(
      join(directory, "credentials"),
      "[dev]\nfactrove_api_key = ftrv_from_profile\n\n[default]\nfactrove_api_key = ftrv_from_default\n",
    );
    const stub = await startStub(() => accepted(1));
    const fromProfile = await runCli(["upload", fixturePath, "--profile", "dev", "--api-url", stub.url], {
      env: { FACTROVE_CONFIG_DIR: directory, FACTROVE_API_KEY: "ftrv_from_env" },
    });
    expect(fromProfile.code).toBe(0);
    expect(stub.requests[0]?.authorization).toBe("Bearer ftrv_from_profile");
    expect(fromProfile.stdout).not.toContain("ftrv_from_env");

    const fromEnv = await runCli(["upload", fixturePath, "--api-url", stub.url], {
      env: { FACTROVE_CONFIG_DIR: directory, FACTROVE_API_KEY: "ftrv_from_env" },
    });
    expect(fromEnv.code).toBe(0);
    expect(stub.requests[1]?.authorization).toBe("Bearer ftrv_from_env");
  });

  it("replaces an existing credentials file through a private temporary file", async () => {
    const directory = await makeTemp();
    const credentials = join(directory, "credentials");
    await writeFile(credentials, "[default]\nfactrove_api_key = ftrv_old\n", { mode: 0o644 });
    await chmod(credentials, 0o644);
    const key = "ftrv_replaced_secret";
    const result = await runCliInput(["configure"], `${key}\nhttp://127.0.0.1:3999\n`, {
      FACTROVE_CONFIG_DIR: directory,
      FACTROVE_API_KEY: "",
    });
    expect(result.code).toBe(0);
    const text = await readFile(credentials, "utf8");
    expect(text).toContain(key);
    expect(text).not.toContain("ftrv_old");
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    const names = await readdir(directory);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
  });

  it("writes through a credentials symlink to the existing target", async () => {
    const directory = await makeTemp();
    const targetDirectory = await makeTemp();
    const target = join(targetDirectory, "credentials");
    await writeFile(target, "[default]\nfactrove_api_key = ftrv_old\n", { mode: 0o644 });
    const link = join(directory, "credentials");
    await symlink(target, link);
    const key = "ftrv_symlink_secret";
    const result = await runCliInput(["configure"], `${key}\nhttp://127.0.0.1:3999\n`, {
      FACTROVE_SHARED_CREDENTIALS_FILE: link,
      FACTROVE_CONFIG_DIR: directory,
      FACTROVE_API_KEY: "",
    });
    expect(result.code).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const text = await readFile(target, "utf8");
    expect(text).toContain(key);
    expect(text).not.toContain("ftrv_old");
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("writes through a dangling credentials symlink", async () => {
    const directory = await makeTemp();
    const link = join(directory, "credentials");
    await symlink("stored-credentials", link);
    const key = "ftrv_dangling_symlink";
    const result = await runCliInput(["configure"], `${key}\nhttp://127.0.0.1:3999\n`, {
      FACTROVE_SHARED_CREDENTIALS_FILE: link,
      FACTROVE_CONFIG_DIR: directory,
      FACTROVE_API_KEY: "",
    });
    expect(result.code).toBe(0);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const target = join(directory, "stored-credentials");
    expect((await lstat(target)).isSymbolicLink()).toBe(false);
    expect(await readFile(target, "utf8")).toContain(key);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it("keeps the mode of an existing directory that holds a custom credentials file", async () => {
    const parent = await makeTemp();
    await chmod(parent, 0o755);
    const credentials = join(parent, "shared-credentials");
    const config = join(parent, "shared-config");
    const key = "ftrv_custom_path_secret";
    const result = await runCliInput(["configure"], `${key}\nhttp://127.0.0.1:3999\n`, {
      FACTROVE_SHARED_CREDENTIALS_FILE: credentials,
      FACTROVE_CONFIG_FILE: config,
      FACTROVE_API_KEY: "",
    });
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain(key);
    expect((await stat(parent)).mode & 0o777).toBe(0o755);
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    expect(await readFile(credentials, "utf8")).toContain(key);
  });

  it("restricts only directories created for a custom credentials path", async () => {
    const parent = await makeTemp();
    await chmod(parent, 0o755);
    const created = join(parent, "factrove");
    const credentials = join(created, "credentials");
    const key = "ftrv_created_dir_secret";
    const result = await runCliInput(["configure"], `${key}\nhttp://127.0.0.1:3999\n`, {
      FACTROVE_SHARED_CREDENTIALS_FILE: credentials,
      FACTROVE_CONFIG_DIR: created,
      FACTROVE_API_KEY: "",
    });
    expect(result.code).toBe(0);
    expect((await stat(parent)).mode & 0o777).toBe(0o755);
    expect((await stat(created)).mode & 0o777).toBe(0o700);
    expect((await stat(credentials)).mode & 0o777).toBe(0o600);
    expect((await stat(join(created, "config"))).mode & 0o777).toBe(0o600);
  });

  it("fails a command that has no API key", async () => {
    const result = await runCli(["upload", fixturePath], { env: { FACTROVE_API_KEY: "" } });
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("INVALID_INPUT: An API key is required. Run: factrove configure\n");
    expect(result.stdout).toBe("");
  });
});

type StubResult = {
  status: number;
  body: unknown;
  contentType?: string;
};

async function startStub(
  respond: (request: CapturedRequest) => StubResult | Promise<StubResult>,
): Promise<Stub> {
  const requests: CapturedRequest[] = [];
  const server = createServer((message, response) => {
    void readRequest(message).then(async (request) => {
      requests.push(request);
      try {
        const result = await respond(request);
        const contentType = result.contentType ?? "application/json";
        const payload = contentType.startsWith("application/json") ? JSON.stringify(result.body) : String(result.body);
        response.writeHead(result.status, { "content-type": contentType });
        response.end(payload);
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "stub failed" } }));
      }
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP stub did not bind a TCP port");
  }
  const stub: Stub = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => closeServer(server),
  };
  cleanup.push(stub.close);
  return stub;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readRequest(message: IncomingMessage): Promise<CapturedRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    message.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    message.on("error", reject);
    message.on("end", () => {
      const header = message.headers["content-type"];
      const authorization = message.headers.authorization;
      resolve({
        method: message.method,
        url: message.url,
        contentType: Array.isArray(header) ? header.join(", ") : header ?? "",
        authorization: Array.isArray(authorization) ? authorization.join(", ") : authorization ?? "",
        body: Buffer.concat(chunks),
      });
    });
  });
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a closed port");
  }
  await closeServer(server);
  return address.port;
}

type CliResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runCli(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<CliResult> {
  return runCommand(process.execPath, [cliPath, ...args], options?.cwd ?? repoRoot, options?.env);
}

function runCliInput(args: string[], input: string, envOverrides?: NodeJS.ProcessEnv): Promise<CliResult> {
  const env = cliEnv(envOverrides);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${args.join(" ")}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function runCliBytes(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const env = cliEnv();
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Command timed out"));
    }, 20_000);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`CLI exited ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function cliEnv(envOverrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FACTROVE_API_URL;
  delete env.INIT_CWD;
  delete env.FACTROVE_PROFILE;
  delete env.FACTROVE_API_KEY;
  delete env.FACTROVE_DEV_API_URL;
  delete env.FACTROVE_SHARED_CREDENTIALS_FILE;
  delete env.FACTROVE_CONFIG_FILE;
  env.FACTROVE_CONFIG_DIR = "/tmp/factrove-cli-absent-7044";
  env.FACTROVE_CLI_ENV_FILE = "/tmp/factrove-cli-env-absent-7044";
  Object.assign(env, envOverrides);
  if (env.FACTROVE_API_KEY === undefined) {
    env.FACTROVE_API_KEY = "ftrv_test_key";
  }
  return env;
}

function devFileEnv(envFile: string, configDir: string | undefined, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    FACTROVE_CLI_ENV_FILE: envFile,
    ...(configDir ? { FACTROVE_CONFIG_DIR: configDir } : {}),
    ...overrides,
  };
}

function runLauncher(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<CliResult> {
  return runCommand(process.execPath, [launcherPath, ...args], options?.cwd ?? repoRoot, options?.env);
}

async function writeCliEnvFile(contents: string): Promise<string> {
  const directory = await makeTemp();
  const path = join(directory, "cli.env");
  await writeFile(path, `${contents}\n`, { mode: 0o600 });
  return path;
}

async function writeProfile(directory: string, profile: string, apiKey: string, apiUrl?: string): Promise<void> {
  await writeFile(join(directory, "credentials"), `[${profile}]\nfactrove_api_key = ${apiKey}\n`, { mode: 0o600 });
  if (apiUrl !== undefined) {
    const section = profile === "default" ? "default" : `profile ${profile}`;
    await writeFile(join(directory, "config"), `[${section}]\napi_url = ${apiUrl}\n`, { mode: 0o600 });
  }
}

async function unreadableEnvPath(): Promise<string> {
  const directory = await makeTemp();
  const file = join(directory, ".env");
  await writeFile(file, "FACTROVE_API_URL=http://127.0.0.1:9\n", { mode: 0o600 });
  await chmod(file, 0o000);
  try {
    await readFile(file, "utf8");
  } catch {
    return file;
  }
  return directory;
}

function runCommand(command: string, args: string[], cwd: string, envOverrides?: NodeJS.ProcessEnv): Promise<CliResult> {
  const env = cliEnv(envOverrides);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function multipartParts(contentType: string, body: Buffer): Array<{ name: string; filename?: string; data: Buffer }> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error(`Missing multipart boundary in ${contentType}`);
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Array<{ name: string; filename?: string; data: Buffer }> = [];
  for (const section of splitBuffer(body, delimiter)) {
    let chunk = section;
    if (chunk.subarray(0, 2).equals(Buffer.from("\r\n"))) {
      chunk = chunk.subarray(2);
    }
    if (chunk.length === 0 || chunk.subarray(0, 2).equals(Buffer.from("--"))) {
      continue;
    }
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      continue;
    }
    const header = chunk.subarray(0, headerEnd).toString("utf8");
    let data = chunk.subarray(headerEnd + 4);
    if (data.subarray(-2).equals(Buffer.from("\r\n"))) {
      data = data.subarray(0, -2);
    }
    const name = /name="([^"]*)"/.exec(header)?.[1];
    if (!name) {
      continue;
    }
    const filename = /filename="([^"]*)"/.exec(header)?.[1];
    parts.push(filename === undefined ? { name, data } : { name, filename, data });
  }
  return parts;
}

function splitBuffer(buffer: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  while (start <= buffer.length) {
    const index = buffer.indexOf(delimiter, start);
    if (index === -1) {
      parts.push(buffer.subarray(start));
      break;
    }
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.length;
  }
  return parts;
}

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factrove-cli-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
