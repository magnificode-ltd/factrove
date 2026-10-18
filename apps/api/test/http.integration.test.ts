import "reflect-metadata";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  apiErrorSchema,
  artifactEnvelopeSchema,
  artifactListEnvelopeSchema,
  contextEnvelopeSchema,
  healthEnvelopeSchema,
  type ArtifactDto,
} from "@factrove/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureHttpApp } from "../src/configure-http-app.js";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { ArtifactsRepository } from "../src/database/repositories/artifacts.repository.js";
import { localOrganizationFixture, localUserFixture, seedLocalIdentities } from "../src/database/seed/seed-local-identities.js";
import { API_CONFIG, readApiConfig, type ApiConfig } from "../src/services/api-config.js";
import { BLOB_STORE, BlobNotFoundError, BlobStoreUnavailableError, type BlobStore } from "../src/storage/blob-store.js";
import { withMarkdownConversionSlot } from "../src/rendering/convert-html-to-markdown.js";
import { markdownContentSecurityPolicy, MAX_HTML_BYTES } from "../src/rendering/html-policy.js";
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
  authSecret: TEST_AUTH_SECRET,
};

let ownerApiKey = "";

class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>();
  failPut = false;
  putError: Error | undefined;
  failGet = false;
  throwBeforeChunk = false;
  interruptAfterFirstChunk = false;

  async put(input: { objectKey: string; body: Uint8Array; contentType: string }): Promise<void> {
    if (this.putError) {
      throw this.putError;
    }
    if (this.failPut) {
      throw new BlobStoreUnavailableError("Object storage is unavailable");
    }
    this.objects.set(input.objectKey, Uint8Array.from(input.body));
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
    this.objects.clear();
    this.failPut = false;
    this.putError = undefined;
    this.failGet = false;
    this.throwBeforeChunk = false;
    this.interruptAfterFirstChunk = false;
  }
}

describe("API configuration", () => {
  it("binds to loopback and the local origins by default", () => {
    const defaults = readApiConfig({ BETTER_AUTH_SECRET: TEST_AUTH_SECRET });
    expect(defaults.host).toBe("127.0.0.1");
    expect(defaults.port).toBe(3001);
    expect(defaults.webOrigin).toBe("http://localhost:3000");
    expect(defaults.apiPublicOrigin).toBe("http://localhost:3001");
    expect(defaults.authSecret).toBe(TEST_AUTH_SECRET);
  });

  it("rejects a short auth secret", () => {
    expect(() => readApiConfig({ BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("rejects an origin that includes a path", () => {
    expect(() => readApiConfig({ WEB_ORIGIN: "http://localhost:3000/app" })).toThrow(/WEB_ORIGIN/);
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
    expect(body.artifact.sizeBytes).toBe(bytes.byteLength);
    expect(body.artifact.viewerUrl).toBe(`http://localhost:3000/artifacts/${body.artifact.id}`);
    expectGrantedContentUrl(body.artifact.contentUrl, body.artifact.id);
    expect(store.objects.has(`${body.artifact.id}.html`)).toBe(true);

    const listed = await ownerFetch(`${baseUrl}/api/v1/artifacts`);
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toContain("no-store");
    const list = artifactListEnvelopeSchema.parse(await listed.json());
    expect(list.items.map((item) => item.id)).toEqual([body.artifact.id]);

    const detailResponse = await ownerFetch(`${baseUrl}/api/v1/artifacts/${body.artifact.id}`);
    expect(detailResponse.status).toBe(200);
    expect(artifactEnvelopeSchema.parse(await detailResponse.json()).artifact).toEqual(body.artifact);

    const content = await ownerFetch(`${baseUrl}/api/v1/artifacts/${body.artifact.id}/content`);
    expect(content.status).toBe(200);
    expect(Buffer.from(await content.arrayBuffer())).toEqual(Buffer.from(bytes));
    expectHtmlHeaders(content.headers);

    const grantedUrl = new URL(body.artifact.contentUrl);
    const granted = await globalThis.fetch(new URL(`${grantedUrl.pathname}${grantedUrl.search}`, baseUrl));
    expect(granted.status).toBe(200);
    expect(Buffer.from(await granted.arrayBuffer())).toEqual(Buffer.from(bytes));
  });

  it("preserves fixture bytes for an htm upload under a html object key", async () => {
    const bytes = new Uint8Array(await readFile(fixturePath));
    const response = await postFile(baseUrl, "hello.htm", bytes);
    expect(response.status).toBe(201);
    const artifact = artifactEnvelopeSchema.parse(await response.json()).artifact;
    expect([...store.objects.keys()]).toEqual([`${artifact.id}.html`]);
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
    expectGrantedContentUrl(body.artifact.contentUrl, artifact.id);
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
    expect(store.objects.get(`${accepted.id}.html`)?.byteLength).toBe(MAX_HTML_BYTES);
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
    store.objects.delete(`${artifact.id}.html`);
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
    expect(store.objects.get(`${artifact.id}.html`)).toEqual(bytes);
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
    expect(headerKey.status).toBe(200);

    const fallback = await globalThis.fetch(`${baseUrl}/api/v1/context`, {
      headers: { authorization: "Bearer not-a-real-key", cookie: owner.cookie },
    });
    expect(fallback.status).toBe(401);
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

function ownerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (ownerApiKey && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${ownerApiKey}`);
  }
  return globalThis.fetch(input, { ...init, headers });
}

function expectGrantedContentUrl(value: string, id: string): void {
  const url = new URL(value);
  expect(`${url.origin}${url.pathname}`).toBe(`http://localhost:3001/api/v1/artifacts/${id}/content`);
  expect(url.searchParams.get("access")?.length).toBeGreaterThan(10);
  expect(url.searchParams.has("format")).toBe(false);
}
