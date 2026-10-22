import "reflect-metadata";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { Agent, request as httpRequest } from "node:http";
import { connect as openTcp, type Socket } from "node:net";
import { getActiveResourcesInfo } from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  apiErrorSchema,
  artifactEnvelopeSchema,
  artifactListEnvelopeSchema,
  contextEnvelopeSchema,
  healthEnvelopeSchema,
  publicArtifactEnvelopeSchema,
  publicUnlockEnvelopeSchema,
  shareEnvelopeSchema,
  type ArtifactDto,
} from "@factrove/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONTENT_GRANT_TTL_SECONDS, mintContentGrant } from "../src/auth/content-grant.js";
import { REJECT_DEADLINE_MS } from "../src/controllers/html-upload.js";
import { configureHttpApp } from "../src/configure-http-app.js";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ArtifactsRepository } from "../src/database/repositories/artifacts.repository.js";
import { claimLocalArtifacts } from "../src/database/seed/claim-local-artifacts.js";
import { localOrganizationFixture, localUserFixture, seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, readApiConfig, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, BlobNotFoundError, BlobStoreUnavailableError, type BlobStore } from "../src/storage/blob-store.js";
import { withMarkdownConversionSlot } from "../src/rendering/convert-html-to-markdown.js";
import { markdownContentSecurityPolicy, MAX_HTML_BYTES } from "../src/rendering/html-policy.js";
import { ARGON2_VERIFY_LIMIT } from "../src/sharing/argon2-gate.js";
import {
  PasswordAttemptLimiter,
  PASSWORD_ATTEMPT_MAX_KEYS,
  PASSWORD_ATTEMPT_WINDOW_MS,
  PASSWORD_ATTEMPTS_PER_CLIENT,
  PASSWORD_ATTEMPTS_PER_SHARE,
  SHARE_DELAY_MAX_MS,
  VERIFY_ATTEMPTS_PER_MINUTE,
} from "../src/sharing/password-attempt-limit.js";
import { browserOrigins } from "../src/sharing/public-origin.js";
import { SHARE_TICKET_MAX_USES } from "../src/sharing/share-grant.js";
import { createShareToken, hashShareToken } from "../src/sharing/share-link.js";
import { deriveShareTokenKey, encryptShareToken } from "../src/sharing/share-token-cipher.js";
import { addMembership, signUpWithApiKey, TEST_AUTH_SECRET, type SignedInUser } from "./auth-session.js";
import { createIsolatedDatabase, dropIsolatedDatabase, type IsolatedDatabase } from "./isolated-database.js";

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
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

let ownerApiKey = "";

class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>();
  failPut = false;
  putThenFail = false;
  putError: Error | undefined;
  failGet = false;
  throwBeforeChunk = false;
  interruptAfterFirstChunk = false;
  pauseAfterFirstByte = false;
  bodyPaused: Promise<void> = Promise.resolve();
  private releasePausedBody: (() => void) | null = null;
  private markBodyPaused: (() => void) | null = null;

  armBodyPause(): void {
    this.pauseAfterFirstByte = true;
    this.bodyPaused = new Promise((resolve) => {
      this.markBodyPaused = resolve;
    });
  }

  continueBody(): void {
    this.releasePausedBody?.();
    this.releasePausedBody = null;
  }

  async put(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    if (this.putError) {
      throw this.putError;
    }
    if (this.failPut) {
      throw new BlobStoreUnavailableError("Object storage is unavailable");
    }
    this.objects.set(input.objectKey, Uint8Array.from(input.body));
    if (this.putThenFail) {
      throw new BlobStoreUnavailableError("Object storage is unavailable");
    }
  }

  async get(objectKey: string): Promise<{ body: AsyncIterable<Uint8Array> }> {
    if (this.failGet) {
      throw new BlobStoreUnavailableError("Object storage is unavailable");
    }
    const stored = this.objects.get(objectKey);
    if (!stored) {
      throw new BlobNotFoundError(objectKey);
    }
    if (this.throwBeforeChunk) {
      return {
        body: (async function* failed() {
          throw new BlobStoreUnavailableError("Object storage is unavailable");
        })(),
      };
    }
    if (this.interruptAfterFirstChunk) {
      return {
        body: (async function* interrupted() {
          yield stored.subarray(0, 1);
          throw new BlobStoreUnavailableError("Object storage is unavailable");
        })(),
      };
    }
    if (this.pauseAfterFirstByte) {
      this.pauseAfterFirstByte = false;
      const snapshot = Uint8Array.from(stored);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.releasePausedBody = release;
      const mark = this.markBodyPaused;
      return {
        body: (async function* paused() {
          yield snapshot.subarray(0, 1);
          mark?.();
          await gate;
          if (snapshot.byteLength > 1) {
            yield snapshot.subarray(1);
          }
        })(),
      };
    }
    const midpoint = Math.ceil(stored.byteLength / 2);
    const head = stored.subarray(0, midpoint);
    const tail = stored.subarray(midpoint);
    return {
      body: (async function* split() {
        yield head;
        if (tail.byteLength > 0) {
          yield tail;
        }
      })(),
    };
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  reset(): void {
    this.continueBody();
    this.markBodyPaused?.();
    this.objects.clear();
    this.failPut = false;
    this.putThenFail = false;
    this.putError = undefined;
    this.failGet = false;
    this.throwBeforeChunk = false;
    this.interruptAfterFirstChunk = false;
    this.pauseAfterFirstByte = false;
    this.releasePausedBody = null;
    this.markBodyPaused = null;
    this.bodyPaused = Promise.resolve();
  }
}

describe("API configuration", () => {
  it("binds to loopback and the local origins by default", () => {
    const defaults = readApiConfig({ BETTER_AUTH_SECRET: TEST_AUTH_SECRET });
    expect(defaults.host).toBe("127.0.0.1");
    expect(defaults.port).toBe(3001);
    expect(defaults.webOrigin).toBe("http://localhost:3000");
    expect(defaults.apiPublicOrigin).toBe("http://localhost:3001");
    expect(defaults.publicBaseUrl).toBe("http://localhost:3000");
    expect(defaults.authSecret).toBe(TEST_AUTH_SECRET);
    expect(defaults.authCookieDomain).toBeNull();
    expect(defaults.trustedProxies).toEqual([]);
    expect(defaults.shareTokenKey).toBeNull();
  });

  it("accepts a parent domain that covers both origins", () => {
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_COOKIE_DOMAIN: ".Factrove.Example.com",
      WEB_ORIGIN: "https://app.factrove.example.com",
      API_PUBLIC_ORIGIN: "https://api.factrove.example.com",
    }).authCookieDomain).toBe("factrove.example.com");
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      TRUSTED_PROXIES: " 10.0.0.0/8, 192.168.1.10 ",
    }).trustedProxies).toEqual(["10.0.0.0/8", "192.168.1.10"]);
  });

  it("rejects a cookie domain or proxy list the browser or limiter would mishandle", () => {
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_COOKIE_DOMAIN: "https://example.com",
    })).toThrow(/AUTH_COOKIE_DOMAIN/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_COOKIE_DOMAIN: "127.0.0.1",
      WEB_ORIGIN: "http://127.0.0.1:3000",
      API_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
    })).toThrow(/IP address/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_COOKIE_DOMAIN: "co.uk",
      WEB_ORIGIN: "https://app.co.uk",
      API_PUBLIC_ORIGIN: "https://api.co.uk",
    })).toThrow(/public suffix/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_COOKIE_DOMAIN: "example.com",
    })).toThrow(/WEB_ORIGIN/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      SHARE_TOKEN_KEY: "too-short",
    })).toThrow(/SHARE_TOKEN_KEY/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      TRUSTED_PROXIES: "10.0.0.0/99",
    })).toThrow(/TRUSTED_PROXIES/);
  });

  it("rejects a short auth secret", () => {
    expect(() => readApiConfig({ BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects an origin that includes a path", () => {
    expect(() => readApiConfig({ WEB_ORIGIN: "http://localhost:3000/app" })).toThrow(/WEB_ORIGIN/);
  });

  it("defaults the public base URL to WEB_ORIGIN and accepts localhost or a domain", () => {
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "http://localhost:3000",
    }).publicBaseUrl).toBe("http://localhost:3000");
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_BASE_URL: "http://localhost:4000",
    }).publicBaseUrl).toBe("http://localhost:4000");
    const published = readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "https://app.factrove.example.com",
      API_PUBLIC_ORIGIN: "https://api.factrove.example.com",
      PUBLIC_BASE_URL: "https://factrove.example.com",
      AUTH_COOKIE_DOMAIN: "factrove.example.com",
      SHARE_TOKEN_KEY: "dedicated-share-token-key-value-here",
    });
    expect(published.publicBaseUrl).toBe("https://factrove.example.com");
    expect(published.shareTokenKey).toBe("dedicated-share-token-key-value-here");
    expect(browserOrigins(published.webOrigin, published.publicBaseUrl)).toEqual([
      "https://factrove.example.com",
      "https://app.factrove.example.com",
    ]);
    expect(readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "https://app.factrove.example.com",
      API_PUBLIC_ORIGIN: "https://api.factrove.example.com",
      PUBLIC_BASE_URL: "https://Factrove.Example.com/",
      AUTH_COOKIE_DOMAIN: "factrove.example.com",
    }).publicBaseUrl).toBe("https://factrove.example.com");
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      PUBLIC_BASE_URL: "https://factrove.app",
    })).toThrow(/same host/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "http://127.0.0.1:3000",
      API_PUBLIC_ORIGIN: "http://127.0.0.1:3001",
      PUBLIC_BASE_URL: "http://localhost:3000",
    })).toThrow(
      "Use the same host for WEB_ORIGIN and PUBLIC_BASE_URL. A cookie domain cannot cover localhost or an IP address.",
    );
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "https://app.factrove.example.com",
      API_PUBLIC_ORIGIN: "https://api.factrove.example.com",
      PUBLIC_BASE_URL: "https://share.factrove.example.com",
    })).toThrow(/Set AUTH_COOKIE_DOMAIN/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      WEB_ORIGIN: "https://app.factrove.example.com",
      API_PUBLIC_ORIGIN: "https://api.factrove.example.com",
      PUBLIC_BASE_URL: "https://other.example",
      AUTH_COOKIE_DOMAIN: "factrove.example.com",
    })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      PUBLIC_BASE_URL: "https://factrove.app/share",
    })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      PUBLIC_BASE_URL: "https://factrove.app/?share=1",
    })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      PUBLIC_BASE_URL: "https://factrove.app/#share",
    })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => readApiConfig({
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      PUBLIC_BASE_URL: "ftp://factrove.app",
    })).toThrow(/PUBLIC_BASE_URL/);
  });
});

