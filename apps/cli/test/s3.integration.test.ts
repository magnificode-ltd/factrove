import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const artifactId = "123e4567-e89b-42d3-a456-426614174000";

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  contentType: string;
  authorization: string;
  body: Buffer;
};

type CliResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

describe("s3-style CLI commands", () => {
  it("copies a file up and an artifact down with aws s3 lines", async () => {
    const access: { value: "private" | "org_shared" } = { value: "private" };
    const stub = await startStub((request) => route(request, "<p>Hi</p>", access));
    const uploaded = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--endpoint-url", stub.url]);
    expect(uploaded.code).toBe(0);
    expect(uploaded.stderr).toBe("");
    expect(uploaded.stdout).toBe(`upload: fixtures/hello.html to factrove://mine/${artifactId}\n`);
    expect(uploaded.stdout).not.toContain("ftrv_test_key");
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.authorization).toBe("Bearer ftrv_test_key");
    const parts = multipartParts(stub.requests[0]?.contentType ?? "", stub.requests[0]?.body ?? Buffer.alloc(0));
    expect(parts.find((part) => part.name === "file")?.filename).toBe("hello.html");
    expect(parts.find((part) => part.name === "accessType")?.data.toString("utf8")).toBe("private");

    const json = await runCli(["s3", "cp", "fixtures/hello.html", "factrove://mine/report.html", "--output", "json", "--endpoint-url", stub.url]);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toMatchObject({ artifact: { id: artifactId, viewerUrl: `http://localhost:3000/artifacts/${artifactId}` } });
    const jsonParts = multipartParts(stub.requests.at(-1)?.contentType ?? "", stub.requests.at(-1)?.body ?? Buffer.alloc(0));
    expect(jsonParts.find((part) => part.name === "file")?.filename).toBe("report.html");

    const quiet = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--quiet", "--endpoint-url", stub.url]);
    expect(quiet).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(stub.requests.filter((request) => request.method === "POST")).toHaveLength(3);

    const downloaded = await runCli(["cp", `factrove://mine/${artifactId}`, "-", "--endpoint-url", stub.url]);
    expect(downloaded.code).toBe(0);
    expect(downloaded.stdout).toBe("<p>Hi</p>");
    expect(downloaded.stderr).toBe(`download: factrove://mine/${artifactId} to -\n`);

    const markdown = await runCli(["cp", `factrove://mine/${artifactId}.HTML`, "-", "--format", "markdown", "--endpoint-url", stub.url]);
    expect(markdown).toMatchObject({ code: 0, stdout: "# Hi\n", stderr: `download: factrove://mine/${artifactId} to -\n` });

    const quietDownload = await runCli(["cp", `factrove://mine/${artifactId}`, "-", "--quiet", "--output", "text", "--endpoint-url", stub.url]);
    expect(quietDownload).toMatchObject({ code: 0, stdout: "<p>Hi</p>", stderr: "" });

    const jsonDownload = await runCli(["cp", `factrove://mine/${artifactId}`, "-", "--json", "--endpoint-url", stub.url]);
    expect(jsonDownload.code).toBe(0);
    expect(jsonDownload.stderr).toBe("");
    expect(JSON.parse(jsonDownload.stdout)).toEqual({ format: "html", mediaType: "text/html", content: "<p>Hi</p>" });

    const directory = await makeTemp();
    const destination = join(directory, "nested", "out.html");
    const saved = await runCli(["cp", `factrove://mine/${artifactId}.html`, destination, "--endpoint-url", stub.url]);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toBe(`download: factrove://mine/${artifactId} to ${destination}\n`);
    expect(await readFile(destination, "utf8")).toBe("<p>Hi</p>");

    const markdownDir = await makeTemp();
    const markdownSaved = await runCli([
      "cp",
      `factrove://mine/${artifactId}`,
      `${markdownDir}/`,
      "--format",
      "markdown",
      "--endpoint-url",
      stub.url,
    ]);
    expect(markdownSaved.code).toBe(0);
    expect(markdownSaved.stdout).toBe(`download: factrove://mine/${artifactId} to ${markdownDir}/${artifactId}.md\n`);
    expect(await readFile(join(markdownDir, `${artifactId}.md`), "utf8")).toBe("# Hi\n");
    const namedMarkdown = join(markdownDir, "notes.txt");
    const namedSaved = await runCli(["cp", `factrove://mine/${artifactId}`, namedMarkdown, "--format", "markdown", "--endpoint-url", stub.url]);
    expect(namedSaved.stdout).toBe(`download: factrove://mine/${artifactId} to ${namedMarkdown}\n`);
    expect(await readFile(namedMarkdown, "utf8")).toBe("# Hi\n");

    const wrongScope = await runCli(["cp", `factrove://org/${artifactId}`, "-", "--endpoint-url", stub.url]);
    expect(wrongScope.code).toBe(1);
    expect(wrongScope.stdout).toBe("");
    expect(wrongScope.stderr).toMatch(/not in factrove:\/\/org\//);

    const shared = await runCli(["cp", "fixtures/hello.html", "factrove://org/notes.htm", "--endpoint-url", stub.url]);
    expect(shared.stdout).toBe(`upload: fixtures/hello.html to factrove://org/${artifactId}\n`);
    const sharedParts = multipartParts(stub.requests.at(-1)?.contentType ?? "", stub.requests.at(-1)?.body ?? Buffer.alloc(0));
    expect(sharedParts.find((part) => part.name === "accessType")?.data.toString("utf8")).toBe("org_shared");
    expect(sharedParts.find((part) => part.name === "file")?.filename).toBe("notes.htm");
    const fromOrg = await runCli(["cp", `factrove://org/${artifactId}`, "-", "--quiet", "--endpoint-url", stub.url]);
    expect(fromOrg).toMatchObject({ code: 0, stdout: "<p>Hi</p>", stderr: "" });

    const legacy = await runCli(["upload", "fixtures/hello.html", "--quiet", "--endpoint-url", stub.url]);
    expect(legacy).toMatchObject({ code: 0, stdout: `http://localhost:3000/artifacts/${artifactId}\n`, stderr: "" });
    const got = await runCli(["get", artifactId, "--output", "json", "--quiet", "--endpoint-url", stub.url]);
    expect(got.code).toBe(0);
    expect(got.stderr).toBe("");
    expect(JSON.parse(got.stdout)).toEqual({ format: "html", mediaType: "text/html", content: "<p>Hi</p>" });
    expect(stub.requests.some((request) => request.method === "DELETE")).toBe(false);
    expect(stub.requests.filter((request) => request.url === "/api/v1/context").length).toBeGreaterThan(0);
  });

  it("uses exit code 1 for a rejected copy and leaves legacy output unchanged", async () => {
    const stub = await startStub((request) => route(request, "<p>Hi</p>", { value: "private" }));
    const stdin = await runCli(["cp", "-", "factrove://mine/stdin.html", "--endpoint-url", stub.url]);
    expect(stdin.code).toBe(1);
    expect(stdin.stdout).toBe("");
    expect(stdin.stderr).toMatch(/reads a local file/);

    const local = await runCli(["cp", "fixtures/hello.html", "out.html", "--endpoint-url", stub.url]);
    expect(local.code).toBe(1);
    expect(local.stderr).toMatch(/local path and a factrove:\/\/ URI/);

    const between = await runCli(["cp", `factrove://mine/${artifactId}`, "factrove://org/", "--endpoint-url", stub.url]);
    expect(between.code).toBe(1);
    expect(between.stderr).toMatch(/between factrove:\/\/ URIs is not supported/);

    const named = await runCli(["cp", `factrove://mine/report.html`, "-", "--endpoint-url", stub.url]);
    expect(named.code).toBe(1);
    expect(named.stderr).toMatch(/does not store upload names/);

    const overwrite = await runCli(["cp", "fixtures/hello.html", `factrove://mine/${artifactId}`, "--endpoint-url", stub.url]);
    expect(overwrite.code).toBe(1);
    expect(overwrite.stderr).toMatch(/server assigns the id/);

    const unknown = await runCli(["ls", "factrove://mine/"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toMatch(/^INVALID_INPUT: Unknown command 'ls'/);

    const removed = await runCli(["rm", `factrove://mine/${artifactId}`]);
    expect(removed.stderr).toMatch(/Unknown command 'rm'/);
    const presign = await runCli(["presign", `factrove://mine/${artifactId}`]);
    expect(presign.stderr).toMatch(/Unknown command 'presign'/);

    const prefix = await runCli(["cp", "fixtures/hello.html", "factrove://mine/prefix/", "--endpoint-url", stub.url]);
    expect(prefix.code).toBe(1);
    expect(prefix.stdout).toBe("");
    expect(prefix.stderr).toMatch(/cannot end with/);
    expect(prefix.stderr).not.toMatch(/Only \.html/);

    const s3Upload = await runCli(["s3", "upload", "fixtures/hello.html"]);
    expect(s3Upload.code).toBe(1);
    expect(s3Upload.stderr).toMatch(/only accepts cp/);
    const dashed = await runCli(["upload", "-"]);
    expect(dashed.code).toBe(1);
    expect(dashed.stderr).toMatch(/Unknown option '-'/);
    expect(stub.requests).toHaveLength(0);

    const missing = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--json", "--output", "text"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(JSON.parse(missing.stderr)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(missing.stderr).toMatch(/conflicts/);
    const reversed = await runCli(["cp", "--output", "text", "--json", "fixtures/hello.html", "factrove://mine/"]);
    expect(reversed.code).toBe(1);
    expect(reversed.stdout).toBe("");
    expect(JSON.parse(reversed.stderr)).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect(reversed.stderr).toMatch(/conflicts/);
  });
});

function route(
  request: CapturedRequest,
  html: string,
  access: { value: "private" | "org_shared" },
) {
  const url = request.url ?? "";
  if (url === "/api/v1/context") {
    return {
      status: 200,
      body: {
        user: { id: "local-user", name: "Local User" },
        organization: { id: "local-org", name: "Local Organization" },
      },
    };
  }
  if (request.method === "POST" && url === "/api/v1/artifacts") {
    const posted = multipartParts(request.contentType, request.body).find((part) => part.name === "accessType")?.data.toString("utf8");
    if (posted === "private" || posted === "org_shared") {
      access.value = posted;
    }
    return { status: 201, body: { artifact: artifactBody(access.value) } };
  }
  if (url === `/api/v1/artifacts/${artifactId}/content` || url.startsWith(`/api/v1/artifacts/${artifactId}/content?`)) {
    const markdown = url.includes("format=markdown");
    return {
      status: 200,
      contentType: markdown ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
      body: markdown ? "# Hi\n" : html,
    };
  }
  if (url === `/api/v1/artifacts/${artifactId}`) {
    return { status: 200, body: { artifact: artifactBody(access.value) } };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: `unexpected ${request.method} ${url}` } } };
}

