import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlobNotFoundError, BlobStoreUnavailableError, S3BlobStore } from "../src/storage/index.js";
import { createS3Client, type S3StorageConfig } from "../src/storage/providers/s3.provider.js";
import { useLocalGarage } from "./local-garage.js";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const fixturePath = fileURLToPath(new URL("../../../fixtures/hello.html", import.meta.url));

try {
  loadEnvFile(envPath);
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code !== "ENOENT") {
    throw error;
  }
}

const enabled = process.env.S3_INTEGRATION === "1";

describe.skipIf(!enabled)("S3 blob store against local Garage", () => {
  let store: S3BlobStore;
  let config: S3StorageConfig;
  let headClient: ReturnType<typeof createS3Client>;
  const keys: string[] = [];

  beforeAll(() => {
    config = useLocalGarage();
    store = new S3BlobStore(config);
    headClient = createS3Client(config);
  });

  afterAll(async () => {
    if (store) {
      for (const key of keys) {
        await store.delete(key);
      }
      store.onModuleDestroy();
    }
    headClient?.destroy();
  });

  it("puts a flat fixture key, reads the same bytes and content type, then deletes it repeatedly", async () => {
    const objectKey = flatHtmlKey();
    keys.push(objectKey);
    const body = new Uint8Array(await readFile(fixturePath));
    const contentType = "text/html; charset=utf-8";

    await store.put({ objectKey, body, contentType });

    const stored = await store.get(objectKey);
    expect(Object.keys(stored)).toEqual(["body"]);
    expect(Buffer.compare(Buffer.from(await readAll(stored.body)), Buffer.from(body))).toBe(0);
    expect(clientFacing(stored)).not.toContain(config.bucket);

    const head = await headClient.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
      }),
    );
    expect(head.ContentType).toBe(contentType);

    await store.delete(objectKey);
    await expectMissing(store, objectKey, config);
    await expect(store.delete(objectKey)).resolves.toBeUndefined();
    await expectMissing(store, objectKey, config);
  });

  it("preserves bytes that are not plain text", async () => {
    const objectKey = flatHtmlKey();
    keys.push(objectKey);
    const body = Uint8Array.from([0x3c, 0x00, 0xff, 0xc3, 0xa9, 0x3e]);

    await store.put({ objectKey, body, contentType: "text/html" });
    const stored = await store.get(objectKey);
    expect(Buffer.compare(Buffer.from(await readAll(stored.body)), Buffer.from(body))).toBe(0);
  });

  it("reports bad credentials as unavailable rather than a missing object", async () => {
    const bad = new S3BlobStore({
      ...config,
      credentials: {
        accessKeyId: "invalid-access-key",
        secretAccessKey: "invalid-secret-key",
      },
    });

    try {
      const error = await rejectedPut(bad, flatHtmlKey());
      expect(error).toBeInstanceOf(BlobStoreUnavailableError);
      expect(error).not.toBeInstanceOf(BlobNotFoundError);
      const text = clientFacing(error);
      expect(text).not.toContain(config.bucket);
      expect(text).not.toContain("invalid-secret-key");
    } finally {
      bad.onModuleDestroy();
    }
  });
});

function flatHtmlKey(): string {
  const objectKey = `${randomUUID()}.html`;
  expect(objectKey).not.toContain("/");
  return objectKey;
}

async function readAll(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function rejectedPut(store: S3BlobStore, objectKey: string): Promise<unknown> {
  try {
    await store.put({
      objectKey,
      body: Uint8Array.from([0x3c, 0x70, 0x3e]),
      contentType: "text/html",
    });
  } catch (error) {
    return error;
  }
  throw new Error("Expected object storage to reject the request");
}

async function expectMissing(store: S3BlobStore, objectKey: string, config: S3StorageConfig): Promise<void> {
  let thrown: unknown;
  try {
    await store.get(objectKey);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BlobNotFoundError);
  const text = clientFacing(thrown);
  expect(text).not.toContain(config.bucket);
}

function clientFacing(value: unknown): string {
  if (value instanceof BlobNotFoundError) {
    return [value.name, value.code, value.message, value.objectKey].join(" ");
  }
  if (value instanceof BlobStoreUnavailableError) {
    return [value.name, value.code, value.message].join(" ");
  }
  if (value && typeof value === "object" && "body" in value) {
    return Object.keys(value).join(" ");
  }
  return value instanceof Error ? `${value.name} ${value.message}` : String(value);
}