describe("HTTP API", () => {
  const store = new MemoryBlobStore();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  let isolated: IsolatedDatabase | undefined;
  let app: INestApplication;
  let baseUrl = "";
  let prisma: PrismaService;
  let owner: SignedInUser;

  beforeAll(async () => {
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
      email: "owner@example.invalid",
      password: "owner-password-1",
      name: "Owner",
      keyName: "tests",
    });
    ownerApiKey = owner.apiKey;
    await addMembership(prisma, owner.userId, localOrganizationFixture.id);
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

  beforeEach(async () => {
    store.reset();
    await prisma.artifact.deleteMany();
    await prisma.user.deleteMany({ where: { id: { notIn: [localUserFixture.id, owner.userId] } } });
  });

  it("reports health without a session and context for the API key owner", async () => {
    const health = await ownerFetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(healthEnvelopeSchema.parse(await health.json())).toEqual({ status: "ok" });

    const anonymous = await globalThis.fetch(`${baseUrl}/api/v1/context?userId=someone-else`);
    expect(anonymous.status).toBe(401);
    expect(await errorOf(anonymous)).toEqual({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });

    const context = await ownerFetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: `Bearer ${owner.apiKey}` },
    });
    expect(context.status).toBe(200);
    expect(contextEnvelopeSchema.parse(await context.json())).toEqual({
      user: { id: owner.userId, name: "Owner" },
      organization: { id: localOrganizationFixture.id, name: localOrganizationFixture.name },
    });
  });

  it("uploads a private artifact by default and keeps configured urls", async () => {
    const bytes = new TextEncoder().encode("<p>你好\r\n</p><script>1</script>");
    const response = await postFile(baseUrl, "notes/hello.HTML", bytes);
    expect(response.status).toBe(201);
    const body = artifactEnvelopeSchema.parse(await response.json());
    expect(body.artifact.accessType).toBe("private");
    expect(body.artifact.organizationId).toBe(localOrganizationFixture.id);
    expect(body.artifact.creatorUserId).toBe(owner.userId);
    expect(body.artifact.mimeType).toBe("text/html");
    expect(body.artifact.filename).toBe(`${body.artifact.id}.html`);
    expect(body.artifact.name).toBe("hello");
    expect(body.artifact.sizeBytes).toBe(bytes.byteLength);
    expect(body.artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${body.artifact.id}`);
    expectPlainContentUrl(body.artifact.contentUrl, body.artifact.id);
    const storedRow = await prisma.artifact.findUniqueOrThrow({ where: { id: body.artifact.id } });
    expect(storedRow.objectKey.startsWith(`${body.artifact.id}/`)).toBe(true);
    expect(storedRow.objectKey.endsWith(".html")).toBe(true);
    expect(storedRow.contentRevision).toBe(0);
    expect(Buffer.from(store.objects.get(storedRow.objectKey) ?? new Uint8Array())).toEqual(Buffer.from(bytes));

    const listed = await ownerFetch(`${baseUrl}/api/v1/artifacts`);
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toContain("no-store");
    const list = artifactListEnvelopeSchema.parse(await listed.json());
    expect(list.items.map((item) => item.id)).toEqual([body.artifact.id]);
    expectPlainContentUrl(list.items[0]?.contentUrl ?? "", body.artifact.id);

    const detailResponse = await ownerFetch(`${baseUrl}/api/v1/artifacts/${body.artifact.id}`);
    expect(detailResponse.status).toBe(200);
    expect(artifactEnvelopeSchema.parse(await detailResponse.json()).artifact).toEqual(body.artifact);

    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${body.artifact.id}/content`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
    expectHtmlHeaders(content.headers);
  });

  it("mints a short HTML grant only for a session detail read", async () => {
    const bytes = new TextEncoder().encode("<p>grant</p>");
    const artifact = await upload(baseUrl, "grant.html", bytes);
    expectPlainContentUrl(artifact.contentUrl, artifact.id);

    const apiDetail = artifactEnvelopeSchema.parse(
      await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json(),
    );
    expect(apiDetail.artifact.contentUrl).toBe(artifact.contentUrl);

    const sessionDetail = artifactEnvelopeSchema.parse(await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, {
      headers: { cookie: owner.cookie },
    })).json());
    expectGrantedContentUrl(sessionDetail.artifact.contentUrl, artifact.id);

    const grantedUrl = new URL(sessionDetail.artifact.contentUrl);
    const granted = await globalThis.fetch(new URL(`${grantedUrl.pathname}${grantedUrl.search}`, baseUrl));
    expect(granted.status).toBe(200);
    expect(Buffer.from(await granted.arrayBuffer())).toEqual(Buffer.from(bytes));

    const markdownUrl = new URL(grantedUrl);
    markdownUrl.searchParams.set("format", "markdown");
    const markdown = await globalThis.fetch(new URL(`${markdownUrl.pathname}${markdownUrl.search}`, baseUrl));
    expect(markdown.status).toBe(404);
    expect(await errorOf(markdown)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });

    const expiredToken = mintContentGrant(
      artifact.id,
      TEST_AUTH_SECRET,
      Date.now() - (CONTENT_GRANT_TTL_SECONDS + 120) * 1000,
    );
    const expired = await globalThis.fetch(
      `${baseUrl}/api/v1/artifacts/${artifact.id}/content?access=${encodeURIComponent(expiredToken)}`,
    );
    expect(expired.status).toBe(404);

    const withHeader = await globalThis.fetch(new URL(`${grantedUrl.pathname}${grantedUrl.search}`, baseUrl), {
      headers: { "x-api-key": owner.apiKey },
    });
    expect(withHeader.status).toBe(404);
  });

  it("preserves fixture bytes for an htm upload under a html object key", async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const response = await postFile(baseUrl, "hello.htm", bytes);
    expect(response.status).toBe(201);
    const artifact = artifactEnvelopeSchema.parse(await response.json()).artifact;
    expect(artifact.filename).toBe(`${artifact.id}.html`);
    const stored = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(stored.objectKey.startsWith(`${artifact.id}/`)).toBe(true);
    expect(stored.objectKey.endsWith(".html")).toBe(true);
    expect([...store.objects.keys()]).toEqual([stored.objectKey]);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
  });

  it("preserves a utf-8 bom", async () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<p>bom</p>")]);
    const artifact = await upload(baseUrl, "bom.html", bytes);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
  });

  it("does not take artifact urls from the Host header", async () => {
    const artifact = await upload(baseUrl, "host.html", new TextEncoder().encode("<p>host</p>"));
    const detail = await getWithHost(`${baseUrl}/api/v1/artifacts/${artifact.id}`, "evil.example");
    expect(detail.status).toBe(200);
    const body = artifactEnvelopeSchema.parse(detail.json);
    expect(body.artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${artifact.id}`);
    expectPlainContentUrl(body.artifact.contentUrl, artifact.id);
  });

  it("hides a private artifact and its content from anonymous callers", async () => {
    const artifact = await upload(baseUrl, "private.html", new TextEncoder().encode("<p>private</p>"));
    const detail = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, { headers: {} });
    const content = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    const unknown = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`);
    expect(detail.status).toBe(404);
    expect(content.status).toBe(404);
    expect(await errorOf(detail)).toEqual(await errorOf(unknown));
    expect(detail.headers.get("www-authenticate")).toBeNull();
  });

  it("assigns pre-existing local artifacts to a signed-up account without changing their ids", async () => {
    const legacyPrivateId = "123e4567-e89b-42d3-a456-426614174098";
    const legacySharedId = "123e4567-e89b-42d3-a456-426614174099";
    await prisma.artifact.create({
      data: {
        id: legacyPrivateId,
        creatorUserId: localUserFixture.id,
        organizationId: localOrganizationFixture.id,
        accessType: "private",
        mimeType: "text/html",
        sizeBytes: 5,
        objectKey: `${legacyPrivateId}.html`,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        uploadedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    await prisma.artifact.create({
      data: {
        id: legacySharedId,
        creatorUserId: localUserFixture.id,
        organizationId: localOrganizationFixture.id,
        accessType: "org_shared",
        mimeType: "text/html",
        sizeBytes: 6,
        objectKey: `${legacySharedId}.html`,
        createdAt: new Date("2026-01-03T00:00:00.000Z"),
        uploadedAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    });
    const kept = await upload(baseUrl, "kept.html", new TextEncoder().encode("<p>kept</p>"));

    const heir = await signUpWithApiKey(baseUrl, {
      email: "heir@example.invalid",
      password: "heir-password-1",
      name: "Heir",
      keyName: "upgrade",
    });
    const heirHeaders = { authorization: `Bearer ${heir.apiKey}` };

    const beforeMine = artifactListEnvelopeSchema.parse(
      await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, { headers: heirHeaders })).json(),
    );
    const beforeOrg = artifactListEnvelopeSchema.parse(
      await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts?view=org`, { headers: heirHeaders })).json(),
    );
    const beforeDetail = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${legacyPrivateId}`, { headers: heirHeaders });
    expect(beforeMine.items).toEqual([]);
    expect(beforeOrg.items).toEqual([]);
    expect(beforeDetail.status).toBe(404);
    expect(await errorOf(beforeDetail)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });

    const localSignIn = await globalThis.fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email: localUserFixture.email, password: "local-password-1" }),
    });
    const localSignUp = await globalThis.fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        email: localUserFixture.email,
        password: "local-password-1",
        name: "Local User",
      }),
    });
    expect(localSignIn.status).toBe(401);
    expect(localSignUp.status).toBe(422);
    await expect(claimLocalArtifacts(prisma, localUserFixture.email)).rejects.toThrow(
      "The seeded local user has no password.",
    );
    await expect(claimLocalArtifacts(prisma, "missing@example.invalid")).rejects.toThrow(
      "No account exists for missing@example.invalid.",
    );
    const passwordlessId = randomUUID();
    await prisma.user.create({
      data: {
        id: passwordlessId,
        name: "No Password",
        email: "nopass@example.invalid",
        emailVerified: false,
      },
    });
    await expect(claimLocalArtifacts(prisma, "nopass@example.invalid")).rejects.toThrow(
      "That account cannot sign in.",
    );

    const claimed = await claimLocalArtifacts(prisma, heir.email);
    expect(claimed).toMatchObject({
      userId: heir.userId,
      email: heir.email,
      artifactsClaimed: 2,
      membershipsAdded: 1,
    });

    const afterMine = artifactListEnvelopeSchema.parse(
      await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, { headers: heirHeaders })).json(),
    );
    const afterOrg = artifactListEnvelopeSchema.parse(
      await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts?view=org`, { headers: heirHeaders })).json(),
    );
    expect(afterMine.items.map((item) => item.id)).toEqual([legacySharedId, legacyPrivateId]);
    expect(afterOrg.items.map((item) => item.id)).toEqual([legacySharedId]);

    const detail = artifactEnvelopeSchema.parse(
      await (await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${legacyPrivateId}`, { headers: heirHeaders })).json(),
    );
    expect(detail.artifact.id).toBe(legacyPrivateId);
    expect(detail.artifact.creatorUserId).toBe(heir.userId);
    expect(detail.artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${legacyPrivateId}`);
    const stored = await prisma.artifact.findUniqueOrThrow({ where: { id: legacyPrivateId } });
    expect(stored.creatorUserId).toBe(heir.userId);
    expect(stored.organizationId).toBe(localOrganizationFixture.id);

    const ownerList = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts`)).json());
    expect(ownerList.items.map((item) => item.id)).toEqual([kept.id]);
    const anonymous = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${legacyPrivateId}`);
    expect(anonymous.status).toBe(404);

    const again = await claimLocalArtifacts(prisma, heir.email);
    expect(again.artifactsClaimed).toBe(0);
    expect(again.membershipsAdded).toBe(0);
    const still = await prisma.artifact.findUniqueOrThrow({ where: { id: legacySharedId } });
    expect(still.creatorUserId).toBe(heir.userId);
    expect(still.id).toBe(legacySharedId);
  });

  it("lists mine and org artifacts with the shared filters", async () => {
    await prisma.user.create({
      data: {
        id: "other-user",
        name: "Other User",
        email: "other@example.invalid",
        emailVerified: false,
      },
    });
    const repository = app.get(ArtifactsRepository);
    const otherSharedId = randomUUID();
    const otherPrivateId = randomUUID();
    await repository.create({
      id: otherSharedId,
      creatorUserId: "other-user",
      organizationId: localOrganizationFixture.id,
      accessType: "org_shared",
      mimeType: "text/html",
      sizeBytes: 1,
      uploadedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    await repository.create({
      id: otherPrivateId,
      creatorUserId: "other-user",
      organizationId: localOrganizationFixture.id,
      accessType: "private",
      mimeType: "text/html",
      sizeBytes: 1,
      uploadedAt: new Date("2026-02-02T00:00:00.000Z"),
    });

    const minePrivate = await upload(baseUrl, "mine.html", new TextEncoder().encode("<p>mine</p>"));
    const mineShared = await upload(baseUrl, "shared.html", new TextEncoder().encode("<p>shared</p>"), {
      accessType: "org_shared",
    });

    const mine = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts?view=mine`)).json());
    const org = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts?view=org`)).json());
    expect(mine.items.map((item) => item.id).sort()).toEqual([minePrivate.id, mineShared.id].sort());
    expect(org.items.map((item) => item.id).sort()).toEqual([mineShared.id, otherSharedId].sort());
    expect(org.items.map((item) => item.id)).not.toContain(minePrivate.id);
    expect(org.items.map((item) => item.id)).not.toContain(otherPrivateId);
    expect(mine.items.map((item) => item.id)).not.toContain(otherSharedId);
  });

  it("orders artifacts by creation time and then id descending", async () => {
    const older = await upload(baseUrl, "older.html", new TextEncoder().encode("<p>older</p>"));
    const newer = await upload(baseUrl, "newer.html", new TextEncoder().encode("<p>newer</p>"));
    await prisma.artifact.update({
      where: { id: older.id },
      data: { createdAt: new Date("2026-03-01T00:00:00.000Z") },
    });
    await prisma.artifact.update({
      where: { id: newer.id },
      data: { createdAt: new Date("2026-03-01T00:00:00.000Z") },
    });

    const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts`)).json());
    const expected = [older.id, newer.id].sort((left, right) => (left < right ? 1 : -1));
    expect(listed.items.map((item) => item.id)).toEqual(expected);
  });

  it("rejects malformed uploads without inserting a row", async () => {
    const cases: Array<{ filename?: string; bytes: Uint8Array; fields?: Record<string, string>; status: number; code: string }> = [
      { bytes: new Uint8Array(), status: 400, code: "INVALID_REQUEST" },
      { filename: "empty.html", bytes: new Uint8Array(), status: 400, code: "INVALID_REQUEST" },
      { filename: "notes.txt", bytes: new TextEncoder().encode("<p>x</p>"), status: 415, code: "UNSUPPORTED_FILE_TYPE" },
      { filename: "bad.html", bytes: Uint8Array.from([0xff, 0xfe]), status: 400, code: "INVALID_REQUEST" },
    ];

    for (const entry of cases) {
      const response = entry.filename
        ? await postFile(baseUrl, entry.filename, entry.bytes, entry.fields)
        : await ownerFetch(`${baseUrl}/api/v1/artifacts`, { method: "POST" });
      expect(response.status).toBe(entry.status);
      expect((await errorOf(response)).code).toBe(entry.code);
    }

    const jsonResponse = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessType: "private" }),
    });
    expect(jsonResponse.status).toBe(400);
    expect((await errorOf(jsonResponse)).code).toBe("INVALID_REQUEST");

    const oversizedJson = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(200_000) }),
    });
    expect(oversizedJson.status).toBe(413);
    expect((await errorOf(oversizedJson)).code).toBe("FILE_TOO_LARGE");
    expect(oversizedJson.headers.get("content-type")).toContain("application/json");

    const extraFile = new FormData();
    extraFile.append("file", new Blob(["<p>a</p>"]), "a.html");
    extraFile.append("file", new Blob(["<p>b</p>"]), "b.html");
    const multiple = await ownerFetch(`${baseUrl}/api/v1/artifacts`, { method: "POST", body: extraFile });
    expect(multiple.status).toBe(400);
    expect((await errorOf(multiple)).message).toBe("Send exactly one file.");

    const wrongField = new FormData();
    wrongField.append("document", new Blob(["<p>a</p>"]), "a.html");
    const unexpected = await ownerFetch(`${baseUrl}/api/v1/artifacts`, { method: "POST", body: wrongField });
    expect(unexpected.status).toBe(400);

    const identity = await postFile(baseUrl, "owned.html", new TextEncoder().encode("<p>x</p>"), {
      creatorUserId: "someone-else",
      accessType: "private",
    });
    expect(identity.status).toBe(400);
    expect((await errorOf(identity)).message).toContain("assigned by the server");

    const access = await postFile(baseUrl, "bad-access.html", new TextEncoder().encode("<p>x</p>"), {
      accessType: "public",
    });
    expect(access.status).toBe(400);
    expect((await errorOf(access)).code).toBe("INVALID_REQUEST");

    expect(await prisma.artifact.count()).toBe(0);
    expect(store.objects.size).toBe(0);
  });

  it("returns 400 for a file part with no filename and keeps serving", async () => {
    const missingId = "00000000-0000-4000-8000-000000000099";
    const bodies = [
      ["----factrove-nofile", undefined],
      ["----factrove-emptyfile", ""],
    ] as const;
    for (const [boundary, filename] of bodies) {
      const body = filePartWithoutFilename(boundary, filename);
      const created = await postMultipart(baseUrl, boundary, body);
      expect(created.status).toBe(400);
      expect((await errorOf(created)).message).toBe("Send exactly one file.");
      const replaced = await putMultipart(baseUrl, missingId, boundary, body);
      expect(replaced.status).toBe(400);
      expect((await errorOf(replaced)).message).toBe("Send exactly one file.");
    }
    expect(await prisma.artifact.count()).toBe(0);
    const alive = await upload(baseUrl, "alive.html", new TextEncoder().encode("<p>alive</p>"));
    expect(alive.name).toBe("alive");
  });

  it("answers known multipart errors while the client is still trickling", async () => {
    const boundary = "----factrove-pause";
    const wrongField =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename="a.html"\r\n` +
      `Content-Type: text/html\r\n\r\n`;
    const malformed = `--${boundary}\r\nThis is not a header\r\n`;
    const tooManyFields = Array.from({ length: 9 }, (_, index) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="extra${index}"\r\n\r\n${index}\r\n`,
    ).join("");
    const cases = [
      ["POST", "/api/v1/artifacts", wrongField, "Send exactly one file."],
      ["PUT", "/api/v1/artifacts/00000000-0000-4000-8000-000000000099/content", wrongField, "Send exactly one file."],
      ["POST", "/api/v1/artifacts", malformed, "The request must be multipart form data with one file."],
      ["POST", "/api/v1/artifacts", tooManyFields, "The request is invalid."],
    ] as const;
    for (const [method, path, head, message] of cases) {
      const result = await tricklingMultipart(baseUrl, method, path, boundary, Buffer.from(head, "utf8"));
      expect(result.status).toBe(400);
      expect(result.message).toBe(message);
      expect(result.elapsed).toBeLessThan(1000);
    }
    expect(await prisma.artifact.count()).toBe(0);
    expect((await upload(baseUrl, "after-trickle.html", new TextEncoder().encode("<p>after</p>"))).name).toBe("after-trickle");
  });

  it("returns the JSON 400 for a large invalid upload and keeps an earlier response", async () => {
    const boundary = "----factrove-large-close";
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.html"\r\nContent-Type: text/html\r\n\r\n`,
      "utf8",
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const body = Buffer.concat([prefix, Buffer.alloc(8 * 1024 * 1024, 0x78), suffix]);
    const rejected = await writeThenRead(baseUrl, "POST", "/api/v1/artifacts", {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      connection: "keep-alive",
    }, body);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.connection).toBe("close");
    expect(JSON.parse(rejected.body.toString("utf8")).error.message).toBe("Send exactly one file.");

    const stored = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const artifact = await upload(baseUrl, "slow.html", stored);
    const pipelined = await slowPipelinedRead(baseUrl, artifact.id, boundary);
    expect(pipelined.messages[0]?.status).toBe(200);
    expect(pipelined.messages[0]?.headers.connection?.toLowerCase()).not.toBe("close");
    expect(pipelined.messages[0]?.body.equals(stored)).toBe(true);
    expect(pipelined.messages[1]?.status).toBe(400);
    expect(pipelined.messages[1]?.headers.connection).toBe("close");
    expect(JSON.parse(pipelined.messages[1]?.body.toString("utf8") ?? "{}").error.message).toBe("Send exactly one file.");
  });

  it("returns both pipelined bodies while a failing upload is still sending past 64 KiB", async () => {
    const boundary = "----factrove-backpressure";
    const stored = Buffer.alloc(8 * 1024 * 1024, 0x61);
    const artifact = await upload(baseUrl, "slow-more.html", stored);
    const postBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.html"\r\nContent-Type: text/html\r\n\r\n`,
        "utf8",
      ),
      Buffer.alloc(128 * 1024, 0x79),
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
    ]);
    expect(postBody.length).toBeGreaterThan(64 * 1024);
    const pipelined = await backpressuredPipelinedRead(baseUrl, artifact.id, boundary, postBody);
    expect(pipelined.bytesSent).toBe(postBody.length);
    expect(pipelined.bytesSentAfterRead).toBeGreaterThan(64 * 1024);
    expect(pipelined.messages).toHaveLength(2);
    expect(pipelined.messages[0]?.status).toBe(200);
    expect(pipelined.messages[0]?.body.equals(stored)).toBe(true);
    expect(pipelined.messages[1]?.status).toBe(400);
    expect(JSON.parse(pipelined.messages[1]?.body.toString("utf8") ?? "{}").error.message).toBe("Send exactly one file.");
  });

  it("releases rejected sockets on a deadline when the peer stays open or earlier output is blocked", async () => {
    const port = Number(new URL(baseUrl).port);
    const stored = Buffer.alloc(5 * 1024 * 1024, 0x62);
    const artifact = await upload(baseUrl, "blocked.html", stored);
    const boundary = "----factrove-deadline";
    const tiny = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.html"\r\nContent-Type: text/html\r\n\r\nhello\r\n--${boundary}--\r\n`,
      "utf8",
    );
    const baselineTcp = tcpSocketCount();
    const baselineServer = serverSocketCount(port);
    const halfOpen = await Promise.all(Array.from({ length: 8 }, () => halfOpenRejectedUpload(baseUrl, boundary, tiny)));
    for (const message of halfOpen) {
      expect(message.status).toBe(400);
      expect(JSON.parse(message.body.toString("utf8")).error.message).toBe("Send exactly one file.");
    }
    const blocked = await Promise.all(Array.from({ length: 8 }, () => blockedEarlierResponse(baseUrl, artifact.id, boundary)));
    const remotePorts = new Set([...halfOpen, ...blocked].map((client) => client.socket.localPort ?? -1));
    const openedAt = Date.now();
    await delay(1_000);
    expect(serverSocketsFor(port, remotePorts)).toBe(halfOpen.length + blocked.length);
    for (const client of blocked) {
      expect(client.socket.bytesRead).toBeLessThan(stored.length);
    }
    const remaining = REJECT_DEADLINE_MS - (Date.now() - openedAt);
    expect(remaining).toBeGreaterThan(2_000);
    await delay(remaining + 2_000);
    expect(serverSocketsFor(port, remotePorts)).toBe(0);
    expect(serverSocketCount(port)).toBeLessThanOrEqual(baselineServer);
    for (const client of [...halfOpen, ...blocked]) {
      client.socket.destroy();
    }
    await waitForTcpSockets(baselineTcp);
    expect(tcpSocketCount()).toBeLessThanOrEqual(baselineTcp);
  });

  it("rejects an empty field name before saving create or replace", async () => {
    const boundary = "----factrove-empty-name";
    const file = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ok.html"\r\nContent-Type: text/html\r\n\r\n<p>new</p>\r\n--${boundary}--\r\n`;
    for (const nameHeader of [
      `Content-Disposition: form-data; name=""`,
      `Content-Disposition: form-data`,
    ]) {
      const body = Buffer.from(`--${boundary}\r\n${nameHeader}\r\n\r\nhello\r\n${file}`, "utf8");
      const created = await postMultipart(baseUrl, boundary, body);
      expect(created.status).toBe(400);
      expect((await errorOf(created)).message).toBe("The request is invalid.");
    }
    expect(await prisma.artifact.count()).toBe(0);
    expect(store.objects.size).toBe(0);

    const artifact = await upload(baseUrl, "kept.html", new TextEncoder().encode("<p>kept</p>"));
    const before = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    const replaceBody = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name=""\r\n\r\nhello\r\n${file}`,
      "utf8",
    );
    const replaced = await putMultipart(baseUrl, artifact.id, boundary, replaceBody);
    expect(replaced.status).toBe(400);
    expect((await errorOf(replaced)).message).toBe("The request is invalid.");
    const after = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(after.name).toBe(before.name);
    expect(after.contentRevision).toBe(before.contentRevision);
    expect(after.sizeBytes).toBe(before.sizeBytes);
    expect(after.objectKey).toBe(before.objectKey);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(new TextDecoder().decode(await content.arrayBuffer())).toBe("<p>kept</p>");
    const missingName = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data\r\n\r\nhello\r\n${file}`,
      "utf8",
    );
    const replacedAgain = await putMultipart(baseUrl, artifact.id, boundary, missingName);
    expect(replacedAgain.status).toBe(400);
    expect((await errorOf(replacedAgain)).message).toBe("The request is invalid.");
    expect((await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).objectKey).toBe(before.objectKey);
  });

  it("keeps the non-multipart message and main's part ceiling", async () => {
    const text = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    expect(text.status).toBe(400);
    expect((await errorOf(text)).message).toBe("Send exactly one file.");

    const json = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(400);
    expect((await errorOf(json)).message).toBe("Send exactly one file.");

    const bare = await rawRequest(baseUrl, "POST", "/api/v1/artifacts", { "content-length": "5" }, Buffer.from("hello"));
    expect(bare.status).toBe(400);
    expect(bare.message).toBe("Send exactly one file.");

    const boundaryMissing = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "hello",
    });
    expect(boundaryMissing.status).toBe(400);
    expect((await errorOf(boundaryMissing)).message).toBe("The request must be multipart form data with one file.");

    const boundary = "----factrove-parts";
    const ignored = `--${boundary}\r\nContent-Type: text/plain\r\n\r\nignore\r\n`;
    const file = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ok.html"\r\nContent-Type: text/html\r\n\r\n<p>ok</p>\r\n--${boundary}--\r\n`;
    const rejected = await postMultipart(baseUrl, boundary, Buffer.from(`${ignored.repeat(11)}${file}`, "utf8"));
    expect(rejected.status).toBe(400);
    expect((await errorOf(rejected)).message).toBe("Send exactly one file.");
    expect(await prisma.artifact.count()).toBe(0);

    const accepted = await postMultipart(baseUrl, boundary, Buffer.from(`${ignored.repeat(10)}${file}`, "utf8"));
    expect(accepted.status).toBe(201);
    expect(artifactEnvelopeSchema.parse(await accepted.json()).artifact.name).toBe("ok");
  });

  it("rejects an oversized upload while accepting the 10 MiB boundary", async () => {
    const tooBig = new Uint8Array(MAX_HTML_BYTES + 1);
    tooBig.fill("a".charCodeAt(0));
    const rejected = await postFile(baseUrl, "big.html", tooBig);
    expect(rejected.status).toBe(413);
    expect(await errorOf(rejected)).toEqual({
      code: "FILE_TOO_LARGE",
      message: "The file exceeds the 10 MiB limit.",
    });
    expect(await prisma.artifact.count()).toBe(0);
    expect(store.objects.size).toBe(0);

    const exact = new Uint8Array(MAX_HTML_BYTES);
    exact.fill("b".charCodeAt(0));
    const accepted = await upload(baseUrl, "exact.html", exact);
    expect(accepted.sizeBytes).toBe(MAX_HTML_BYTES);
    const exactRow = await prisma.artifact.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(store.objects.get(exactRow.objectKey)?.byteLength).toBe(MAX_HTML_BYTES);
  });

  it("loads content for an uppercase id using the stored object key", async () => {
    const bytes = new TextEncoder().encode("<p>case</p>");
    const artifact = await upload(baseUrl, "case.html", bytes);
    const upperId = artifact.id.toUpperCase();
    const detail = await ownerFetch(`${baseUrl}/api/v1/artifacts/${upperId}`);
    expect(detail.status).toBe(200);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${upperId}/content`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
  });

  it("rejects invalid list and detail ids", async () => {
    const view = await ownerFetch(`${baseUrl}/api/v1/artifacts?view=all`);
    expect(view.status).toBe(400);
    expect((await errorOf(view)).code).toBe("INVALID_REQUEST");

    const blankView = await ownerFetch(`${baseUrl}/api/v1/artifacts?view=`);
    expect(blankView.status).toBe(400);

    const invalid = await ownerFetch(`${baseUrl}/api/v1/artifacts/not-a-uuid`);
    expect(invalid.status).toBe(400);
    expect((await errorOf(invalid)).code).toBe("INVALID_REQUEST");
    expect(invalid.headers.get("content-type")).toContain("application/json");

    const missing = await ownerFetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`);
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });

    const missingContent = await ownerFetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000/content`);
    expect(missingContent.status).toBe(404);
    expect(missingContent.headers.get("content-type")).toContain("application/json");
  });

  it("maps storage failures without leaving an artifact row", async () => {
    store.failPut = true;
    const unavailable = await postFile(baseUrl, "down.html", new TextEncoder().encode("<p>down</p>"));
    expect(unavailable.status).toBe(503);
    expect(await errorOf(unavailable)).toEqual({
      code: "STORAGE_UNAVAILABLE",
      message: "Object storage is unavailable.",
    });
    expect(await prisma.artifact.count()).toBe(0);

    store.failPut = false;
    store.putError = new Error("bucket factrove-secret-bucket");
    const unexpected = await postFile(baseUrl, "secret.html", new TextEncoder().encode("<p>secret</p>"));
    expect(unexpected.status).toBe(500);
    const body = await unexpected.text();
    expect(body).not.toContain("factrove-secret-bucket");
    expect(body).not.toContain("stack");
    expect(apiErrorSchema.parse(JSON.parse(body)).error.code).toBe("INTERNAL_ERROR");
    expect(await prisma.artifact.count()).toBe(0);

    store.putError = undefined;
    const artifact = await upload(baseUrl, "stored.html", new TextEncoder().encode("<p>stored</p>"));
    const storedKey = (await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).objectKey;
    store.objects.delete(storedKey);
    const missingObject = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(missingObject.status).toBe(404);
    expect((await errorOf(missingObject)).code).toBe("ARTIFACT_NOT_FOUND");
    const stillThere = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`);
    expect(stillThere.status).toBe(200);

    store.failGet = true;
    const getFailure = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(getFailure.status).toBe(503);
    expect((await errorOf(getFailure)).code).toBe("STORAGE_UNAVAILABLE");
  });

  it("replaces an artifact's content for the owner and keeps the same id", async () => {
    const original = new TextEncoder().encode("<p>original</p>");
    const next = new TextEncoder().encode("<h1>replaced</h1>");
    const artifact = await upload(baseUrl, "original.html", original, { accessType: "org_shared" });
    const response = await putContent(baseUrl, artifact.id, "next.html", next);
    expect(response.status).toBe(200);
    const replaced = artifactEnvelopeSchema.parse(await response.json()).artifact;
    expect(replaced.id).toBe(artifact.id);
    expect(replaced.accessType).toBe("org_shared");
    expect(replaced.creatorUserId).toBe(artifact.creatorUserId);
    expect(replaced.organizationId).toBe(artifact.organizationId);
    expect(replaced.createdAt).toBe(artifact.createdAt);
    expect(replaced.sizeBytes).toBe(next.byteLength);
    expect(replaced.shared).toBe(false);
    expect(replaced.filename).toBe(`${artifact.id}.html`);
    expect(artifact.name).toBe("original");
    expect(replaced.name).toBe("original");
    const replacedRow = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(replacedRow.objectKey.startsWith(`${artifact.id}/`)).toBe(true);
    expect(replacedRow.contentRevision).toBe(1);
    expect(replacedRow.sizeBytes).toBe(next.byteLength);
    expect(store.objects.size).toBe(1);
    expect(Buffer.from(store.objects.get(replacedRow.objectKey) ?? new Uint8Array())).toEqual(Buffer.from(next));
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(content.headers.get("content-length")).toBe(String(next.byteLength));
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(next));
    expect(await prisma.artifact.count()).toBe(1);
  });

  it("stores a name, keeps it when a replace omits one, and rejects an over-long name", async () => {
    const bytes = new TextEncoder().encode("<p>named</p>");
    const created = await upload(baseUrl, "calendar.html", bytes, { name: "  X launch calendar  " });
    expect(created.name).toBe("X launch calendar");
    expect(created.filename).toBe(`${created.id}.html`);

    const combined = await upload(baseUrl, "accent.html", bytes, { name: "e\u0301" });
    expect(combined.name).toBe("\u00e9");

    const kept = artifactEnvelopeSchema.parse(
      await (await putContent(baseUrl, created.id, "other-file.html", new TextEncoder().encode("<p>next</p>"))).json(),
    ).artifact;
    expect(kept.id).toBe(created.id);
    expect(kept.name).toBe("X launch calendar");

    const renamed = artifactEnvelopeSchema.parse(
      await (
        await putContent(baseUrl, created.id, "other-file.html", new TextEncoder().encode("<p>renamed</p>"), {
          name: "Renamed calendar",
        })
      ).json(),
    ).artifact;
    expect(renamed.name).toBe("Renamed calendar");

    const beforeReject = await prisma.artifact.findUniqueOrThrow({ where: { id: created.id } });
    const overLong = await putContent(baseUrl, created.id, "other-file.html", bytes, { name: "n".repeat(121) });
    expect(overLong.status).toBe(400);
    expect(await errorOf(overLong)).toEqual({
      code: "INVALID_REQUEST",
      message: "name must be one line of 1 to 120 characters.",
    });
    const blank = await postFile(baseUrl, "blank.html", bytes, { name: "   " });
    expect(blank.status).toBe(400);
    expect((await errorOf(blank)).message).toBe("name must be one line of 1 to 120 characters.");
    const brokenLine = await postFile(baseUrl, "line.html", bytes, { name: "hello\nthere" });
    expect(brokenLine.status).toBe(400);
    expect((await errorOf(brokenLine)).message).toBe("name must be one line of 1 to 120 characters.");
    const afterReject = await prisma.artifact.findUniqueOrThrow({ where: { id: created.id } });
    expect(afterReject.name).toBe("Renamed calendar");
    expect(afterReject.objectKey).toBe(beforeReject.objectKey);
    expect(afterReject.contentRevision).toBe(beforeReject.contentRevision);
    expect(await prisma.artifact.count()).toBe(2);

    const longStem = "b".repeat(121);
    const derivedNull = await upload(baseUrl, `${longStem}.html`, bytes);
    expect(derivedNull.name).toBeNull();
    const dotfile = await upload(baseUrl, ".html", bytes);
    expect(dotfile.name).toBeNull();
    const exact = await upload(baseUrl, `${"c".repeat(120)}.html`, bytes);
    expect(exact.name).toBe("c".repeat(120));

    const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts?view=mine`)).json());
    expect(listed.items.find((item) => item.id === created.id)?.name).toBe("Renamed calendar");

    const shared = shareEnvelopeSchema.parse(
      await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${created.id}/share`, { method: "POST" })).json(),
    );
    const token = shared.share.shareUrl?.split("/").at(-1) ?? "";
    const opened = publicArtifactEnvelopeSchema.parse(await (await globalThis.fetch(publicPath(baseUrl, created.id, token))).json());
    expect(opened.artifact.name).toBe("Renamed calendar");
    expect(opened.artifact.filename).toBe(`${created.id}.html`);
  });

  it("returns a 120-emoji name from create, replace, list, get, and the public artifact", async () => {
    const emoji = "👍".repeat(120);
    const bytes = new TextEncoder().encode("<p>emoji</p>");
    const created = await upload(baseUrl, "emoji.html", bytes, { name: emoji });
    expect(created.name).toBe(emoji);
    expect([...created.name ?? ""].length).toBe(120);

    const replaced = artifactEnvelopeSchema.parse(
      await (await putContent(baseUrl, created.id, "emoji.html", bytes, { name: emoji })).json(),
    ).artifact;
    expect(replaced.name).toBe(emoji);

    const detail = artifactEnvelopeSchema.parse(
      await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${created.id}`)).json(),
    ).artifact;
    expect(detail.name).toBe(emoji);

    const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts?view=mine`)).json());
    expect(listed.items.find((item) => item.id === created.id)?.name).toBe(emoji);

    const shared = shareEnvelopeSchema.parse(
      await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${created.id}/share`, { method: "POST" })).json(),
    );
    const token = shared.share.shareUrl?.split("/").at(-1) ?? "";
    const opened = publicArtifactEnvelopeSchema.parse(await (await globalThis.fetch(publicPath(baseUrl, created.id, token))).json());
    expect(opened.artifact.name).toBe(emoji);
  });

  it("derives the library name from a UTF-8 filename", async () => {
    const bytes = new TextEncoder().encode("<p>utf8</p>");
    expect((await upload(baseUrl, "café.html", bytes)).name).toBe("café");
    expect((await upload(baseUrl, "שלום.html", bytes)).name).toBe("שלום");
    expect((await upload(baseUrl, "👍.html", bytes)).name).toBe("👍");
    expect((await upload(baseUrl, "café; filename*.html", bytes)).name).toBe("café; filename*");
    expect((await upload(baseUrl, "שלום; filename*.html", bytes)).name).toBe("שלום; filename*");
    expect((await upload(baseUrl, "👍; filename*.html", bytes)).name).toBe("👍; filename*");
  });

  it("keeps a filename* value that busboy already decoded", async () => {
    const response = await postMultipart(baseUrl, "----factrove-filename-star", filenameStarBody("----factrove-filename-star", ""));
    expect(response.status).toBe(201);
    expect(artifactEnvelopeSchema.parse(await response.json()).artifact.name).toBe("caf\u00C3\u00A9");
  });

  it("keeps filename* when a header-like line precedes the file", async () => {
    const decoy = "Content-Disposition: form-data; name=\"file\"; filename=\"decoy.html\"\r\n";
    const response = await postMultipart(baseUrl, "----factrove-decoy-header", filenameStarBody("----factrove-decoy-header", decoy));
    expect(response.status).toBe(201);
    expect(artifactEnvelopeSchema.parse(await response.json()).artifact.name).toBe("caf\u00C3\u00A9");
  });

  it("keeps literal percent sequences in filename* and a plain upload", async () => {
    const bytes = new TextEncoder().encode("<p>percent</p>");
    const cases = [
      ["----factrove-pct22", "report%2522draft.html", "report%22draft.html", "report%22draft"],
      ["----factrove-pct0a", "report%250Adraft.html", "report%0Adraft.html", "report%0Adraft"],
      ["----factrove-pct0d", "report%250Ddraft.html", "report%0Ddraft.html", "report%0Ddraft"],
    ] as const;
    for (const [boundary, encoded, plain, name] of cases) {
      const starred = await postMultipart(baseUrl, boundary, filenameStarBody(boundary, "", encoded));
      expect(starred.status).toBe(201);
      expect(artifactEnvelopeSchema.parse(await starred.json()).artifact.name).toBe(name);
      expect((await upload(baseUrl, plain, bytes)).name).toBe(name);
    }
  });

  it("bounds memory for data before the file and enforces the field limit", async () => {
    const boundary = "----factrove-preamble";
    const target = new URL(baseUrl);
    const tail = Buffer.from(
      `\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="tiny.html"\r\n` +
        `Content-Type: text/html\r\n\r\n` +
        `<p>tiny</p>\r\n--${boundary}--\r\n`,
      "utf8",
    );
    const preambleBytes = 12 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x78);
    const baseline = retainedBufferBytes();
    let peak = baseline;
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({
        hostname: target.hostname,
        port: target.port,
        path: "/api/v1/artifacts",
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerApiKey}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(preambleBytes + tail.length),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (part: Buffer) => chunks.push(part));
        res.on("end", () => {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
          expect(res.statusCode).toBe(201);
          expect(artifactEnvelopeSchema.parse(payload).artifact.name).toBe("tiny");
          resolve();
        });
      });
      req.on("error", reject);
      const writePreamble = async (): Promise<void> => {
        let sent = 0;
        while (sent < preambleBytes) {
          const ready = req.write(chunk);
          sent += chunk.length;
          if (sent % (1024 * 1024) === 0) {
            peak = Math.max(peak, retainedBufferBytes());
          }
          if (!ready) {
            await once(req, "drain");
          }
        }
        req.end(tail);
      };
      void writePreamble().catch(reject);
    });
    const after = retainedBufferBytes();
    // The client reuses one 64 KiB chunk. A parser that kept the preamble would hold about 12 MiB.
    expect(peak).toBeLessThan(baseline + 4 * 1024 * 1024);
    expect(after).toBeLessThan(baseline + 4 * 1024 * 1024);

    const fields = Array.from({ length: 9 }, (_, index) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="extra${index}"\r\n\r\n${index}\r\n`,
    ).join("");
    const tooMany = Buffer.from(
      `${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tiny.html"\r\nContent-Type: text/html\r\n\r\n<p>x</p>\r\n--${boundary}--\r\n`,
      "utf8",
    );
    const rejected = await postMultipart(baseUrl, boundary, tooMany);
    expect(rejected.status).toBe(400);
    expect((await errorOf(rejected)).code).toBe("INVALID_REQUEST");
    expect(await prisma.artifact.count()).toBe(1);
  });

  it("rejects an unauthenticated upload before reading the body", async () => {
    const target = new URL(baseUrl);
    const result = await settledWithin(new Promise<{ status: number; written: number; payload: string }>((resolve, reject) => {
      let settled = false;
      let alreadyWritten = 0;
      const req = httpRequest({
        agent: new Agent({ keepAlive: false }),
        hostname: target.hostname,
        port: target.port,
        path: "/api/v1/artifacts",
        method: "POST",
        headers: {
          "content-type": "multipart/form-data; boundary=----factrove-unauth",
          "content-length": String(12 * 1024 * 1024),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          settled = true;
          resolve({
            status: res.statusCode ?? 0,
            written: (req.socket?.bytesWritten ?? Number.POSITIVE_INFINITY) - alreadyWritten,
            payload: Buffer.concat(chunks).toString("utf8"),
          });
          req.destroy();
        });
      });
      if (req.socket) {
        alreadyWritten = req.socket.bytesWritten;
      }
      req.on("socket", (socket) => {
        alreadyWritten = socket.bytesWritten;
      });
      req.on("error", (error) => {
        if (!settled) {
          reject(error);
        }
      });
      req.flushHeaders();
    }), 2000);
    expect(result.status).toBe(401);
    expect(result.payload).toContain("UNAUTHENTICATED");
    expect(result.written).toBeLessThan(8 * 1024);
  });

  it("rejects a trailing break and a C1 control in a submitted name", async () => {
    const bytes = new TextEncoder().encode("<p>controls</p>");
    const trailing = await postFile(baseUrl, "break.html", bytes, { name: "hello\n" });
    expect(trailing.status).toBe(400);
    expect((await errorOf(trailing)).message).toBe("name must be one line of 1 to 120 characters.");
    const separator = await postFile(baseUrl, "sep.html", bytes, { name: "hello\u2028" });
    expect(separator.status).toBe(400);
    const c1 = await postFile(baseUrl, "c1.html", bytes, { name: "hello\u0085" });
    expect(c1.status).toBe(400);
    expect((await errorOf(c1)).message).toBe("name must be one line of 1 to 120 characters.");
  });

  it("refuses a content replace when the caller cannot write that artifact", async () => {
    const original = new TextEncoder().encode("<p>keep-private</p>");
    const artifact = await upload(baseUrl, "private.html", original);
    const stranger = await signUpWithApiKey(baseUrl, {
      email: "replace-stranger@example.invalid",
      password: "stranger-password-1",
      name: "Stranger",
      keyName: "replace-stranger",
    });
    const denied = await putContent(baseUrl, artifact.id, "next.html", new TextEncoder().encode("<p>no</p>"), {}, stranger.apiKey);
    const missing = await putContent(
      baseUrl,
      "00000000-0000-4000-8000-000000000099",
      "next.html",
      new TextEncoder().encode("<p>no</p>"),
      {},
      stranger.apiKey,
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await errorOf(denied)).toEqual(await errorOf(missing));

    const shared = await upload(baseUrl, "org.html", new TextEncoder().encode("<p>org</p>"), { accessType: "org_shared" });
    const member = await signUpWithApiKey(baseUrl, {
      email: "replace-member@example.invalid",
      password: "member-password-1",
      name: "Member",
      keyName: "replace-member",
    });
    await addMembership(prisma, member.userId, localOrganizationFixture.id);
    const readable = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${shared.id}`, {
      headers: { authorization: `Bearer ${member.apiKey}` },
    });
    expect(readable.status).toBe(200);
    const memberDenied = await putContent(
      baseUrl,
      shared.id,
      "next.html",
      new TextEncoder().encode("<p>member</p>"),
      {},
      member.apiKey,
    );
    expect(memberDenied.status).toBe(404);
    expect(await errorOf(memberDenied)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });

    const anonymous = await putContent(baseUrl, artifact.id, "next.html", new TextEncoder().encode("<p>anon</p>"), {}, null);
    expect(anonymous.status).toBe(401);
    expect(await errorOf(anonymous)).toEqual({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(original));
    const sharedContent = await ownerFetch(`${baseUrl}/api/v1/artifacts/${shared.id}/content`);
    expect(new TextDecoder().decode(await sharedContent.arrayBuffer())).toBe("<p>org</p>");
  });

  it("returns the same not-found response when replacing a missing artifact", async () => {
    const missing = await putContent(
      baseUrl,
      "00000000-0000-4000-8000-000000000000",
      "next.html",
      new TextEncoder().encode("<p>missing</p>"),
    );
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });
    expect(await prisma.artifact.count()).toBe(0);
    expect(store.objects.size).toBe(0);
  });

  it("rejects an invalid replacement file and leaves the stored bytes in place", async () => {
    const original = new TextEncoder().encode("<p>still-here</p>");
    const artifact = await upload(baseUrl, "keep.html", original);
    const textFile = await putContent(baseUrl, artifact.id, "notes.txt", new TextEncoder().encode("plain"));
    expect(textFile.status).toBe(415);
    expect(await errorOf(textFile)).toEqual({
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Only .html and .htm files are supported.",
    });

    const empty = await putContent(baseUrl, artifact.id, "empty.html", new Uint8Array());
    expect(empty.status).toBe(400);
    expect((await errorOf(empty)).message).toBe("The HTML file is empty.");

    const binary = await putContent(baseUrl, artifact.id, "binary.html", Uint8Array.from([0xff, 0xfe]));
    expect(binary.status).toBe(400);
    expect((await errorOf(binary)).message).toBe("The file is not valid UTF-8.");

    const access = await putContent(baseUrl, artifact.id, "next.html", new TextEncoder().encode("<p>next</p>"), {
      accessType: "private",
    });
    expect(access.status).toBe(400);
    expect((await errorOf(access)).message).toBe("accessType cannot be changed when replacing content.");

    store.failPut = true;
    const unavailable = await putContent(baseUrl, artifact.id, "next.html", new TextEncoder().encode("<p>next</p>"));
    expect(unavailable.status).toBe(503);
    expect(await errorOf(unavailable)).toEqual({
      code: "STORAGE_UNAVAILABLE",
      message: "Object storage is unavailable.",
    });
    store.failPut = false;

    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(original));
    const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(row.sizeBytes).toBe(original.byteLength);
    expect(row.accessType).toBe("private");
  });

  it("serves the new bytes from an existing share link", async () => {
    const original = new TextEncoder().encode("<p>before</p>");
    const next = new TextEncoder().encode("<p>after</p>");
    const artifact = await upload(baseUrl, "shared.html", original);
    const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const token = created.share.shareUrl?.split("/").at(-1) ?? "";
    expect(token.length).toBeGreaterThan(10);
    const before = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(before.status).toBe(200);
    expect(Buffer.from(await before.arrayBuffer())).toEqual(Buffer.from(original));

    const replaced = await putContent(baseUrl, artifact.id, "after.html", next);
    expect(replaced.status).toBe(200);
    expect(artifactEnvelopeSchema.parse(await replaced.json()).artifact.shared).toBe(true);

    const again = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
    expect(again.share.shareUrl).toBe(created.share.shareUrl);
    expect(again.share.passwordProtected).toBe(false);
    const after = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(after.status).toBe(200);
    expect(after.headers.get("content-length")).toBe(String(next.byteLength));
    expect(Buffer.from(await after.arrayBuffer())).toEqual(Buffer.from(next));
  });

  it("accepts an owner browser session and rejects a cross-site cookie write", async () => {
    const original = new TextEncoder().encode("<p>session-original</p>");
    const next = new TextEncoder().encode("<p>session-next</p>");
    const artifact = await upload(baseUrl, "session-replace.html", original);
    const denied = await putCookieContent(baseUrl, owner.cookie, artifact.id, "evil.html", next, {
      origin: "https://evil.example",
    });
    expect(denied.status).toBe(403);
    expect((await errorOf(denied)).code).toBe("FORBIDDEN");
    const missingOrigin = await putCookieContent(baseUrl, owner.cookie, artifact.id, "missing.html", next);
    expect(missingOrigin.status).toBe(403);

    const replaced = await putCookieContent(baseUrl, owner.cookie, artifact.id, "next.html", next, {
      origin: "http://localhost:3000",
    });
    expect(replaced.status).toBe(200);
    expect(artifactEnvelopeSchema.parse(await replaced.json()).artifact.id).toBe(artifact.id);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(content.headers.get("content-length")).toBe(String(next.byteLength));
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(next));
    const unchangedUntilAllowed = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(unchangedUntilAllowed.sizeBytes).toBe(next.byteLength);
    expect(store.objects.get(unchangedUntilAllowed.objectKey)?.byteLength).toBe(next.byteLength);
  });

  it("rejects a content grant and leaves the stored bytes in place", async () => {
    const original = new TextEncoder().encode("<p>grant</p>");
    const artifact = await upload(baseUrl, "grant.html", original);
    const grant = mintContentGrant(artifact.id, TEST_AUTH_SECRET);
    const form = new FormData();
    form.append("file", new Blob(["<p>stolen</p>"]), "stolen.html");
    const denied = await globalThis.fetch(
      `${baseUrl}/api/v1/artifacts/${artifact.id}/content?access=${encodeURIComponent(grant)}`,
      { method: "PUT", body: form },
    );
    expect(denied.status).toBe(401);
    expect(await errorOf(denied)).toEqual({
      code: "UNAUTHENTICATED",
      message: "Sign in to continue.",
    });
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(original));
  });

  it("lands the new object and name together when a content commit drops its connection", async () => {
    const original = new TextEncoder().encode("<p>before-drop</p>");
    const next = new TextEncoder().encode("<p>after-drop</p>");
    const artifact = await upload(baseUrl, "drop.html", original, { name: "Before drop" });
    const before = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    const repository = app.get(ArtifactsRepository);
    const originalCommit = repository.commitContent.bind(repository);
    let releaseCommit = (): void => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    let commitDone = Promise.resolve();

    repository.commitContent = async (input) => {
      let markUpdateStarted = (): void => undefined;
      const updateStarted = new Promise<void>((resolve) => {
        markUpdateStarted = resolve;
      });
      commitDone = prisma.$transaction(async (tx) => {
        await tx.artifact.updateMany({
          where: { id: input.id, contentRevision: input.expectedRevision },
          data: {
            objectKey: input.objectKey,
            sizeBytes: input.sizeBytes,
            uploadedAt: input.uploadedAt,
            contentRevision: { increment: 1 },
            ...(input.name === undefined ? {} : { name: input.name }),
          },
        });
        markUpdateStarted();
        await hold;
      }, { maxWait: 5_000, timeout: 20_000 });
      commitDone.catch(() => undefined);
      await updateStarted;
      throw new Error("Connection dropped before commit acknowledgement");
    };

    try {
      const failed = await putContent(baseUrl, artifact.id, "dropped.html", next, { name: "After drop" });
      expect(failed.status).toBe(500);
      expect(await errorOf(failed)).toEqual({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      });
      const during = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
      expect(during.objectKey).toBe(before.objectKey);
      expect(during.sizeBytes).toBe(original.byteLength);
      expect(during.contentRevision).toBe(before.contentRevision);
      expect(during.name).toBe("Before drop");
      const newKeys = [...store.objects.keys()].filter((key) => key !== before.objectKey);
      expect(newKeys).toHaveLength(1);
      const newKey = newKeys[0] ?? "";
      expect(Buffer.from(store.objects.get(newKey) ?? new Uint8Array())).toEqual(Buffer.from(next));

      releaseCommit();
      await commitDone;

      const after = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
      expect(after.objectKey).toBe(newKey);
      expect(after.sizeBytes).toBe(next.byteLength);
      expect(after.contentRevision).toBe(before.contentRevision + 1);
      expect(after.name).toBe("After drop");
      expect(Buffer.from(store.objects.get(after.objectKey) ?? new Uint8Array())).toEqual(Buffer.from(next));
      const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
      expect(content.status).toBe(200);
      expect(content.headers.get("content-length")).toBe(String(next.byteLength));
      expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(next));
    } finally {
      releaseCommit();
      await commitDone.catch(() => undefined);
      repository.commitContent = originalCommit;
    }
  });

  it("returns 200 with its name when a nameless replace lands after this write", async () => {
    const bytes = new TextEncoder().encode("<p>named-race</p>");
    const laterBytes = new TextEncoder().encode("<p>later-nameless</p>");
    const artifact = await upload(baseUrl, "named-race.html", bytes, { name: "Original" });
    const repository = app.get(ArtifactsRepository);
    const originalCommit = repository.commitContent.bind(repository);
    let laterKey = "";
    repository.commitContent = async (input) => {
      const committed = await originalCommit(input);
      laterKey = `${artifact.id}/${randomUUID()}.html`;
      store.objects.set(laterKey, laterBytes);
      await originalCommit({
        ...input,
        expectedRevision: input.expectedRevision + 1,
        objectKey: laterKey,
        sizeBytes: laterBytes.byteLength,
        name: undefined,
      });
      return committed;
    };
    try {
      const response = await putContent(baseUrl, artifact.id, "lost.html", bytes, { name: "Lost the race" });
      expect(response.status).toBe(200);
      expect(artifactEnvelopeSchema.parse(await response.json()).artifact.name).toBe("Lost the race");
      const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
      expect(row.objectKey).toBe(laterKey);
      expect(row.name).toBe("Lost the race");
      expect(row.sizeBytes).toBe(laterBytes.byteLength);
      expect(Buffer.from(store.objects.get(row.objectKey) ?? new Uint8Array())).toEqual(Buffer.from(laterBytes));
    } finally {
      repository.commitContent = originalCommit;
    }
  });

  it("returns the explicit name when a lost acknowledgement already shows this object", async () => {
    const original = new TextEncoder().encode("<p>before-ack</p>");
    const next = new TextEncoder().encode("<p>after-ack</p>");
    const artifact = await upload(baseUrl, "ack.html", original, { name: "Before ack" });
    const repository = app.get(ArtifactsRepository);
    const originalCommit = repository.commitContent.bind(repository);
    repository.commitContent = async (input) => {
      await originalCommit(input);
      throw new Error("acknowledgement lost");
    };
    try {
      const response = await putContent(baseUrl, artifact.id, "acked.html", next, { name: "Landed name" });
      expect(response.status).toBe(200);
      expect(artifactEnvelopeSchema.parse(await response.json()).artifact.name).toBe("Landed name");
      const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
      expect(row.name).toBe("Landed name");
      expect(row.sizeBytes).toBe(next.byteLength);
      expect(Buffer.from(store.objects.get(row.objectKey) ?? new Uint8Array())).toEqual(Buffer.from(next));
    } finally {
      repository.commitContent = originalCommit;
    }
  });

  it("leaves the live object unchanged when storage loses the put acknowledgement", async () => {
    const original = new TextEncoder().encode("<p>acked</p>");
    const artifact = await upload(baseUrl, "acked.html", original);
    const before = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    store.putThenFail = true;
    const failed = await putContent(baseUrl, artifact.id, "lost.html", new TextEncoder().encode("<p>lost-ack</p>"));
    expect(failed.status).toBe(503);
    expect((await errorOf(failed)).code).toBe("STORAGE_UNAVAILABLE");
    store.putThenFail = false;
    const after = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    expect(after.objectKey).toBe(before.objectKey);
    expect(after.sizeBytes).toBe(original.byteLength);
    expect(after.contentRevision).toBe(before.contentRevision);
    expect(store.objects.size).toBe(1);
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(content.headers.get("content-length")).toBe(String(original.byteLength));
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(original));
  });

  it("keeps an in-flight read aligned with the object it opened", async () => {
    const original = new TextEncoder().encode(`<p>${"a".repeat(4000)}</p>`);
    const next = new TextEncoder().encode(`<p>${"b".repeat(1800)}</p>`);
    const artifact = await upload(baseUrl, "inflight.html", original);
    const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const token = created.share.shareUrl?.split("/").at(-1) ?? "";

    store.armBodyPause();
    const privateRead = readPausedContent(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    await settledWithin(store.bodyPaused, 2000);
    const replaced = await putContent(baseUrl, artifact.id, "during.html", next);
    expect(replaced.status).toBe(200);
    store.continueBody();
    const privateBody = await privateRead;
    expect(privateBody.status).toBe(200);
    expect(privateBody.bytes.byteLength).toBe(Number(privateBody.contentLength));
    expect(Buffer.from(privateBody.bytes)).toEqual(Buffer.from(original));

    store.armBodyPause();
    const publicRead = readPausedContent(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`, false);
    await settledWithin(store.bodyPaused, 2000);
    const second = new TextEncoder().encode("<p>second-pass</p>");
    const replacedAgain = await putContent(baseUrl, artifact.id, "during-public.html", second);
    expect(replacedAgain.status).toBe(200);
    store.continueBody();
    const publicBody = await publicRead;
    expect(publicBody.status).toBe(200);
    expect(publicBody.bytes.byteLength).toBe(Number(publicBody.contentLength));
    expect(Buffer.from(publicBody.bytes)).toEqual(Buffer.from(next));

    const settled = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(settled.headers.get("content-length")).toBe(String(second.byteLength));
    expect(Buffer.from(await settled.arrayBuffer())).toEqual(Buffer.from(second));
    const publicSettled = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(publicSettled.headers.get("content-length")).toBe(String(second.byteLength));
    expect(Buffer.from(await publicSettled.arrayBuffer())).toEqual(Buffer.from(second));
  });

  it("ends parallel replaces with one object whose size matches the row", async () => {
    const artifact = await upload(baseUrl, "race.html", new TextEncoder().encode("<p>seed</p>"));
    const bodies = Array.from({ length: 20 }, (_, index) => {
      const marker = String(index).padStart(2, "0");
      return new TextEncoder().encode(`<p>${marker}${"x".repeat(80 + index)}</p>`);
    });
    const responses = await Promise.all(
      bodies.map((bytes, index) => putContent(baseUrl, artifact.id, `race-${index}.html`, bytes)),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(statuses).toContain(200);
    for (const response of responses) {
      if (response.status === 409) {
        expect((await errorOf(response)).code).toBe("CONTENT_CONFLICT");
      } else {
        await response.arrayBuffer();
      }
    }
    const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    const stored = store.objects.get(row.objectKey);
    expect(stored?.byteLength).toBe(row.sizeBytes);
    const winner = bodies.find((bytes) => stored && Buffer.from(stored).equals(Buffer.from(bytes)));
    expect(winner).toBeDefined();
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(content.headers.get("content-length")).toBe(String(row.sizeBytes));
    const received = Buffer.from(await content.arrayBuffer());
    expect(received.byteLength).toBe(row.sizeBytes);
    expect(received.equals(Buffer.from(stored ?? new Uint8Array()))).toBe(true);
  });

  it("ends parallel named replaces with content and name from the same request", async () => {
    const artifact = await upload(baseUrl, "named-parallel.html", new TextEncoder().encode("<p>seed</p>"), {
      name: "seed",
    });
    const bodies = Array.from({ length: 20 }, (_, index) => {
      const marker = String(index).padStart(2, "0");
      return {
        name: `race-${marker}`,
        bytes: new TextEncoder().encode(`<p>${marker}${"y".repeat(80 + index)}</p>`),
      };
    });
    const responses = await Promise.all(
      bodies.map((body, index) => putContent(baseUrl, artifact.id, `named-race-${index}.html`, body.bytes, { name: body.name })),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(statuses).toContain(200);
    for (const response of responses) {
      if (response.status === 409) {
        expect((await errorOf(response)).code).toBe("CONTENT_CONFLICT");
      } else {
        await response.arrayBuffer();
      }
    }
    const row = await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
    const stored = store.objects.get(row.objectKey);
    const winner = bodies.find((body) => stored && Buffer.from(stored).equals(Buffer.from(body.bytes)));
    expect(winner).toBeDefined();
    expect(row.name).toBe(winner?.name);
    expect(row.sizeBytes).toBe(winner?.bytes.byteLength);
  });

  it("reads a legacy object from the key stored on its row", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174111";
    const bytes = new TextEncoder().encode("<p>legacy-object</p>");
    const objectKey = `${id}.html`;
    store.objects.set(objectKey, bytes);
    await prisma.artifact.create({
      data: {
        id,
        creatorUserId: owner.userId,
        organizationId: localOrganizationFixture.id,
        accessType: "private",
        mimeType: "text/html",
        sizeBytes: bytes.byteLength,
        objectKey,
        uploadedAt: new Date(),
      },
    });
    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${id}/content`);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
  });

  it("returns json when content streaming fails before any bytes are sent", async () => {
    const artifact = await upload(baseUrl, "early.html", new TextEncoder().encode("<p>early</p>"));
    store.throwBeforeChunk = true;
    const response = await settledWithin(
      ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`).then(async (pending) => ({
        status: pending.status,
        error: await errorOf(pending),
      })),
      2000,
    );
    expect(response.status).toBe(503);
    expect(response.error).toEqual({
      code: "STORAGE_UNAVAILABLE",
      message: "Object storage is unavailable.",
    });
  });

  it("aborts a content response when storage fails after the first chunk", async () => {
    const bytes = new TextEncoder().encode(`<p>${"x".repeat(4096)}</p>`);
    const artifact = await upload(baseUrl, "partial.html", bytes);
    store.interruptAfterFirstChunk = true;
    const started = Date.now();
    let failure: unknown;
    try {
      await settledWithin(readContent(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`), 2000);
      failure = new Error("content response completed");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toMatch(/timed out/);
    expect((failure as Error).message).not.toBe("content response completed");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns original HTML unless format=markdown is requested", async () => {
    const bytes = new TextEncoder().encode(
      "<h1>Notes</h1><p>See <a href=\"https://example.com/docs\">docs</a>.</p><script>SECRETTOKEN</script>",
    );
    const artifact = await upload(baseUrl, "notes.html", bytes);

    const omitted = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`, {
      headers: { Accept: "text/markdown" },
    });
    expect(omitted.status).toBe(200);
    expect(Buffer.from(await omitted.arrayBuffer())).toEqual(Buffer.from(bytes));
    expectHtmlHeaders(omitted.headers);

    const explicit = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=html`);
    expect(explicit.status).toBe(200);
    expect(Buffer.from(await explicit.arrayBuffer())).toEqual(Buffer.from(bytes));
    expectHtmlHeaders(explicit.headers);

    const markdown = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=markdown`);
    expect(markdown.status).toBe(200);
    const markdownBytes = new Uint8Array(await markdown.arrayBuffer());
    const markdownText = new TextDecoder().decode(markdownBytes);
    expect(markdownText).toContain("# Notes");
    expect(markdownText).toContain("[docs](<https://example.com/docs>)");
    expect(markdownText).not.toContain("SECRETTOKEN");
    expect(markdownText).not.toContain("<script");
    expectMarkdownHeaders(markdown.headers, markdownBytes.byteLength);

    const stored = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(Buffer.from(bytes));
    const notesKey = (await prisma.artifact.findUniqueOrThrow({ where: { id: artifact.id } })).objectKey;
    expect(store.objects.get(notesKey)).toEqual(bytes);
    expect(await prisma.artifact.count()).toBe(1);

    const upper = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id.toUpperCase()}/content?format=markdown`);
    expect(upper.status).toBe(200);
    expect(await upper.text()).toBe(markdownText);
  });

  it("returns stored HTML bytes, including a leading BOM, for format=html", async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>Hi</p>", "utf8")]);
    const artifact = await upload(baseUrl, "bom.html", bytes);
    const response = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=html`);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expectHtmlHeaders(response.headers);
  });

  it("returns CONTENT_TOO_COMPLEX when Markdown output exceeds the conversion limit", async () => {
    const html = `<p>${"<".repeat(4_500_000)}</p>`;
    const artifact = await upload(baseUrl, "wide.html", Buffer.from(html, "utf8"));
    const started = Date.now();
    const response = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=markdown`);
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toEqual({
      code: "CONTENT_TOO_COMPLEX",
      message: "Markdown output exceeds the conversion limit.",
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    const health = await ownerFetch(`${baseUrl}/api/v1/health`);
    expect(health.status).toBe(200);
  });

  it("returns CONVERSION_UNAVAILABLE when the Markdown worker pool is full", async () => {
    const previous = {
      concurrency: process.env.MARKDOWN_CONVERSION_CONCURRENCY,
      queue: process.env.MARKDOWN_CONVERSION_QUEUE,
    };
    process.env.MARKDOWN_CONVERSION_CONCURRENCY = "1";
    process.env.MARKDOWN_CONVERSION_QUEUE = "0";
    let releaseHeld = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const held = withMarkdownConversionSlot(() => gate.then(() => "held"));
    try {
      const artifact = await upload(baseUrl, "busy.html", new TextEncoder().encode("<p>Busy</p>"));
      const started = Date.now();
      const response = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=markdown`);
      expect(response.status).toBe(503);
      expect(await errorOf(response)).toEqual({
        code: "CONVERSION_UNAVAILABLE",
        message: "Markdown conversion is busy. Try again.",
      });
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      releaseHeld();
      await held;
      if (previous.concurrency === undefined) {
        delete process.env.MARKDOWN_CONVERSION_CONCURRENCY;
      } else {
        process.env.MARKDOWN_CONVERSION_CONCURRENCY = previous.concurrency;
      }
      if (previous.queue === undefined) {
        delete process.env.MARKDOWN_CONVERSION_QUEUE;
      } else {
        process.env.MARKDOWN_CONVERSION_QUEUE = previous.queue;
      }
    }
  });

  it("rejects an unknown content format and keeps markdown failures as JSON", async () => {
    const artifact = await upload(baseUrl, "notes.html", new TextEncoder().encode("<p>Notes</p>"));
    const invalid = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=md`);
    expect(invalid.status).toBe(400);
    expect(await errorOf(invalid)).toEqual({
      code: "INVALID_REQUEST",
      message: "format must be html or markdown.",
    });

    const blank = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=`);
    expect(blank.status).toBe(400);
    expect((await errorOf(blank)).code).toBe("INVALID_REQUEST");

    const repeated = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=html&format=markdown`);
    expect(repeated.status).toBe(400);
    expect((await errorOf(repeated)).code).toBe("INVALID_REQUEST");

    const missing = await ownerFetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000/content?format=markdown`);
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toEqual({
      code: "ARTIFACT_NOT_FOUND",
      message: "Artifact was not found.",
    });

    store.failGet = true;
    const unavailable = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content?format=markdown`);
    expect(unavailable.status).toBe(503);
    expect(await errorOf(unavailable)).toEqual({
      code: "STORAGE_UNAVAILABLE",
      message: "Object storage is unavailable.",
    });
  });

  it("rejects a cookie upload whose origin is not the web app", async () => {
    const bytes = new TextEncoder().encode("<p>csrf</p>");
    const foreign = await postCookieFile(baseUrl, owner.cookie, "csrf.html", bytes, {
      origin: "http://evil.localhost:4000",
    });
    expect(foreign.status).toBe(403);
    expect(await errorOf(foreign)).toEqual({
      code: "FORBIDDEN",
      message: "This request origin is not allowed.",
    });
    expect(await prisma.artifact.count()).toBe(0);

    const foreignReferer = await postCookieFile(baseUrl, owner.cookie, "csrf.html", bytes, {
      referer: "http://evil.localhost:4000/form",
    });
    expect(foreignReferer.status).toBe(403);

    const missingOrigin = await postCookieFile(baseUrl, owner.cookie, "csrf.html", bytes);
    expect(missingOrigin.status).toBe(403);

    const headerBypass = await postCookieFile(baseUrl, owner.cookie, "csrf.html", bytes, {
      origin: "http://evil.localhost:4000",
      "x-api-key": owner.apiKey,
    });
    expect(headerBypass.status).toBe(403);

    const fromWeb = await postCookieFile(baseUrl, owner.cookie, "ok.html", bytes, {
      origin: "http://localhost:3000",
    });
    expect(fromWeb.status).toBe(201);

    const fromReferer = await postCookieFile(baseUrl, owner.cookie, "ref.html", bytes, {
      referer: "http://localhost:3000/library",
    });
    expect(fromReferer.status).toBe(201);

    const keyed = await postFile(baseUrl, "key.html", bytes, {}, owner.apiKey);
    expect(keyed.status).toBe(201);

    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from(bytes)]), "keyed.html");
    const keyedForeign = await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      body: form,
      headers: {
        authorization: `Bearer ${owner.apiKey}`,
        origin: "http://evil.localhost:4000",
      },
    });
    expect(keyedForeign.status).toBe(201);

    const anonymous = await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, {
      method: "POST",
      headers: { origin: "http://evil.localhost:4000" },
    });
    expect(anonymous.status).toBe(401);
  });

  it("allows only the configured web origin through CORS", async () => {
    const allowed = await ownerFetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const missing = await ownerFetch(`${baseUrl}/api/v1/health`);
    expect(missing.headers.get("access-control-allow-origin")).toBeNull();

    for (const origin of ["null", "http://evil.example"]) {
      const denied = await ownerFetch(`${baseUrl}/api/v1/health`, { headers: { Origin: origin } });
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    }

    const preflight = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(preflight.headers.get("access-control-allow-origin")).not.toBe("*");

    const authPreflight = await globalThis.fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(authPreflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(authPreflight.headers.get("access-control-allow-credentials")).toBe("true");

    const nullPreflight = await ownerFetch(`${baseUrl}/api/v1/artifacts`, {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(nullPreflight.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("starts without impersonating the seeded local user", async () => {
    const started = await createApp(config, new MemoryBlobStore());
    try {
      await started.listen(0, "127.0.0.1");
      const health = await globalThis.fetch(`${await started.getUrl()}/api/v1/health`);
      expect(health.status).toBe(200);
    } finally {
      await started.close();
    }
  });

  it("requires an organization for org_shared and leaves private artifacts unassigned", async () => {
    const isolated = new MemoryBlobStore();
    const noOrg = await createApp(config, isolated);
    try {
      await noOrg.listen(0, "127.0.0.1");
      const url = await noOrg.getUrl();
      const stranger = await signUpWithApiKey(url, {
        email: "stranger@example.invalid",
        password: "stranger-password-1",
        name: "Stranger",
        keyName: "stranger",
      });
      const headers = { authorization: `Bearer ${stranger.apiKey}` };
      const context = contextEnvelopeSchema.parse(await (await globalThis.fetch(`${url}/api/v1/context`, { headers })).json());
      expect(context.organization).toBeNull();

      const orgList = artifactListEnvelopeSchema.parse(
        await (await globalThis.fetch(`${url}/api/v1/artifacts?view=org`, { headers })).json(),
      );
      expect(orgList.items).toEqual([]);

      const rejected = await postFile(
        url,
        "shared.html",
        new TextEncoder().encode("<p>shared</p>"),
        { accessType: "org_shared" },
        stranger.apiKey,
      );
      expect(rejected.status).toBe(400);
      expect(await errorOf(rejected)).toEqual({
        code: "ORGANIZATION_REQUIRED",
        message: "Organization sharing requires membership in an organization.",
      });

      const created = await upload(url, "personal.html", new TextEncoder().encode("<p>personal</p>"), {}, stranger.apiKey);
      expect(created.organizationId).toBeNull();
      expect(created.creatorUserId).toBe(stranger.userId);
      expect(created.accessType).toBe("private");
      expect(await prisma.artifact.count()).toBe(1);
    } finally {
      await noOrg.close();
    }
  });

  it("keeps API keys hashed, revocable, and session-only to manage", async () => {
    const listed = await globalThis.fetch(`${baseUrl}/api/auth/api-key/list`, { headers: { cookie: owner.cookie } });
    expect(listed.status).toBe(200);
    const items = (await listed.json()) as { apiKeys: Array<{ id: string; start: string | null; key?: string }> };
    expect(items.apiKeys.some((item) => item.id === owner.keyId && item.start === owner.prefix)).toBe(true);
    expect(JSON.stringify(items)).not.toContain(owner.apiKey);

    const stored = await prisma.apikey.findUnique({ where: { id: owner.keyId } });
    expect(stored?.key).toBe(createHash("sha256").update(owner.apiKey).digest("base64url"));
    expect(stored?.key).not.toBe(owner.apiKey);

    const withKey = await globalThis.fetch(`${baseUrl}/api/auth/api-key/create`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${owner.apiKey}`,
        cookie: owner.cookie,
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ name: "from-key" }),
    });
    expect(withKey.status).toBe(401);
    expect(await withKey.text()).toContain("API key management requires a browser session.");

    const other = await signUpWithApiKey(baseUrl, {
      email: "other-key@example.invalid",
      password: "other-key-password",
      name: "Other Key",
      keyName: "other",
    });
    const hidden = await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, {
      headers: { authorization: `Bearer ${other.apiKey}` },
    });
    expect(hidden.status).toBe(200);
    const privateArtifact = await upload(baseUrl, "secret.html", new TextEncoder().encode("<p>secret</p>"));
    const denied = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${privateArtifact.id}`, {
      headers: { authorization: `Bearer ${other.apiKey}` },
    });
    const missing = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`, {
      headers: { authorization: `Bearer ${other.apiKey}` },
    });
    expect(denied.status).toBe(404);
    expect(await errorOf(denied)).toEqual(await errorOf(missing));

    const foreign = await globalThis.fetch(`${baseUrl}/api/auth/api-key/delete`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ keyId: other.keyId }),
    });
    expect(foreign.status).toBe(404);
    const stillThere = await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, {
      headers: { authorization: `Bearer ${other.apiKey}` },
    });
    expect(stillThere.status).toBe(200);

    const revoked = await globalThis.fetch(`${baseUrl}/api/auth/api-key/delete`, {
      method: "POST",
      headers: { cookie: other.cookie, "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ keyId: other.keyId }),
    });
    expect(revoked.status).toBe(200);
    const afterRevoke = await globalThis.fetch(`${baseUrl}/api/v1/artifacts`, {
      headers: { authorization: `Bearer ${other.apiKey}` },
    });
    expect(afterRevoke.status).toBe(401);

    const headerKey = await globalThis.fetch(`${baseUrl}/api/v1/context`, {
      headers: { "x-api-key": owner.apiKey },
    });
    expect(headerKey.status).toBe(401);

    const fallback = await globalThis.fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: "Bearer not-a-real-key", cookie: owner.cookie },
    });
    expect(fallback.status).toBe(401);
  });

  it("creates an unguessable public link, opens it logged out, and revokes it", async () => {
    const bytes = new TextEncoder().encode("<p>shared secret</p>");
    const artifact = await upload(baseUrl, "secret.html", bytes);
    expect(artifact.shared).toBe(false);
    expect(artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${artifact.id}`);

    const hidden = await globalThis.fetch(publicPath(baseUrl, artifact.id, "a".repeat(43)));
    const unknown = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`);
    expect(hidden.status).toBe(404);
    const hiddenError = await errorOf(hidden);
    expect(hiddenError).toEqual(await errorOf(unknown));
    expect(JSON.stringify(hiddenError)).not.toContain("a".repeat(43));

    const anonymousShare = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, { method: "POST" });
    expect(anonymousShare.status).toBe(401);

    const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const shareUrl = created.share.shareUrl ?? "";
    const token = shareUrl.slice(shareUrl.lastIndexOf("/") + 1);
    expect(created.share.shared).toBe(true);
    expect(shareUrl).toBe(`http://localhost:3000/share/${artifact.id}/${token}`);
    expect(token).not.toBe(artifact.id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const storedShare = await prisma.artifact.findUnique({
      where: { id: artifact.id },
      select: { shareToken: true, shareTokenHash: true },
    });
    expect(storedShare?.shareToken).toBeTruthy();
    expect(storedShare?.shareToken).not.toBe(token);
    expect(storedShare?.shareToken ?? "").not.toContain(token);
    expect(storedShare?.shareTokenHash).toBe(createHash("sha256").update(token).digest("hex"));

    const shortPath = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}`);
    expect(shortPath.status).toBe(404);
    expect(shortPath.headers.get("referrer-policy")).toBe("no-referrer");
    expect(shortPath.headers.get("x-robots-tag")).toBe("noindex");
    expect(await errorOf(shortPath)).toEqual({ code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." });
    const extraPath = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/extra`);
    expect(extraPath.status).toBe(404);
    expect(await errorOf(extraPath)).toEqual({ code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." });

    const again = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    expect(again).toEqual(created);

    const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts`)).json());
    expect(listed.items[0]?.shared).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(token);

    const detail = artifactEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json());
    expect(JSON.stringify(detail)).not.toContain(token);

    const opened = publicArtifactEnvelopeSchema.parse(await (await globalThis.fetch(publicPath(baseUrl, artifact.id, token))).json());
    expect(opened.artifact).not.toHaveProperty("creatorUserId");
    expect(opened.artifact).not.toHaveProperty("shareUrl");
    expect(opened.artifact.filename).toBe(`${artifact.id}.html`);
    const contentResponse = await globalThis.fetch(`${baseUrl}${new URL(opened.artifact.contentUrl).pathname}`);
    expect(contentResponse.status).toBe(200);
    expect(Buffer.from(await contentResponse.arrayBuffer())).toEqual(Buffer.from(bytes));
    expectHtmlHeaders(contentResponse.headers);
    expect(contentResponse.headers.get("x-robots-tag")).toBe("noindex");

    await prisma.artifact.update({ where: { id: artifact.id }, data: { uploadedAt: null } });
    const unpublished = await globalThis.fetch(publicPath(baseUrl, artifact.id, token));
    const unpublishedContent = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(unpublished.status).toBe(404);
    expect(unpublishedContent.status).toBe(404);
    expect(unpublished.headers.get("referrer-policy")).toBe("no-referrer");
    expect(unpublished.headers.get("x-robots-tag")).toBe("noindex");
    expect(await errorOf(unpublished)).toEqual(hiddenError);
    expect(await errorOf(unpublishedContent)).toEqual(hiddenError);
    await prisma.artifact.update({ where: { id: artifact.id }, data: { uploadedAt: new Date(artifact.uploadedAt) } });

    const privateContent = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
    expect(privateContent.status).toBe(404);

    const session = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "DELETE",
      headers: { cookie: owner.cookie, origin: "http://localhost:3000" },
    });
    expect(session.status).toBe(200);
    expect(shareEnvelopeSchema.parse(await session.json())).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });

    const revoked = await globalThis.fetch(publicPath(baseUrl, artifact.id, token));
    const missingArtifact = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000099`);
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get("referrer-policy")).toBe("no-referrer");
    expect(revoked.headers.get("x-robots-tag")).toBe("noindex");
    const revokedError = await errorOf(revoked);
    expect(revokedError).toEqual(await errorOf(missingArtifact));
    expect(JSON.stringify(revokedError)).not.toContain(token);
    const revokedContent = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(revokedContent.status).toBe(404);
    expect(await errorOf(revokedContent)).toEqual(revokedError);

    const rotated = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const nextToken = rotated.share.shareUrl?.slice(rotated.share.shareUrl.lastIndexOf("/") + 1);
    expect(nextToken).not.toBe(token);
    const oldStillDead = await globalThis.fetch(publicPath(baseUrl, artifact.id, token));
    expect(oldStillDead.status).toBe(404);
    const fresh = await globalThis.fetch(publicPath(baseUrl, artifact.id, nextToken ?? ""));
    expect(fresh.status).toBe(200);

    const mixedCase = await globalThis.fetch(`${baseUrl}/API/V1/PUBLIC/artifacts/${artifact.id}`, {
      headers: { origin: "http://localhost:3000" },
    });
    expect(mixedCase.status).toBe(404);
    expect(mixedCase.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(mixedCase.headers.get("access-control-allow-credentials")).toBeNull();
    expect(mixedCase.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mixedCase.headers.get("x-robots-tag")).toBe("noindex");
    expect(await errorOf(mixedCase)).toEqual({ code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." });
    const mixedPreflight = await globalThis.fetch(`${baseUrl}/Api/v1/public/artifacts/${artifact.id}/${"b".repeat(43)}`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST" },
    });
    expect(mixedPreflight.status).toBe(204);
    expect(mixedPreflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(mixedPreflight.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
    expect(mixedPreflight.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("treats an unreadable share token as no link and lets the owner share again", async () => {
    const artifact = await upload(baseUrl, "rotated.html", new TextEncoder().encode("<p>rotated</p>"));
    const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const token = created.share.shareUrl?.split("/").at(-1) ?? "";
    const otherId = "123e4567-e89b-42d3-a456-426614174099";
    const key = deriveShareTokenKey(TEST_AUTH_SECRET);
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { shareToken: encryptShareToken(token, key, otherId) },
    });
    const unreadable = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
    expect(unreadable).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });
    const unreadableDetail = artifactEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json());
    expect(unreadableDetail.artifact.shared).toBe(false);
    const hiddenDetail = await globalThis.fetch(publicPath(baseUrl, artifact.id, token));
    const hiddenContent = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
    expect(hiddenDetail.status).toBe(404);
    expect(hiddenContent.status).toBe(404);

    const swapped = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const swappedToken = swapped.share.shareUrl?.split("/").at(-1) ?? "";
    expect(swapped.share.shared).toBe(true);
    expect(swappedToken).not.toBe(token);
    await prisma.artifact.update({
      where: { id: artifact.id },
      data: { shareToken: encryptShareToken(createShareToken(), key, artifact.id) },
    });
    const mismatched = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
    expect(mismatched).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });

    const renewed = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const renewedToken = renewed.share.shareUrl?.split("/").at(-1) ?? "";
    expect(renewed.share.shared).toBe(true);
    const opened = await globalThis.fetch(publicPath(baseUrl, artifact.id, renewedToken));
    expect(opened.status).toBe(200);
  });

  it("revokes the old public link when the share token key rotates", async () => {
    const artifact = await upload(baseUrl, "key-rotation.html", new TextEncoder().encode("<p>rotated key</p>"));
    const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
    })).json());
    const token = created.share.shareUrl?.split("/").at(-1) ?? "";
    expect((await globalThis.fetch(publicPath(baseUrl, artifact.id, token))).status).toBe(200);

    config.shareTokenKey = "rotated-share-token-key-value-here";
    try {
      const ownerShare = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(ownerShare).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });
      const detail = artifactEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json());
      expect(detail.artifact.shared).toBe(false);
      const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts`)).json());
      expect(listed.items.find((item) => item.id === artifact.id)?.shared).toBe(false);

      const oldDetail = await globalThis.fetch(publicPath(baseUrl, artifact.id, token));
      const oldContent = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
      expect(oldDetail.status).toBe(404);
      expect(oldContent.status).toBe(404);
      const oldError = await errorOf(oldDetail);
      expect(oldError).toEqual({ code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." });
      expect(await errorOf(oldContent)).toEqual(oldError);
      expect(JSON.stringify(oldError)).not.toContain(token);

      const renewed = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
      })).json());
      const renewedToken = renewed.share.shareUrl?.split("/").at(-1) ?? "";
      expect(renewed.share.shared).toBe(true);
      expect(renewedToken).not.toBe(token);
      expect((await globalThis.fetch(publicPath(baseUrl, artifact.id, renewedToken))).status).toBe(200);
      expect((await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${renewedToken}/content`)).status).toBe(200);
      expect((await globalThis.fetch(publicPath(baseUrl, artifact.id, token))).status).toBe(404);
      const after = artifactEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json());
      expect(after.artifact.shared).toBe(true);
    } finally {
      config.shareTokenKey = null;
    }
  });

  it("lets only the owner share, including an organization member who can already read", async () => {
    const artifact = await upload(baseUrl, "org.html", new TextEncoder().encode("<p>org</p>"), { accessType: "org_shared" });
    const member = await signUpWithApiKey(baseUrl, {
      email: "member-share@example.invalid",
      password: "member-password-1",
      name: "Member",
      keyName: "member",
    });
    await addMembership(prisma, member.userId, localOrganizationFixture.id);
    const readable = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`, {
      headers: { authorization: `Bearer ${member.apiKey}` },
    });
    expect(readable.status).toBe(200);
    const denied = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
      headers: { authorization: `Bearer ${member.apiKey}` },
    });
    const missing = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000/share`, {
      method: "POST",
      headers: { authorization: `Bearer ${member.apiKey}` },
    });
    expect(denied.status).toBe(404);
    expect(await errorOf(denied)).toEqual(await errorOf(missing));
  });

  it("accepts a session share from both the web origin and a different public base URL", async () => {
    const artifact = await upload(baseUrl, "session.html", new TextEncoder().encode("<p>session</p>"));
    const previousWeb = config.webOrigin;
    const previousBase = config.publicBaseUrl;
    config.webOrigin = "https://app.factrove.test";
    config.publicBaseUrl = "https://factrove.test";
    try {
      const denied = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
        headers: { cookie: owner.cookie, origin: "https://evil.example" },
      });
      expect(denied.status).toBe(403);

      const created = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
        headers: { cookie: owner.cookie, origin: "https://factrove.test" },
      });
      expect(created.status).toBe(200);
      const share = shareEnvelopeSchema.parse(await created.json());
      expect(share.share.shareUrl?.startsWith(`https://factrove.test/share/${artifact.id}/`)).toBe(true);

      const stopped = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "DELETE",
        headers: { cookie: owner.cookie, origin: "https://app.factrove.test" },
      });
      expect(stopped.status).toBe(200);
      expect(shareEnvelopeSchema.parse(await stopped.json())).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });
    } finally {
      config.webOrigin = previousWeb;
      config.publicBaseUrl = previousBase;
    }
  });

  it("builds share links and framing from a localhost base URL or a public domain", async () => {
    const bytes = new TextEncoder().encode("<p>domain</p>");
    const artifact = await upload(baseUrl, "domain.html", bytes);
    config.publicBaseUrl = "https://factrove.app";
    try {
      const created = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
      })).json());
      const token = created.share.shareUrl?.split("/").at(-1) ?? "";
      expect(created.share.shareUrl).toBe(`https://factrove.app/share/${artifact.id}/${token}`);
      const detail = artifactEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}`)).json());
      expect(detail.artifact.viewerUrl).toBe(`https://factrove.app/artifacts/${artifact.id}`);

      const content = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
      expect(content.status).toBe(200);
      const policy = content.headers.get("content-security-policy") ?? "";
      expect(policy).toContain("frame-ancestors https://factrove.app http://localhost:3000");
      expect(policy).toContain("sandbox allow-scripts");
      expect(policy).not.toContain("allow-same-origin");

      const allowed = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`, {
        headers: { origin: "https://factrove.app" },
      });
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://factrove.app");
      expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
      const preflight = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`, {
        method: "OPTIONS",
        headers: {
          origin: "https://factrove.app",
          "access-control-request-method": "GET",
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe("https://factrove.app");
      expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
      expect(preflight.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
      const local = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}`, {
        headers: { origin: "http://localhost:3000" },
      });
      expect(local.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      const evil = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}`, {
        headers: { origin: "https://evil.example" },
      });
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
      const opaque = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}`, {
        headers: { origin: "null" },
      });
      expect(opaque.headers.get("access-control-allow-origin")).toBeNull();

      config.publicBaseUrl = "http://localhost:4000";
      const localShare = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(localShare.share.shareUrl).toBe(`http://localhost:4000/share/${artifact.id}/${token}`);
      const localContent = await globalThis.fetch(`${baseUrl}/api/v1/public/artifacts/${artifact.id}/${token}/content`);
      expect(localContent.headers.get("content-security-policy")).toContain(
        "frame-ancestors http://localhost:4000 http://localhost:3000",
      );
    } finally {
      config.publicBaseUrl = "http://localhost:3000";
    }
  });

  describe("password-protected links", () => {
    const previousProxies = config.trustedProxies;
    let nextVisitor = 0;

    beforeAll(() => {
      config.trustedProxies = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
    });

    afterAll(() => {
      config.trustedProxies = previousProxies;
    });

    function visitorIp(): string {
      nextVisitor += 1;
      return `198.18.${Math.floor(nextVisitor / 250)}.${(nextVisitor % 250) + 1}`;
    }

    function asVisitor(ip: string, input: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      headers.set("x-forwarded-for", ip);
      return globalThis.fetch(input, { ...init, headers });
    }

    function unlock(ip: string, id: string, token: string, password: unknown): Promise<Response> {
      return asVisitor(ip, `${publicPath(baseUrl, id, token)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
    }

    async function unlockUntilReady(ip: string, id: string, token: string, password: string): Promise<Response> {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const response = await unlock(ip, id, token, password);
        if (response.status === 503) {
          expect(expectRetryAfter(response)).toBe(1);
          expect((await errorOf(response)).code).toBe("UNLOCK_UNAVAILABLE");
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        expect(response.status).not.toBe(429);
        return response;
      }
      throw new Error("unlock stayed busy");
    }

    async function grantFor(ip: string, id: string, token: string, password: string): Promise<string> {
      const response = await unlock(ip, id, token, password);
      expect(response.status).toBe(200);
      const envelope = publicUnlockEnvelopeSchema.parse(await response.json());
      if (!envelope.grant) {
        throw new Error("expected a grant");
      }
      return envelope.grant.token;
    }

    function openWithGrant(ip: string, id: string, token: string, grant?: string): Promise<Response> {
      return asVisitor(ip, publicPath(baseUrl, id, token), grant ? { headers: { "x-factrove-share-grant": grant } } : {});
    }

    async function shareWithPassword(id: string, password: string): Promise<{ token: string; shareUrl: string }> {
      const response = await ownerFetch(`${baseUrl}/api/v1/artifacts/${id}/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      expect(response.status).toBe(200);
      const envelope = shareEnvelopeSchema.parse(await response.json());
      expect(envelope.share.passwordProtected).toBe(true);
      const shareUrl = envelope.share.shareUrl ?? "";
      return { token: shareUrl.slice(shareUrl.lastIndexOf("/") + 1), shareUrl };
    }

    function contentPath(contentUrl: string): string {
      const url = new URL(contentUrl);
      return `${baseUrl}${url.pathname}${url.search}`;
    }

    it("hashes the password with Argon2id and shows a password page instead of content until it checks out", async () => {
      const bytes = new TextEncoder().encode("<p>locked secret</p>");
      const artifact = await upload(baseUrl, "locked.html", bytes);
      const password = "correct horse battery";
      const { token, shareUrl } = await shareWithPassword(artifact.id, password);
      expect(shareUrl).toBe(`http://localhost:3000/share/${artifact.id}/${token}`);
      expect(shareUrl).not.toContain(password);

      const stored = await prisma.artifact.findUnique({ where: { id: artifact.id }, select: { sharePasswordHash: true } });
      expect(stored?.sharePasswordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(stored?.sharePasswordHash).not.toContain(password);
      const ownerShare = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(ownerShare.share).toEqual({ shared: true, shareUrl, passwordProtected: true });
      const listed = artifactListEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts`)).json());
      expect(listed.items.find((item) => item.id === artifact.id)).toMatchObject({ shared: true, passwordProtected: true });
      expect(JSON.stringify(listed)).not.toContain(stored?.sharePasswordHash ?? "missing");
      const repeat = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
      })).json());
      expect(repeat.share).toEqual({ shared: true, shareUrl, passwordProtected: true });

      const ip = visitorIp();
      const locked = await openWithGrant(ip, artifact.id, token);
      expect(locked.status).toBe(401);
      expect(locked.headers.get("referrer-policy")).toBe("no-referrer");
      expect(locked.headers.get("x-robots-tag")).toBe("noindex");
      expect(await errorOf(locked)).toEqual({ code: "PASSWORD_REQUIRED", message: "This link needs a password." });

      const wrongToken = await openWithGrant(ip, artifact.id, "z".repeat(43));
      const missing = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/00000000-0000-4000-8000-000000000000`);
      expect(wrongToken.status).toBe(404);
      const notFound = await errorOf(wrongToken);
      expect(notFound).toEqual(await errorOf(missing));
      const wrongTokenUnlock = await unlock(ip, artifact.id, "z".repeat(43), password);
      expect(wrongTokenUnlock.status).toBe(404);
      expect(await errorOf(wrongTokenUnlock)).toEqual(notFound);
      const malformedUnlock = await unlock(ip, artifact.id, "short", password);
      expect(malformedUnlock.status).toBe(404);
      expect(await errorOf(malformedUnlock)).toEqual(notFound);

      const bareContent = await asVisitor(ip, `${publicPath(baseUrl, artifact.id, token)}/content`);
      expect(bareContent.status).toBe(401);
      expect(await errorOf(bareContent)).toEqual({ code: "PASSWORD_REQUIRED", message: "This link needs a password." });
      const junkTicket = await asVisitor(ip, `${publicPath(baseUrl, artifact.id, token)}/content?ticket=t1.abc.def`);
      expect(junkTicket.status).toBe(401);

      const wrong = await unlock(ip, artifact.id, token, "correct horse batter");
      expect(wrong.status).toBe(401);
      expect(await errorOf(wrong)).toEqual({ code: "PASSWORD_INCORRECT", message: "That password is not right." });
      const empty = await unlock(ip, artifact.id, token, "");
      expect(empty.status).toBe(400);
      const notJson = await asVisitor(ip, `${publicPath(baseUrl, artifact.id, token)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `password=${encodeURIComponent(password)}`,
      });
      expect(notJson.status).toBe(400);
      expect((await errorOf(notJson)).code).toBe("INVALID_REQUEST");

      const unlocked = await unlock(ip, artifact.id, token, password);
      expect(unlocked.status).toBe(200);
      expect(unlocked.headers.get("cache-control")).toContain("no-store");
      expect(unlocked.headers.get("set-cookie")).toBeNull();
      const unlockText = await unlocked.text();
      expect(unlockText).not.toContain(password);
      const grant = publicUnlockEnvelopeSchema.parse(JSON.parse(unlockText)).grant;
      expect(grant?.token).toMatch(/^g1\./);
      const expiresIn = new Date(grant?.expiresAt ?? 0).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(14 * 60_000);
      expect(expiresIn).toBeLessThanOrEqual(15 * 60_000);

      const opened = await openWithGrant(ip, artifact.id, token, grant?.token);
      expect(opened.status).toBe(200);
      const detail = publicArtifactEnvelopeSchema.parse(await opened.json()).artifact;
      expect(detail.passwordProtected).toBe(true);
      const contentUrl = new URL(detail.contentUrl);
      expect(`${contentUrl.origin}${contentUrl.pathname}`).toBe(
        `http://localhost:3001/api/v1/public/artifacts/${artifact.id}/${token}/content`,
      );
      expect(contentUrl.searchParams.get("ticket")).toMatch(/^t1\./);
      expect(detail.contentUrl).not.toContain(grant?.token ?? "missing");
      expect(detail.contentUrl).not.toContain(grant?.token.split(".")[2] ?? "missing");

      for (let use = 0; use < SHARE_TICKET_MAX_USES; use += 1) {
        const content = await asVisitor(ip, contentPath(detail.contentUrl));
        expect(content.status).toBe(200);
        expectHtmlHeaders(content.headers);
        expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
      }
      const spent = await asVisitor(ip, contentPath(detail.contentUrl));
      expect(spent.status).toBe(401);
      expect((await errorOf(spent)).code).toBe("PASSWORD_REQUIRED");

      const grantAsTicket = await asVisitor(
        ip,
        `${publicPath(baseUrl, artifact.id, token)}/content?ticket=${encodeURIComponent(grant?.token ?? "")}`,
      );
      expect(grantAsTicket.status).toBe(401);
      const ticketAsGrant = await openWithGrant(ip, artifact.id, token, contentUrl.searchParams.get("ticket") ?? "");
      expect(ticketAsGrant.status).toBe(401);

      const other = await upload(baseUrl, "other.html", new TextEncoder().encode("<p>other</p>"));
      const otherShare = await shareWithPassword(other.id, password);
      const crossed = await openWithGrant(ip, other.id, otherShare.token, grant?.token);
      expect(crossed.status).toBe(401);
      expect((await errorOf(crossed)).code).toBe("PASSWORD_REQUIRED");
    });

    it("serves replaced HTML from a password-protected link and rejects the unlock grant", async () => {
      const original = new TextEncoder().encode("<p>locked-before</p>");
      const next = new TextEncoder().encode("<p>locked-after</p>");
      const artifact = await upload(baseUrl, "locked-replace.html", original);
      const password = "correct horse battery";
      const shared = await shareWithPassword(artifact.id, password);
      const ip = visitorIp();
      const grant = await grantFor(ip, artifact.id, shared.token, password);
      const opened = publicArtifactEnvelopeSchema.parse(
        await (await openWithGrant(ip, artifact.id, shared.token, grant)).json(),
      ).artifact;
      const before = await asVisitor(ip, contentPath(opened.contentUrl));
      expect(before.status).toBe(200);
      expect(Buffer.from(await before.arrayBuffer())).toEqual(Buffer.from(original));

      const form = new FormData();
      form.append("file", new Blob(["<p>from-grant</p>"]), "grant.html");
      const denied = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`, {
        method: "PUT",
        headers: { "x-factrove-share-grant": grant },
        body: form,
      });
      expect(denied.status).toBe(401);
      expect(await errorOf(denied)).toEqual({
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
      });
      const unchanged = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/content`);
      expect(Buffer.from(await unchanged.arrayBuffer())).toEqual(Buffer.from(original));

      const replaced = await putContent(baseUrl, artifact.id, "locked-after.html", next);
      expect(replaced.status).toBe(200);
      const again = shareEnvelopeSchema.parse(
        await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json(),
      );
      expect(again.share).toEqual({ shared: true, shareUrl: shared.shareUrl, passwordProtected: true });

      const reader = visitorIp();
      const nextGrant = await grantFor(reader, artifact.id, shared.token, password);
      const reopened = publicArtifactEnvelopeSchema.parse(
        await (await openWithGrant(reader, artifact.id, shared.token, nextGrant)).json(),
      ).artifact;
      const after = await asVisitor(reader, contentPath(reopened.contentUrl));
      expect(after.status).toBe(200);
      expect(after.headers.get("content-length")).toBe(String(next.byteLength));
      expect(Buffer.from(await after.arrayBuffer())).toEqual(Buffer.from(next));
    });

    it("invalidates grants when the password changes, is removed, the share is revoked, or the key rotates", async () => {
      const artifact = await upload(baseUrl, "rotating.html", new TextEncoder().encode("<p>rotating</p>"));
      const ip = visitorIp();
      const first = "first password value";
      const second = "second password value";
      const { token } = await shareWithPassword(artifact.id, first);
      const firstGrant = await grantFor(ip, artifact.id, token, first);
      expect((await openWithGrant(ip, artifact.id, token, firstGrant)).status).toBe(200);

      const changed = await shareWithPassword(artifact.id, second);
      expect(changed.token).toBe(token);
      expect((await openWithGrant(ip, artifact.id, token, firstGrant)).status).toBe(401);
      expect((await unlock(ip, artifact.id, token, first)).status).toBe(401);
      const secondGrant = await grantFor(ip, artifact.id, token, second);
      expect((await openWithGrant(ip, artifact.id, token, secondGrant)).status).toBe(200);

      await shareWithPassword(artifact.id, second);
      expect((await openWithGrant(ip, artifact.id, token, secondGrant)).status).toBe(401);
      const sameAgain = await grantFor(ip, artifact.id, token, second);
      const lockedDetail = publicArtifactEnvelopeSchema.parse(await (await openWithGrant(ip, artifact.id, token, sameAgain)).json()).artifact;

      const removed = await globalThis.fetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share/password`, {
        method: "DELETE",
        headers: { cookie: owner.cookie, origin: "http://localhost:3000" },
      });
      expect(removed.status).toBe(200);
      const removedShare = shareEnvelopeSchema.parse(await removed.json()).share;
      expect(removedShare.passwordProtected).toBe(false);
      expect(removedShare.shareUrl).toBe(`http://localhost:3000/share/${artifact.id}/${token}`);
      expect((await prisma.artifact.findUnique({ where: { id: artifact.id } }))?.sharePasswordHash).toBeNull();
      const lockedTicket = await asVisitor(ip, contentPath(lockedDetail.contentUrl));
      expect(lockedTicket.status).toBe(200);
      const openNow = await openWithGrant(ip, artifact.id, token);
      expect(openNow.status).toBe(200);
      const openDetail = publicArtifactEnvelopeSchema.parse(await openNow.json()).artifact;
      expect(openDetail.passwordProtected).toBe(false);
      expectPublicContentUrl(openDetail.contentUrl, artifact.id, token);
      expect((await unlock(ip, artifact.id, token, "anything at all")).status).toBe(200);
      const removedAgain = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share/password`, { method: "DELETE" });
      expect(shareEnvelopeSchema.parse(await removedAgain.json()).share.passwordProtected).toBe(false);

      await shareWithPassword(artifact.id, second);
      expect((await openWithGrant(ip, artifact.id, token, sameAgain)).status).toBe(401);
      const beforeRevoke = await grantFor(ip, artifact.id, token, second);
      const ticketed = publicArtifactEnvelopeSchema.parse(await (await openWithGrant(ip, artifact.id, token, beforeRevoke)).json()).artifact;

      const revoked = await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, { method: "DELETE" });
      expect(shareEnvelopeSchema.parse(await revoked.json())).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });
      const afterRevoke = await openWithGrant(ip, artifact.id, token, beforeRevoke);
      expect(afterRevoke.status).toBe(404);
      const revokedError = await errorOf(afterRevoke);
      expect(revokedError).toEqual({ code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." });
      const revokedContent = await asVisitor(ip, contentPath(ticketed.contentUrl));
      expect(revokedContent.status).toBe(404);
      expect(await errorOf(revokedContent)).toEqual(revokedError);
      const revokedUnlock = await unlock(ip, artifact.id, token, second);
      expect(revokedUnlock.status).toBe(404);
      expect(await errorOf(revokedUnlock)).toEqual(revokedError);
      expect((await prisma.artifact.findUnique({ where: { id: artifact.id } }))?.sharePasswordHash).toBeNull();

      const reshared = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
        method: "POST",
      })).json());
      expect(reshared.share.passwordProtected).toBe(false);
      const nextToken = reshared.share.shareUrl?.split("/").at(-1) ?? "";
      expect(nextToken).not.toBe(token);
      const relocked = await shareWithPassword(artifact.id, second);
      expect(relocked.token).toBe(nextToken);
      expect((await openWithGrant(ip, artifact.id, nextToken, beforeRevoke)).status).toBe(401);

      const keyedGrant = await grantFor(ip, artifact.id, nextToken, second);
      expect((await openWithGrant(ip, artifact.id, nextToken, keyedGrant)).status).toBe(200);
      config.shareTokenKey = "rotated-share-token-key-for-password-grants";
      try {
        const rotated = await openWithGrant(ip, artifact.id, nextToken, keyedGrant);
        expect(rotated.status).toBe(404);
        expect(await errorOf(rotated)).toEqual(revokedError);
        const state = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
        expect(state.share).toEqual({ shared: false, shareUrl: null, passwordProtected: false });
        const renewed = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`, {
          method: "POST",
        })).json());
        expect(renewed.share.passwordProtected).toBe(false);
      } finally {
        config.shareTokenKey = null;
      }
    });

    it("throttles failed password attempts per client and per share, apart from the view limit", async () => {
      const artifact = await upload(baseUrl, "throttled.html", new TextEncoder().encode("<p>throttled</p>"));
      const password = "throttle password";
      const { token } = await shareWithPassword(artifact.id, password);

      const noisy = visitorIp();
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_CLIENT; attempt += 1) {
        expect((await unlock(noisy, artifact.id, token, `wrong guess ${attempt}`)).status).toBe(401);
      }
      const blocked = await unlock(noisy, artifact.id, token, password);
      expect(blocked.status).toBe(429);
      expectRetryAfter(blocked);
      expect(await errorOf(blocked)).toEqual({ code: "RATE_LIMITED", message: "Too many password attempts. Try again later." });
      const blockedElsewhere = await unlock(noisy, artifact.id, "y".repeat(43), password);
      expect(blockedElsewhere.status).toBe(429);
      const stillViewable = await openWithGrant(noisy, artifact.id, token);
      expect(stillViewable.status).toBe(401);
      expect((await errorOf(stillViewable)).code).toBe("PASSWORD_REQUIRED");
      expect((await unlock(visitorIp(), artifact.id, token, password)).status).toBe(200);

      const prober = visitorIp();
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_CLIENT; attempt += 1) {
        expect((await unlock(prober, artifact.id, createShareToken(), password)).status).toBe(404);
      }
      expect((await unlock(prober, artifact.id, token, password)).status).toBe(429);

      const target = await upload(baseUrl, "per-share.html", new TextEncoder().encode("<p>per share</p>"));
      const targetShare = await shareWithPassword(target.id, password);
      const bystander = await upload(baseUrl, "bystander.html", new TextEncoder().encode("<p>bystander</p>"));
      const bystanderShare = await shareWithPassword(bystander.id, password);
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_SHARE; attempt += 1) {
        expect((await unlock(visitorIp(), target.id, targetShare.token, `distributed guess ${attempt}`)).status).toBe(401);
      }
      const fresh = visitorIp();
      const shareStillClosed = await unlock(fresh, target.id, targetShare.token, password);
      expect(shareStillClosed.status).toBe(429);
      expectRetryAfter(shareStillClosed);
      expect((await errorOf(shareStillClosed)).code).toBe("RATE_LIMITED");
      const shareWrong = await unlock(visitorIp(), target.id, targetShare.token, "still the wrong guess");
      expect(shareWrong.status).toBe(429);
      expectRetryAfter(shareWrong);
      expect((await errorOf(shareWrong)).code).toBe("RATE_LIMITED");
      expect((await unlock(fresh, bystander.id, bystanderShare.token, password)).status).toBe(200);

      const lockedState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${target.id}/share`)).json());
      expect(lockedState.share.passwordProtected).toBe(true);
      expect(lockedState.share.guessesLockedOut).toBe(true);
    });

    it("does not charge a bucket for a non-JSON unlock body", async () => {
      const artifact = await upload(baseUrl, "cors-lock.html", new TextEncoder().encode("<p>cors lock</p>"));
      const password = "cors lock password";
      const { token } = await shareWithPassword(artifact.id, password);
      const ip = visitorIp();
      const unlockUrl = `${publicPath(baseUrl, artifact.id, token)}/unlock`;
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_CLIENT; attempt += 1) {
        const plain = await asVisitor(ip, unlockUrl, {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: password,
        });
        expect(plain.status).toBe(400);
        expect((await errorOf(plain)).code).toBe("INVALID_REQUEST");
      }
      const form = await asVisitor(ip, unlockUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `password=${encodeURIComponent(password)}`,
      });
      expect(form.status).toBe(400);
      const empty = await asVisitor(ip, unlockUrl, { method: "POST" });
      expect(empty.status).toBe(400);
      expect((await unlock(ip, artifact.id, token, password)).status).toBe(200);
    });

    it("lets thirty-one correct visitors through and locks only after failed guesses", async () => {
      const artifact = await upload(baseUrl, "meeting.html", new TextEncoder().encode("<p>meeting</p>"));
      const password = "meeting password";
      const first = await shareWithPassword(artifact.id, password);
      for (let visitor = 0; visitor < PASSWORD_ATTEMPTS_PER_SHARE; visitor += 1) {
        expect((await unlock(visitorIp(), artifact.id, first.token, password)).status).toBe(200);
      }
      expect((await unlock(visitorIp(), artifact.id, first.token, password)).status).toBe(200);
      const openState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(openState.share.guessesLockedOut).toBeUndefined();

      const exhausted = await upload(baseUrl, "reshare.html", new TextEncoder().encode("<p>reshare</p>"));
      const oldShare = await shareWithPassword(exhausted.id, password);
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_SHARE; attempt += 1) {
        expect((await unlock(visitorIp(), exhausted.id, oldShare.token, `old wrong ${attempt}`)).status).toBe(401);
      }
      const locked = await unlock(visitorIp(), exhausted.id, oldShare.token, password);
      expect(locked.status).toBe(429);
      expectRetryAfter(locked);
      expect((await errorOf(locked)).code).toBe("RATE_LIMITED");
      const lockedState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${exhausted.id}/share`)).json());
      expect(lockedState.share.guessesLockedOut).toBe(true);

      const revoked = await ownerFetch(`${baseUrl}/api/v1/artifacts/${exhausted.id}/share`, { method: "DELETE" });
      expect(revoked.status).toBe(200);
      const next = await shareWithPassword(exhausted.id, "brand new password");
      expect(next.token).not.toBe(oldShare.token);
      expect((await unlock(visitorIp(), exhausted.id, next.token, "first wrong on the new link")).status).toBe(401);
      expect((await unlock(visitorIp(), exhausted.id, next.token, "brand new password")).status).toBe(200);
      const resetState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${exhausted.id}/share`)).json());
      expect(resetState.share.guessesLockedOut).toBeUndefined();
    });

    it("does not let one IP's correct unlocks starve another IP", async () => {
      const password = "starve password";
      const shares: Array<{ id: string; token: string }> = [];
      for (let index = 0; index < 6; index += 1) {
        const artifact = await upload(baseUrl, `starve-${index}.html`, new TextEncoder().encode(`<p>starve ${index}</p>`));
        const shared = await shareWithPassword(artifact.id, password);
        shares.push({ id: artifact.id, token: shared.token });
      }
      const attacker = visitorIp();
      const victim = visitorIp();
      for (let index = 0; index < 5; index += 1) {
        const share = shares[index];
        if (!share) {
          throw new Error("missing starve share");
        }
        for (let attempt = 0; attempt < 4; attempt += 1) {
          expect((await unlock(attacker, share.id, share.token, password)).status).toBe(200);
        }
      }
      expect(5 * 4).toBe(VERIFY_ATTEMPTS_PER_MINUTE);
      const last = shares[5];
      if (!last) {
        throw new Error("missing victim share");
      }
      const blocked = await unlock(attacker, last.id, last.token, password);
      expect(blocked.status).toBe(429);
      expectRetryAfter(blocked);
      expect((await errorOf(blocked)).code).toBe("RATE_LIMITED");
      expect((await unlock(victim, last.id, last.token, password)).status).toBe(200);
    });

    it("does not let concurrent wrong guesses overshoot the share cap", async () => {
      const artifact = await upload(baseUrl, "overshoot.html", new TextEncoder().encode("<p>overshoot</p>"));
      const password = "overshoot password";
      const { token } = await shareWithPassword(artifact.id, password);
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_SHARE - 1; attempt += 1) {
        expect((await unlock(visitorIp(), artifact.id, token, `old miss ${attempt}`)).status).toBe(401);
      }
      const responses = await Promise.all(
        Array.from({ length: 16 }, (_, attempt) => unlock(visitorIp(), artifact.id, token, `parallel miss ${attempt}`)),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 401)).toHaveLength(1);
      expect(statuses.filter((status) => status === 200)).toHaveLength(0);
      expect(statuses.filter((status) => status === 429 || status === 503)).toHaveLength(15);
      await Promise.all(responses.map((response) => response.arrayBuffer()));
      const locked = await unlock(visitorIp(), artifact.id, token, password);
      expect(locked.status).toBe(429);
      expectRetryAfter(locked);
      const lockedState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(lockedState.share.guessesLockedOut).toBe(true);
    });

    it("lets forty concurrent correct visitors through without locking the share", async () => {
      const artifact = await upload(baseUrl, "crowd.html", new TextEncoder().encode("<p>crowd</p>"));
      const password = "crowd password";
      const { token } = await shareWithPassword(artifact.id, password);
      const pending = Array.from({ length: 40 }, () => unlockUntilReady(visitorIp(), artifact.id, token, password));
      const during = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(during.share.guessesLockedOut).toBeUndefined();
      const responses = await Promise.all(pending);
      expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 40 }, () => 200));
      const after = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(after.share.guessesLockedOut).toBeUndefined();
    });

    it("does not lock out concurrent correct visitors after twenty-nine failures", async () => {
      const artifact = await upload(baseUrl, "almost.html", new TextEncoder().encode("<p>almost</p>"));
      const password = "almost password";
      const { token } = await shareWithPassword(artifact.id, password);
      for (let attempt = 0; attempt < PASSWORD_ATTEMPTS_PER_SHARE - 1; attempt += 1) {
        expect((await unlock(visitorIp(), artifact.id, token, `seed miss ${attempt}`)).status).toBe(401);
      }
      const openState = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(openState.share.guessesLockedOut).toBeUndefined();
      const responses = await Promise.all(
        Array.from({ length: 4 }, () => unlockUntilReady(visitorIp(), artifact.id, token, password)),
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      const after = shareEnvelopeSchema.parse(await (await ownerFetch(`${baseUrl}/api/v1/artifacts/${artifact.id}/share`)).json());
      expect(after.share.guessesLockedOut).toBeUndefined();
    });

    it("does not hold the Argon2 gate while a share is in backoff", async () => {
      const limiter = app.get(PasswordAttemptLimiter);
      const sleeping = await upload(baseUrl, "backoff-sleep.html", new TextEncoder().encode("<p>sleep</p>"));
      const victim = await upload(baseUrl, "backoff-victim.html", new TextEncoder().encode("<p>victim</p>"));
      const password = "backoff delay password";
      const sleepingShare = await shareWithPassword(sleeping.id, password);
      const victimShare = await shareWithPassword(victim.id, password);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        expect((await unlock(visitorIp(), sleeping.id, sleepingShare.token, `seed miss ${attempt}`)).status).toBe(401);
      }
      expect(limiter.shareDelayMs(hashShareToken(sleepingShare.token))).toBe(0);
      limiter.setDelayMaxMs(SHARE_DELAY_MAX_MS);
      expect(limiter.shareDelayMs(hashShareToken(sleepingShare.token))).toBeGreaterThan(0);
      try {
        const delayed = Array.from({ length: ARGON2_VERIFY_LIMIT }, (_, attempt) =>
          unlock(visitorIp(), sleeping.id, sleepingShare.token, `delayed miss ${attempt}`),
        );
        const started = Date.now();
        const other = await unlock(visitorIp(), victim.id, victimShare.token, password);
        expect(Date.now() - started).toBeLessThan(SHARE_DELAY_MAX_MS);
        expect(other.status).toBe(200);
        const delayedStatuses = (await Promise.all(delayed)).map((response) => response.status);
        expect(delayedStatuses.every((status) => status === 401 || status === 429)).toBe(true);
        expect(delayedStatuses).not.toContain(503);
      } finally {
        limiter.setDelayMaxMs(0);
      }
    });

    it("caps 65 parallel unlocks from one address before Argon2", async () => {
      const artifact = await upload(baseUrl, "parallel-ip.html", new TextEncoder().encode("<p>parallel ip</p>"));
      const password = "parallel ip password";
      const { token } = await shareWithPassword(artifact.id, password);
      const ip = visitorIp();
      const responses = await Promise.all(
        Array.from({ length: 65 }, (_, attempt) => unlock(ip, artifact.id, token, `wrong parallel ${attempt}`)),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(0);
      expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(PASSWORD_ATTEMPTS_PER_CLIENT);
      expect(statuses.filter((status) => status === 429 || status === 503).length).toBeGreaterThanOrEqual(55);
      expect(statuses).toHaveLength(65);
      for (const response of responses) {
        if (response.status === 429 || response.status === 503) {
          expectRetryAfter(response);
        }
      }
      await Promise.all(responses.map((response) => response.arrayBuffer()));
    });

    it("caps rotated addresses against one share before Argon2", async () => {
      const artifact = await upload(baseUrl, "rotated-ip.html", new TextEncoder().encode("<p>rotated ip</p>"));
      const password = "rotated ip password";
      const { token } = await shareWithPassword(artifact.id, password);
      const responses = await Promise.all(
        Array.from({ length: 65 }, (_, attempt) => unlock(visitorIp(), artifact.id, token, `rotated guess ${attempt}`)),
      );
      const statuses = responses.map((response) => response.status);
      expect(statuses.filter((status) => status === 200)).toHaveLength(0);
      expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(PASSWORD_ATTEMPTS_PER_SHARE);
      expect(statuses.filter((status) => status === 429 || status === 503).length).toBeGreaterThanOrEqual(35);
      expect(statuses).toHaveLength(65);
      await Promise.all(responses.map((response) => response.arrayBuffer()));
    });

    it("validates owner password changes and keeps the unlock route credential-free", async () => {
      const artifact = await upload(baseUrl, "controls.html", new TextEncoder().encode("<p>controls</p>"));
      const shareRoute = `${baseUrl}/api/v1/artifacts/${artifact.id}/share`;
      const json = { "content-type": "application/json" };

      const anonymous = await globalThis.fetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "x" }) });
      expect(anonymous.status).toBe(401);
      const anonymousRemove = await globalThis.fetch(`${shareRoute}/password`, { method: "DELETE" });
      expect(anonymousRemove.status).toBe(401);

      const short = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "short" }) });
      expect(short.status).toBe(400);
      expect(await errorOf(short)).toEqual({ code: "INVALID_REQUEST", message: "The password is invalid. Use at least 10 characters." });
      const nfcShort = await ownerFetch(shareRoute, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ password: "é".normalize("NFD").repeat(9) }),
      });
      expect(nfcShort.status).toBe(400);
      expect(await errorOf(nfcShort)).toEqual({ code: "INVALID_REQUEST", message: "The password is invalid. Use at least 10 characters." });
      const whitespace = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "          " }) });
      expect(whitespace.status).toBe(400);
      expect(await errorOf(whitespace)).toEqual({
        code: "INVALID_REQUEST",
        message: "The password is invalid. Choose a password with letters or numbers.",
      });
      const repeated = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "ababababab" }) });
      expect(repeated.status).toBe(400);
      expect(await errorOf(repeated)).toEqual({
        code: "INVALID_REQUEST",
        message: "The password is invalid. Use at least 4 different characters.",
      });
      const common = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "password123" }) });
      expect(common.status).toBe(400);
      expect(await errorOf(common)).toEqual({ code: "INVALID_REQUEST", message: "The password is invalid. Choose a less common password." });
      const long = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "p".repeat(129) }) });
      expect(long.status).toBe(400);
      const extra = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "long enough", note: 1 }) });
      expect(extra.status).toBe(400);
      const typed = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: 12345678 }) });
      expect(typed.status).toBe(400);
      const form = await ownerFetch(shareRoute, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ password: "long enough" }),
      });
      expect(form.status).toBe(400);
      const huge = await ownerFetch(shareRoute, { method: "POST", headers: json, body: JSON.stringify({ password: "p".repeat(5000) }) });
      expect(huge.status).toBe(400);
      expect((await prisma.artifact.findUnique({ where: { id: artifact.id } }))?.shareTokenHash).toBeNull();

      const unshared = await ownerFetch(`${shareRoute}/password`, { method: "DELETE" });
      expect(shareEnvelopeSchema.parse(await unshared.json())).toEqual({ share: { shared: false, shareUrl: null, passwordProtected: false } });

      const crossSite = await globalThis.fetch(shareRoute, {
        method: "POST",
        headers: { ...json, cookie: owner.cookie, origin: "https://evil.example" },
        body: JSON.stringify({ password: "long enough" }),
      });
      expect(crossSite.status).toBe(403);
      const session = await globalThis.fetch(shareRoute, {
        method: "POST",
        headers: { ...json, cookie: owner.cookie, origin: "http://localhost:3000" },
        body: JSON.stringify({ password: "long enough" }),
      });
      expect(session.status).toBe(200);
      expect(shareEnvelopeSchema.parse(await session.json()).share.passwordProtected).toBe(true);

      const member = await signUpWithApiKey(baseUrl, {
        email: "member-password@example.invalid",
        password: "member-password-1",
        name: "Member",
        keyName: "member",
      });
      const memberSet = await globalThis.fetch(shareRoute, {
        method: "POST",
        headers: { ...json, authorization: `Bearer ${member.apiKey}` },
        body: JSON.stringify({ password: "member override" }),
      });
      const memberRemove = await globalThis.fetch(`${shareRoute}/password`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${member.apiKey}` },
      });
      expect(memberSet.status).toBe(404);
      expect(memberRemove.status).toBe(404);
      expect(shareEnvelopeSchema.parse(await (await ownerFetch(shareRoute)).json()).share.passwordProtected).toBe(true);

      const token = shareEnvelopeSchema.parse(await (await ownerFetch(shareRoute)).json()).share.shareUrl?.split("/").at(-1) ?? "";
      const unlockPreflight = await globalThis.fetch(`${publicPath(baseUrl, artifact.id, token)}/unlock`, {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(unlockPreflight.status).toBe(204);
      expect(unlockPreflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(unlockPreflight.headers.get("access-control-allow-methods")).toBe("POST,OPTIONS");
      expect(unlockPreflight.headers.get("access-control-allow-credentials")).toBeNull();
      expect(unlockPreflight.headers.get("access-control-expose-headers")?.toLowerCase()).toContain("retry-after");
      const detailPreflight = await globalThis.fetch(publicPath(baseUrl, artifact.id, token), {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
          "access-control-request-headers": "x-factrove-share-grant",
        },
      });
      expect(detailPreflight.headers.get("access-control-allow-methods")).toBe("GET,HEAD,OPTIONS");
      expect(detailPreflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-factrove-share-grant");
      expect(detailPreflight.headers.get("access-control-allow-credentials")).toBeNull();
      const postDetail = await globalThis.fetch(publicPath(baseUrl, artifact.id, token), { method: "POST" });
      expect(postDetail.status).toBe(404);
      expect((await errorOf(postDetail)).code).toBe("ARTIFACT_NOT_FOUND");

      const cookieUnlock = await globalThis.fetch(`${publicPath(baseUrl, artifact.id, token)}/unlock`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
          origin: "https://evil.example",
        },
        body: JSON.stringify({ password: "long enough" }),
      });
      expect(cookieUnlock.status).toBe(200);
    });

    it("returns the public 404 for a malformed percent-encoded share path", async () => {
      const artifact = await upload(baseUrl, "percent.html", new TextEncoder().encode("<p>percent</p>"));
      const { token } = await shareWithPassword(artifact.id, "percent path password");
      const broken = await rawPublicGet(baseUrl, `/api/v1/public/artifacts/${artifact.id}/%ZZ${token.slice(2)}`);
      expect(broken.status).toBe(404);
      expect(broken.json).toEqual({ error: { code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." } });
    });
  });
});