function artifactBody(accessType: "private" | "org_shared" = "private") {
  return {
    id: artifactId,
    creatorUserId: "local-user",
    organizationId: "local-org",
    accessType,
    filename: `${artifactId}.html`,
    mimeType: "text/html" as const,
    sizeBytes: 1,
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:00:00.000Z",
    uploadedAt: "2026-10-18T12:00:00.000Z",
    viewerUrl: `http://localhost:3000/artifacts/${artifactId}`,
    contentUrl: `http://127.0.0.1/api/v1/artifacts/${artifactId}/content`,
    shared: false,
    passwordProtected: false,
  };
}

async function startStub(respond: (request: CapturedRequest) => { status: number; body: unknown; contentType?: string } | Promise<{ status: number; body: unknown; contentType?: string }>) {
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
    throw new Error("Could not bind the stub");
  }
  cleanup.push(() => closeServer(server));
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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

function runCli(args: string[], options?: { cwd?: string }): Promise<CliResult> {
  const env = cliEnv();
  const cwd = options?.cwd ?? repoRoot;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
  });
}

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FACTROVE_API_URL;
  delete env.FACTROVE_ENDPOINT_URL;
  delete env.FACTROVE_PROFILE;
  delete env.FACTROVE_DEV_API_URL;
  env.FACTROVE_CONFIG_DIR = "/tmp/factrove-cli-s3-absent";
  env.FACTROVE_CLI_ENV_FILE = "/tmp/factrove-cli-s3-env-absent";
  env.FACTROVE_API_KEY = "ftrv_test_key";
  return env;
}

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "factrove-s3-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function multipartParts(contentType: string, body: Buffer): Array<{ name: string; filename?: string; data: Buffer }> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    throw new Error(`Missing multipart boundary in ${contentType}`);
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Array<{ name: string; filename?: string; data: Buffer }> = [];
  let start = 0;
  while (start <= body.length) {
    const index = body.indexOf(delimiter, start);
    const section = index === -1 ? body.subarray(start) : body.subarray(start, index);
    start = index === -1 ? body.length + 1 : index + delimiter.length;
    let chunk = section;
    if (chunk.subarray(0, 2).equals(Buffer.from("\r\n"))) {
      chunk = chunk.subarray(2);
    }
    if (chunk.length === 0 || chunk.subarray(0, 2).equals(Buffer.from("--"))) {
      if (index === -1) break;
      continue;
    }
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const header = chunk.subarray(0, headerEnd).toString("utf8");
    let data = chunk.subarray(headerEnd + 4);
    if (data.subarray(-2).equals(Buffer.from("\r\n"))) data = data.subarray(0, -2);
    const name = /name="([^"]*)"/.exec(header)?.[1];
    if (!name) continue;
    const filename = /filename="([^"]*)"/.exec(header)?.[1];
    parts.push(filename === undefined ? { name, data } : { name, filename, data });
    if (index === -1) break;
  }
  return parts;
}
