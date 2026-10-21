import "reflect-metadata";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { localOrganizationFixture, seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, BlobNotFoundError, type BlobStore } from "../src/storage/index.js";
import { addMembership, signUpWithApiKey, TEST_AUTH_SECRET, type SignedInUser } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const cliPath = fileURLToPath(new URL("../../cli/dist/main.js", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));

const config: ApiConfig = {
  host: "127.0.0.1",
  port: 3001,
  webOrigin: "http://localhost:3000",
  apiPublicOrigin: "http://localhost:3001",
  publicBaseUrl: "http://localhost:3000",
  authSecret: TEST_AUTH_SECRET,
  authCookieDomain: null,
  trustedProxies: [],
  shareTokenKey: null,
};

class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    this.objects.set(input.objectKey, Uint8Array.from(input.body));
  }

  async get(objectKey: string): Promise<{ body: AsyncIterable<Uint8Array> }> {
    const stored = this.objects.get(objectKey);
    if (!stored) {
      throw new BlobNotFoundError(objectKey);
    }
    return {
      body: (async function* body() {
        yield stored;
      })(),
    };
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  reset(): void {
    this.objects.clear();
  }
}

type CliResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

describe("CLI s3 commands against the API", () => {
  const store = new MemoryBlobStore();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let app: INestApplication;
  let baseUrl = "";
  let prisma: PrismaService;
  let owner: SignedInUser;
  let fixture = "";

  beforeAll(async () => {
    if (!existsSync(cliPath)) {
      throw new Error("The CLI is not built. From the repository root, run: pnpm --filter @factrove/cli build");
    }
    fixture = await readFile(fixturePath, "utf8");
    process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
    isolated = await createIsolatedDatabase();
    process.env.DATABASE_URL = isolated.databaseUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl },
    });
    const seeder = new PrismaClient();
    await seeder.$connect();
    try {
      await seedLocalIdentities(seeder);
    } finally {
      await seeder.$disconnect();
    }
    app = await createApp(config, store);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    prisma = app.get(PrismaService);
    owner = await signUpWithApiKey(baseUrl, {
      email: "cli-s3-owner@example.invalid",
      password: "owner-password-1",
      name: "CLI Owner",
      keyName: "cli-s3",
    });
    await addMembership(prisma, owner.userId, localOrganizationFixture.id);
  }, 120_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (isolated) {
      await dropIsolatedDatabase(isolated);
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }, 120_000);

  beforeEach(async () => {
    store.reset();
    await prisma.artifact.deleteMany();
  });

  it("copies a file up and the stored HTML back down", async () => {
    const uploaded = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--endpoint-url", baseUrl]);
    expect(uploaded.code).toBe(0);
    expect(uploaded.stderr).toBe("");
    const uploadMatch = /^upload: fixtures\/hello\.html to factrove:\/\/mine\/([0-9a-f-]{36})\n$/.exec(uploaded.stdout);
    expect(uploadMatch).not.toBeNull();
    const id = uploadMatch?.[1] ?? "";
    expect(uploaded.stdout).not.toContain(owner.apiKey);
    expect(store.objects.has(`${id}.html`)).toBe(true);
    const row = await prisma.artifact.findUnique({ where: { id } });
    expect(row?.accessType).toBe("private");

    const json = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--output", "json", "--endpoint-url", baseUrl]);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    const envelope = JSON.parse(json.stdout) as { artifact: { id: string; viewerUrl: string } };
    expect(envelope.artifact.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(envelope.artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${envelope.artifact.id}`);

    const quiet = await runCli(["cp", "fixtures/hello.html", "factrove://mine/", "--quiet", "--endpoint-url", baseUrl]);
    expect(quiet).toMatchObject({ code: 0, stdout: "", stderr: "" });
    expect(await prisma.artifact.count()).toBe(3);

    const downloaded = await runCli(["cp", `factrove://mine/${id}`, "-", "--endpoint-url", baseUrl]);
    expect(downloaded.code).toBe(0);
    expect(downloaded.stdout).toBe(fixture);
    expect(downloaded.stderr).toBe(`download: factrove://mine/${id} to -\n`);

    const directory = await mkdtemp(join(tmpdir(), "factrove-cli-s3-"));
    try {
      const destination = join(directory, "out.html");
      const saved = await runCli(["s3", "cp", `factrove://mine/${id}.html`, destination, "--quiet", "--endpoint-url", baseUrl]);
      expect(saved).toMatchObject({ code: 0, stdout: "", stderr: "" });
      expect(await readFile(destination, "utf8")).toBe(fixture);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    const wrongScope = await runCli(["cp", `factrove://org/${id}`, "-", "--endpoint-url", baseUrl]);
    expect(wrongScope.code).toBe(1);
    expect(wrongScope.stdout).toBe("");
    expect(wrongScope.stderr).toMatch(/not in factrove:\/\/org\//);

    const shared = await runCli(["cp", "fixtures/hello.html", "factrove://org/report.html", "--endpoint-url", baseUrl]);
    const sharedMatch = /^upload: fixtures\/hello\.html to factrove:\/\/org\/([0-9a-f-]{36})\n$/.exec(shared.stdout);
    expect(sharedMatch).not.toBeNull();
    const sharedId = sharedMatch?.[1] ?? "";
    expect((await prisma.artifact.findUnique({ where: { id: sharedId } }))?.accessType).toBe("org_shared");
    const fromOrg = await runCli(["cp", `factrove://org/${sharedId}`, "-", "--endpoint-url", baseUrl]);
    expect(fromOrg.code).toBe(0);
    expect(fromOrg.stdout).toBe(fixture);
    expect(fromOrg.stderr).toBe(`download: factrove://org/${sharedId} to -\n`);
    const fromMine = await runCli(["cp", `factrove://mine/${sharedId}`, "-", "--quiet", "--endpoint-url", baseUrl]);
    expect(fromMine).toMatchObject({ code: 0, stdout: fixture, stderr: "" });

    const legacy = await runCli(["upload", "fixtures/hello.html", "--quiet", "--endpoint-url", baseUrl]);
    expect(legacy.code).toBe(0);
    expect(legacy.stderr).toBe("");
    expect(legacy.stdout).toMatch(/^http:\/\/localhost:3000\/artifacts\/[0-9a-f-]{36}\n$/);
    const legacyId = legacy.stdout.trim().slice(legacy.stdout.trim().lastIndexOf("/") + 1);
    const got = await runCli(["get", legacyId, "--output", "text", "--endpoint-url", baseUrl]);
    expect(got).toMatchObject({ code: 0, stdout: fixture, stderr: "" });

    const unknown = await runCli(["ls", "--endpoint-url", baseUrl]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/Unknown command 'ls'/);
    expect(store.objects.has(`${id}.html`)).toBe(true);
  }, 90_000);

  function runCli(args: string[]): Promise<CliResult> {
    const env = cliEnv(owner.apiKey);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
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
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  }
});

function cliEnv(apiKey: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.FACTROVE_API_URL;
  delete env.FACTROVE_ENDPOINT_URL;
  delete env.FACTROVE_PROFILE;
  delete env.FACTROVE_DEV_API_URL;
  delete env.FACTROVE_SHARED_CREDENTIALS_FILE;
  delete env.FACTROVE_CONFIG_FILE;
  env.FACTROVE_CONFIG_DIR = join(tmpdir(), "factrove-cli-s3-api-absent");
  env.FACTROVE_CLI_ENV_FILE = join(tmpdir(), "factrove-cli-s3-api-env-absent");
  env.FACTROVE_API_KEY = apiKey;
  return env;
}

async function createApp(appConfig: ApiConfig, store: BlobStore): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(API_CONFIG)
    .useValue(appConfig)
    .overrideProvider(BLOB_STORE)
    .useValue(store)
    .compile();
  const application = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  configureHttpApp(application);
  try {
    await application.init();
  } catch (error) {
    await application.close();
    throw error;
  }
  return application;
}