async function createApp(appConfig: ApiConfig, store: BlobStore): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(API_CONFIG)
    .useValue(appConfig)
    .overrideProvider(BLOB_STORE)
    .useValue(store)
    .overrideProvider(PasswordAttemptLimiter)
    .useValue(
      new PasswordAttemptLimiter(
        PASSWORD_ATTEMPTS_PER_CLIENT,
        PASSWORD_ATTEMPTS_PER_SHARE,
        PASSWORD_ATTEMPT_WINDOW_MS,
        () => performance.now(),
        PASSWORD_ATTEMPT_MAX_KEYS,
        0,
      ),
    )
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

function retainedBufferBytes(): number {
  const gc = (globalThis as { gc?: (options?: { type?: string; execution?: string }) => void }).gc;
  expect(typeof gc).toBe("function");
  gc?.({ type: "major", execution: "sync" });
  gc?.({ type: "major", execution: "sync" });
  return process.memoryUsage().arrayBuffers;
}

function filenameStarBody(boundary: string, preamble: string, encodedName = "caf%C3%83%C2%A9.html"): Buffer {
  return Buffer.concat([
    Buffer.from(
      `${preamble}\r\n--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename*=UTF-8''${encodedName}\r\n` +
        `Content-Type: text/html\r\n\r\n`,
      "utf8",
    ),
    Buffer.from("<p>star</p>"),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}

function postMultipart(url: string, boundary: string, body: Buffer, apiKey = ownerApiKey): Promise<Response> {
  return globalThis.fetch(`${url}/api/v1/artifacts`, {
    method: "POST",
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

function putMultipart(url: string, id: string, boundary: string, body: Buffer, apiKey = ownerApiKey): Promise<Response> {
  return globalThis.fetch(`${url}/api/v1/artifacts/${id}/content`, {
    method: "PUT",
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
}

function filePartWithoutFilename(boundary: string, filename: string | undefined): Buffer {
  const disposition = filename === undefined
    ? `Content-Disposition: form-data; name="file"`
    : `Content-Disposition: form-data; name="file"; filename="${filename}"`;
  return Buffer.from(
    `--${boundary}\r\n${disposition}\r\nContent-Type: application/octet-stream\r\n\r\n<html></html>\r\n--${boundary}--\r\n`,
    "utf8",
  );
}

function rawRequest(
  url: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<{ status: number; message: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers: {
        authorization: `Bearer ${ownerApiKey}`,
        ...headers,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { error?: { message?: string } };
        resolve({ status: res.statusCode ?? 0, message: payload.error?.message ?? "" });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

type RawHttpMessage = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

function writeThenRead(
  url: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body: Buffer,
): Promise<RawHttpMessage> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = openTcp(Number(target.port), target.hostname, () => {
      const headerLines = Object.entries({
        host: `${target.hostname}:${target.port}`,
        authorization: `Bearer ${ownerApiKey}`,
        "content-length": String(body.length),
        ...headers,
      }).map(([name, value]) => `${name}: ${value}`).join("\r\n");
      socket.write(`${method} ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      writeSocket(socket, body).then(() => {
        readSocket(socket).then((received) => {
          socket.destroy();
          const parsed = readHttpMessages(received);
          const message = parsed[0];
          if (!message) {
            reject(new Error(`no response after ${received.length} bytes`));
            return;
          }
          resolve(message);
        }).catch(reject);
      }).catch(reject);
    });
    socket.on("error", reject);
  });
}

function slowPipelinedRead(
  url: string,
  artifactId: string,
  boundary: string,
): Promise<{ messages: RawHttpMessage[] }> {
  const target = new URL(url);
  const postBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.html"\r\nContent-Type: text/html\r\n\r\nhello\r\n--${boundary}--\r\n`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = openTcp(Number(target.port), target.hostname, () => {
      const common = `Host: ${target.hostname}:${target.port}\r\nAuthorization: Bearer ${ownerApiKey}\r\n`;
      socket.write(
        `GET /api/v1/artifacts/${artifactId}/content HTTP/1.1\r\n${common}Connection: keep-alive\r\n\r\n` +
        `POST /api/v1/artifacts HTTP/1.1\r\n${common}Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${postBody.length}\r\nConnection: keep-alive\r\n\r\n`,
      );
      writeSocket(socket, postBody).catch((error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      const received = Buffer.concat(chunks).length;
      socket.destroy();
      reject(new Error(`slow read stalled after ${received} bytes`));
    }, 20000);
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      socket.pause();
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.resume();
        }
      }, 10);
    });
    socket.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ messages: readHttpMessages(Buffer.concat(chunks)) });
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function backpressuredPipelinedRead(
  url: string,
  artifactId: string,
  boundary: string,
  postBody: Buffer,
): Promise<{ messages: RawHttpMessage[]; bytesSent: number; bytesSentAfterRead: number }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    let bytesSent = 0;
    let bytesSentAfterRead = 0;
    let reading = false;
    const socket = openTcp(Number(target.port), target.hostname, () => {
      const common = `Host: ${target.hostname}:${target.port}\r\nAuthorization: Bearer ${ownerApiKey}\r\n`;
      socket.write(
        `GET /api/v1/artifacts/${artifactId}/content HTTP/1.1\r\n${common}Connection: keep-alive\r\n\r\n` +
        `POST /api/v1/artifacts HTTP/1.1\r\n${common}Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${postBody.length}\r\nConnection: keep-alive\r\n\r\n`,
      );
      const first = Math.min(32 * 1024, postBody.length);
      writeSocket(socket, postBody.subarray(0, first)).then(() => {
        bytesSent = first;
        sendRemainder();
      }).catch(fail);
    });
    const timer = setTimeout(() => {
      fail(new Error(`backpressured read stalled after ${Buffer.concat(chunks).length} bytes, sent ${bytesSent}`));
    }, 20000);
    const sendRemainder = (): void => {
      if (settled || bytesSent >= postBody.length) {
        return;
      }
      const end = Math.min(bytesSent + 16 * 1024, postBody.length);
      const ok = socket.write(postBody.subarray(bytesSent, end));
      bytesSent = end;
      if (reading) {
        bytesSentAfterRead = bytesSent;
      }
      if (bytesSent >= postBody.length) {
        return;
      }
      if (!ok) {
        socket.once("drain", sendRemainder);
        return;
      }
      setTimeout(sendRemainder, 15);
    };
    const fail = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    };
    socket.on("data", (chunk: Buffer) => {
      reading = true;
      chunks.push(chunk);
      socket.pause();
      setTimeout(() => {
        if (!socket.destroyed) {
          socket.resume();
        }
      }, 10);
    });
    socket.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ messages: readHttpMessages(Buffer.concat(chunks)), bytesSent, bytesSentAfterRead });
    });
    socket.on("error", fail);
  });
}

