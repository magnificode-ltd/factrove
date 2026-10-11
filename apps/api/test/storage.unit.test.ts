import { GetObjectCommand } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import {
  BLOB_STORE,
  BlobNotFoundError,
  BlobStoreUnavailableError,
  S3BlobStore,
  StorageModule,
} from "../src/storage/index.js";
import { createS3Client, readS3StorageConfig, toBlobStoreError } from "../src/storage/providers/s3.provider.js";

const objectKey = "11111111-1111-4111-8111-111111111111.html";

describe("storage module exports", () => {
  it("exposes the blob store token, implementation, and normalized errors", () => {
    expect(BLOB_STORE.toString()).toBe("Symbol(BLOB_STORE)");
    expect(StorageModule.name).toBe("StorageModule");
    expect(S3BlobStore.name).toBe("S3BlobStore");

    const missing = new BlobNotFoundError(objectKey);
    expect(missing.code).toBe("BLOB_NOT_FOUND");
    expect(missing.objectKey).toBe(objectKey);
    expect(missing.message).toBe("Stored object was not found");

    const unavailable = new BlobStoreUnavailableError();
    expect(unavailable.code).toBe("BLOB_STORE_UNAVAILABLE");
    expect(unavailable.message).toBe("Object storage is unavailable");
  });
});

describe("S3 storage configuration", () => {
  it("requires the bucket and region", () => {
    expect(() => readS3StorageConfig({ S3_REGION: "us-east-1" })).toThrow(BlobStoreUnavailableError);
    expect(() => readS3StorageConfig({ S3_BUCKET: "factrove" })).toThrow(BlobStoreUnavailableError);
    expect(() => readS3StorageConfig({})).toThrow(/S3_BUCKET must be set/);
  });

  it("uses the bucket and region and ignores a custom endpoint", () => {
    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove-dev-uploads",
        S3_REGION: "eu-central-1",
        S3_ENDPOINT: "http://127.0.0.1:9000",
        S3_FORCE_PATH_STYLE: "true",
      }),
    ).toEqual({
      bucket: "factrove-dev-uploads",
      region: "eu-central-1",
    });
  });

  it("calls regional AWS even when AWS endpoint URL variables are set", async () => {
    const previousEndpoint = process.env.AWS_ENDPOINT_URL;
    const previousS3Endpoint = process.env.AWS_ENDPOINT_URL_S3;
    process.env.AWS_ENDPOINT_URL = "http://127.0.0.1:9000";
    process.env.AWS_ENDPOINT_URL_S3 = "http://127.0.0.1:9000";
    const client = createS3Client({
      bucket: "factrove-dev-uploads",
      region: "eu-central-1",
      credentials: { accessKeyId: "test-key", secretAccessKey: "test-secret" },
    });
    let host = "";
    client.middlewareStack.add(
      () => async (args) => {
        if (args.request && typeof args.request === "object" && "hostname" in args.request) {
          const hostname = args.request.hostname;
          if (typeof hostname === "string") {
            host = hostname;
          }
        }
        throw new Error("stop-before-send");
      },
      { step: "finalizeRequest", name: "captureHost", priority: "low" },
    );

    try {
      await client.send(new GetObjectCommand({ Bucket: "factrove-dev-uploads", Key: "x.html" }));
      expect.fail("request should stop before it is sent");
    } catch (error) {
      expect(error).toMatchObject({ message: "stop-before-send" });
    } finally {
      client.destroy();
      restoreEnv("AWS_ENDPOINT_URL", previousEndpoint);
      restoreEnv("AWS_ENDPOINT_URL_S3", previousS3Endpoint);
    }

    expect(host).toBe("factrove-dev-uploads.s3.eu-central-1.amazonaws.com");
  });

  it("accepts a static credential pair and otherwise keeps the AWS credential chain", () => {
    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove",
        S3_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "local-key",
        AWS_SECRET_ACCESS_KEY: "local-secret",
        AWS_SESSION_TOKEN: "local-token",
      }).credentials,
    ).toEqual({
      accessKeyId: "local-key",
      secretAccessKey: "local-secret",
      sessionToken: "local-token",
    });

    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove",
        S3_REGION: "us-east-1",
        AWS_PROFILE: "factrove-test",
      }).credentials,
    ).toBeUndefined();
  });

  it("rejects a partial credential pair without echoing the secret", () => {
    const secret = "partial-secret-value";
    expectUnavailable(
      () =>
        readS3StorageConfig({
          S3_BUCKET: "factrove",
          S3_REGION: "us-east-1",
          AWS_SECRET_ACCESS_KEY: secret,
        }),
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set",
      secret,
    );
  });
});

describe("S3 error normalization", () => {
  it("maps a missing object and hides bucket and endpoint details on other failures", () => {
    const missing = toBlobStoreError({ name: "NoSuchKey", message: "bucket secret-bucket" }, objectKey);
    expect(missing).toBeInstanceOf(BlobNotFoundError);
    expect(missing).toMatchObject({
      code: "BLOB_NOT_FOUND",
      objectKey,
      message: "Stored object was not found",
    });
    expect(missing.message).not.toContain("secret-bucket");

    const notFound = toBlobStoreError({ name: "NotFound", $metadata: { httpStatusCode: 404 } }, objectKey);
    expect(notFound).toBeInstanceOf(BlobStoreUnavailableError);

    const cause = {
      name: "InvalidAccessKeyId",
      message: "endpoint http://127.0.0.1:9000 bucket secret-bucket key invalid-secret",
    };
    const unavailable = toBlobStoreError(cause, objectKey);
    expect(unavailable).toBeInstanceOf(BlobStoreUnavailableError);
    expect(unavailable).not.toBeInstanceOf(BlobNotFoundError);
    expect(unavailable).toMatchObject({
      code: "BLOB_STORE_UNAVAILABLE",
      message: "Object storage is unavailable",
      cause,
    });
    expect(unavailable.message).not.toContain("secret-bucket");
    expect(unavailable.message).not.toContain("127.0.0.1");
    expect(unavailable.message).not.toContain("invalid-secret");
  });

  it("treats bucket, credential, and network failures as unavailable", () => {
    for (const name of [
      "NoSuchBucket",
      "AccessDenied",
      "SignatureDoesNotMatch",
      "CredentialsProviderError",
      "TimeoutError",
    ]) {
      expect(toBlobStoreError({ name }, objectKey)).toBeInstanceOf(BlobStoreUnavailableError);
    }

    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" });
    const error = toBlobStoreError(refused, objectKey);
    expect(error).toBeInstanceOf(BlobStoreUnavailableError);
    expect(error.message).not.toContain("127.0.0.1");
  });
});

function restoreEnv(name: "AWS_ENDPOINT_URL" | "AWS_ENDPOINT_URL_S3", value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function expectUnavailable(run: () => unknown, message: string, secret?: string): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BlobStoreUnavailableError);
  expect(thrown).not.toBeInstanceOf(BlobNotFoundError);
  if (!(thrown instanceof BlobStoreUnavailableError)) {
    return;
  }
  expect(thrown.message).toBe(message);
  if (secret) {
    expect(thrown.message).not.toContain(secret);
  }
}
