import "reflect-metadata";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER } from "../src/auth/client-ip.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { PublicViewLimiter } from "../src/sharing/public-view-limit.js";
import { AppModule } from "../src/app.module.js";
import { API_CONFIG, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, type BlobStore } from "../src/storage/blob-store.js";
import { TEST_AUTH_SECRET } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

// Better Auth snapshots NODE_ENV at import and treats TEST=true as the test
// runtime, where a missing IP becomes 127.0.0.1 instead of one shared bucket.
if (process.env.NODE_ENV !== "production") {
  throw new Error("Rate-limit tests must run with NODE_ENV=production.");
}
delete process.env.TEST;

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

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

class UnusedBlobStore implements BlobStore {
  async put(): Promise<void> {}

  async get(): Promise<{ body: AsyncIterable<Uint8Array> }> {
    throw new Error("Blob store is unused by the rate-limit test");
  }

  async delete(): Promise<void> {}
}

describe("sign-in rate limit", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let app: INestApplication | undefined;
  let port = 0;

  beforeAll(async () => {
    delete process.env.TEST;
    process.env.BETTER_AUTH_SECRET = TEST_AUTH_SECRET;
    isolated = await createIsolatedDatabase();
    process.env.DATABASE_URL = isolated.databaseUrl;
    await execFileAsync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl, NODE_ENV: "development" },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(BLOB_STORE)
      .useValue(new UnusedBlobStore())
      .overrideProvider(PublicViewLimiter)
      .useValue(new PublicViewLimiter(3, 60_000))
      .compile();
    app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
    configureHttpApp(app);
    await app.init();
    await app.listen(0, "127.0.0.1");
    port = Number(new URL(await app.getUrl()).port);
  });

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
  });

  it("keeps spoofed forwarding headers in one bucket and separates socket peers", async () => {
    const firstPeer: number[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      firstPeer.push(await postSignIn(port, "127.0.0.1", attempt));
    }
    expect(firstPeer, firstPeer.join(",")).toEqual(Array.from({ length: 10 }, () => 401));

    const limited = await postSignIn(port, "127.0.0.1", 10);
    expect(limited).toBe(429);

    const otherAccount = await postSignIn(port, "127.0.0.1", 11);
    expect(otherAccount).toBe(429);

    const secondPeer = await postSignIn(port, "127.0.0.2", 12);
    expect(secondPeer).toBe(401);
  });

  it("gives two visitors opening a public link separate buckets", async () => {
    const token = "a".repeat(43);
    const first = await publicView(port, "127.0.0.1", token, 1);
    const second = await publicView(port, "127.0.0.1", token, 2);
    const third = await publicView(port, "127.0.0.1", token, 3);
    expect([first.status, second.status, third.status]).toEqual([404, 404, 404]);
    for (const response of [first, second, third]) {
      expect(response.body).not.toContain(token);
    }

    const limited = await publicView(port, "127.0.0.1", token, 4);
    expect(limited.status).toBe(429);
    expect(limited.body).toContain("RATE_LIMITED");
    expect(limited.body).not.toContain(token);

    const otherPeer = await publicView(port, "127.0.0.2", token, 5);
    expect(otherPeer.status).toBe(404);
    expect(otherPeer.body).not.toContain(token);
  });
});

function publicView(
  port: number,
  localAddress: string,
  token: string,
  attempt: number,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        localAddress,
        method: "GET",
        path: `/api/v1/public/artifacts/00000000-0000-4000-8000-000000000000/${token}`,
        headers: {
          "x-forwarded-for": `203.0.113.${attempt}`,
          [CLIENT_IP_HEADER]: `198.51.100.${attempt}`,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

function postSignIn(port: number, localAddress: string, attempt: number): Promise<number> {
  const body = JSON.stringify({
    email: `nobody-${attempt}-${randomUUID()}@example.invalid`,
    password: "incorrect-password-1",
  });
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        localAddress,
        method: "POST",
        path: "/api/auth/sign-in/email",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "content-length": Buffer.byteLength(body),
          "x-forwarded-for": `203.0.113.${attempt}`,
          [CLIENT_IP_HEADER]: `198.51.100.${attempt}`,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}