function halfOpenRejectedUpload(
  url: string,
  boundary: string,
  body: Buffer,
): Promise<{ socket: Socket; status: number; body: Buffer }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = openTcp({ port: Number(target.port), host: target.hostname, allowHalfOpen: true }, () => {
      socket.write(
        `POST /api/v1/artifacts HTTP/1.1\r\nHost: ${target.hostname}:${target.port}\r\nAuthorization: Bearer ${ownerApiKey}\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n`,
      );
      writeSocket(socket, body).then(() => readOneHttpMessage(socket)).then((message) => {
        resolve({ socket, status: message.status, body: message.body });
      }).catch(reject);
    });
    socket.on("error", reject);
  });
}

function blockedEarlierResponse(url: string, artifactId: string, boundary: string): Promise<{ socket: Socket }> {
  const target = new URL(url);
  const postBody = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="a.html"\r\nContent-Type: text/html\r\n\r\nhello\r\n--${boundary}--\r\n`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const socket = openTcp({ port: Number(target.port), host: target.hostname, allowHalfOpen: true }, () => {
      const common = `Host: ${target.hostname}:${target.port}\r\nAuthorization: Bearer ${ownerApiKey}\r\n`;
      socket.write(
        `GET /api/v1/artifacts/${artifactId}/content HTTP/1.1\r\n${common}Connection: keep-alive\r\n\r\n` +
        `POST /api/v1/artifacts HTTP/1.1\r\n${common}Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: ${postBody.length}\r\nConnection: keep-alive\r\n\r\n`,
      );
      writeSocket(socket, postBody).then(() => {
        socket.pause();
        resolve({ socket });
      }).catch(reject);
    });
    socket.on("error", () => {});
  });
}

function readOneHttpMessage(socket: Socket): Promise<RawHttpMessage> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for one response after ${Buffer.concat(chunks).length} bytes`));
    }, 5_000);
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      const message = readHttpMessages(Buffer.concat(chunks))[0];
      if (!message) {
        return;
      }
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

type CountedSocket = {
  localPort?: number;
  remotePort?: number;
  remoteAddress?: string;
  destroyed?: boolean;
};

function activeSockets(): CountedSocket[] {
  const handles = (process as NodeJS.Process & { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
  return handles.filter((handle): handle is CountedSocket => {
    return typeof handle === "object" && handle !== null && "localPort" in handle;
  });
}

function serverSocketCount(port: number): number {
  return activeSockets().filter((socket) => socket.localPort === port && socket.remoteAddress && socket.destroyed !== true).length;
}

function serverSocketsFor(port: number, remotePorts: Set<number>): number {
  return activeSockets().filter((socket) =>
    socket.localPort === port
    && socket.remoteAddress
    && remotePorts.has(socket.remotePort ?? -1)
    && socket.destroyed !== true
  ).length;
}

function tcpSocketCount(): number {
  return getActiveResourcesInfo().filter((name) => name === "TCPSocketWrap").length;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForTcpSockets(baseline: number): Promise<void> {
  const started = Date.now();
  while (tcpSocketCount() > baseline && Date.now() - started < 2_000) {
    await delay(50);
  }
}

function writeSocket(socket: Socket, body: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    let offset = 0;
    const write = (): void => {
      while (offset < body.length) {
        const end = Math.min(offset + 64 * 1024, body.length);
        const ok = socket.write(body.subarray(offset, end));
        offset = end;
        if (!ok) {
          socket.once("drain", write);
          return;
        }
      }
      resolve();
    };
    socket.on("error", reject);
    write();
  });
}

function readSocket(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks)));
    socket.on("error", reject);
  });
}

function readHttpMessages(buffer: Buffer): RawHttpMessage[] {
  const messages: RawHttpMessage[] = [];
  let offset = 0;
  while (offset + 4 < buffer.length) {
    const headerEnd = buffer.indexOf("\r\n\r\n", offset);
    if (headerEnd === -1) {
      break;
    }
    const head = buffer.toString("latin1", offset, headerEnd);
    const status = Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0);
    const headers: Record<string, string> = {};
    for (const line of head.split("\r\n").slice(1)) {
      const split = line.indexOf(":");
      if (split > 0) {
        headers[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
      }
    }
    const length = Number(headers["content-length"] ?? Number.NaN);
    if (!Number.isFinite(length)) {
      break;
    }
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      break;
    }
    messages.push({ status, headers, body: buffer.subarray(bodyStart, bodyStart + length) });
    offset = bodyStart + length;
  }
  return messages;
}

function tricklingMultipart(
  url: string,
  method: string,
  path: string,
  boundary: string,
  head: Buffer,
): Promise<{ status: number; message: string; elapsed: number }> {
  const target = new URL(url);
  const started = performance.now();
  const agent = new Agent({ keepAlive: false });
  let req: ReturnType<typeof httpRequest> | undefined;
  let trickle: ReturnType<typeof setInterval> | undefined;
  const work = new Promise<{ status: number; message: string }>((resolve, reject) => {
    let finished = false;
    req = httpRequest({
      agent,
      hostname: target.hostname,
      port: target.port,
      path,
      method,
      headers: {
        authorization: `Bearer ${ownerApiKey}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": String(2_000_000),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        finished = true;
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { error?: { message?: string } };
        resolve({ status: res.statusCode ?? 0, message: payload.error?.message ?? "" });
      });
    });
    req.on("error", (error) => {
      if (!finished) {
        reject(error);
      }
    });
    req.write(head);
    trickle = setInterval(() => {
      if (!req?.destroyed) {
        req?.write(Buffer.from("x"));
      }
    }, 50);
  });
  return settledWithin(work, 1000).then((result) => ({ ...result, elapsed: performance.now() - started })).finally(() => {
    if (trickle) {
      clearInterval(trickle);
    }
    req?.destroy();
    agent.destroy();
  });
}

function postFile(
  url: string,
  filename: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
  apiKey = ownerApiKey,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return globalThis.fetch(`${url}/api/v1/artifacts`, {
    method: "POST",
    body: form,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
}

function putCookieContent(
  url: string,
  cookie: string,
  id: string,
  filename: string,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  return globalThis.fetch(`${url}/api/v1/artifacts/${id}/content`, {
    method: "PUT",
    body: form,
    headers: { cookie, ...headers },
  });
}

function readPausedContent(
  url: string,
  auth = true,
): Promise<{ status: number; contentLength: string | null; bytes: Uint8Array }> {
  const target = new URL(url);
  const headers: Record<string, string> = {};
  if (auth && ownerApiKey) {
    headers.authorization = `Bearer ${ownerApiKey}`;
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const lengthHeader = res.headers["content-length"];
          resolve({
            status: res.statusCode ?? 0,
            contentLength: typeof lengthHeader === "string" ? lengthHeader : null,
            bytes: new Uint8Array(Buffer.concat(chunks)),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function putContent(
  url: string,
  id: string,
  filename: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
  apiKey: string | null = ownerApiKey,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return globalThis.fetch(`${url}/api/v1/artifacts/${id}/content`, {
    method: "PUT",
    body: form,
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
}

async function upload(
  url: string,
  filename: string,
  bytes: Uint8Array,
  fields: Record<string, string> = {},
  apiKey = ownerApiKey,
): Promise<ArtifactDto> {
  const response = await postFile(url, filename, bytes, fields, apiKey);
  expect(response.status).toBe(201);
  return artifactEnvelopeSchema.parse(await response.json()).artifact;
}

function expectRetryAfter(response: Response): number {
  const value = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  expect(value).toBeGreaterThanOrEqual(1);
  return value;
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const body: unknown = await response.json();
  const parsed = apiErrorSchema.parse(body);
  expect(Object.keys(parsed.error)).toEqual(["code", "message"]);
  return parsed.error;
}

function expectMarkdownHeaders(headers: Headers, sizeBytes: number): void {
  expect(headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  expect(headers.get("content-length")).toBe(String(sizeBytes));
  expect(headers.get("cache-control")).toContain("no-store");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("referrer-policy")).toBe("no-referrer");
  const policy = headers.get("content-security-policy") ?? "";
  expect(policy).toBe(markdownContentSecurityPolicy());
  expect(policy).not.toContain("unsafe-inline");
  expect(policy).not.toContain("allow-scripts");
}

function expectHtmlHeaders(headers: Headers): void {
  expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(headers.get("cache-control")).toContain("no-store");
  expect(headers.get("x-content-type-options")).toBe("nosniff");
  expect(headers.get("referrer-policy")).toBe("no-referrer");
  const policy = headers.get("content-security-policy") ?? "";
  expect(policy).toContain("sandbox allow-scripts");
  expect(policy).not.toContain("allow-same-origin");
  expect(policy).not.toContain("allow-top-navigation");
  expect(policy).not.toContain("allow-forms");
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("script-src 'unsafe-inline'");
  expect(policy).toContain("style-src 'unsafe-inline'");
  expect(policy).toContain("img-src data: blob:");
  expect(policy).toContain("font-src data: blob:");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("form-action 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("frame-src 'none'");
  expect(policy).toContain("base-uri 'none'");
  expect(policy).toContain("frame-ancestors http://localhost:3000");
  expect(policy).not.toContain("*");
}

function rawPublicGet(root: string, path: string): Promise<{ status: number; json: unknown }> {
  const target = new URL(root);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: "GET",
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function getWithHost(url: string, host: string): Promise<{ status: number; json: unknown }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: { Host: host, Accept: "application/json", Authorization: `Bearer ${ownerApiKey}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as unknown });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function settledWithin<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${milliseconds}ms`)), milliseconds);
  });
  work.catch(() => undefined);
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function readContent(url: string): Promise<Uint8Array> {
  const response = await ownerFetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

function postCookieFile(
  url: string,
  cookie: string,
  filename: string,
  bytes: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)]), filename);
  return globalThis.fetch(`${url}/api/v1/artifacts`, {
    method: "POST",
    body: form,
    headers: { cookie, ...headers },
  });
}

function ownerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (ownerApiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${ownerApiKey}`);
  }
  return globalThis.fetch(input, { ...init, headers });
}

function publicPath(root: string, id: string, token: string): string {
  return `${root}/api/v1/public/artifacts/${id}/${token}`;
}

function expectPlainContentUrl(value: string, id: string): void {
  const url = new URL(value);
  expect(`${url.origin}${url.pathname}`).toBe(`http://localhost:3001/api/v1/artifacts/${id}/content`);
  expect(url.search).toBe("");
}

function expectGrantedContentUrl(value: string, id: string): void {
  const url = new URL(value);
  expect(`${url.origin}${url.pathname}`).toBe(`http://localhost:3001/api/v1/artifacts/${id}/content`);
  expect(url.searchParams.get("access")?.length).toBeGreaterThan(10);
  expect(url.searchParams.has("format")).toBe(false);
}

function expectPublicContentUrl(value: string, id: string, token: string): void {
  expect(value).toBe(`http://localhost:3001/api/v1/public/artifacts/${id}/${token}/content`);
}
