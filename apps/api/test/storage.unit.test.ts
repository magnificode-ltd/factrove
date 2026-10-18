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

  it("keeps regional AWS settings when S3_ENDPOINT is unset", () => {
    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove-dev-uploads",
        S3_REGION: "eu-central-1",
        AWS_ENDPOINT_URL: "http://127.0.0.1:9000",
        AWS_ENDPOINT_URL_S3: "http://127.0.0.1:9000",
      }),
    ).toEqual({
      bucket: "factrove-dev-uploads",
      region: "eu-central-1",
      forcePathStyle: false,
    });
  });

  it("reads an explicit endpoint and defaults to path-style addressing", () => {
    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove",
        S3_REGION: "us-east-1",
        S3_ENDPOINT: "http://127.0.0.1:3900/",
        AWS_ACCESS_KEY_ID: "factrove-local",
        AWS_SECRET_ACCESS_KEY: "factrove-local-secret",
      }),
    ).toEqual({
      bucket: "factrove",
      region: "us-east-1",
      endpoint: "http://127.0.0.1:3900",
      forcePathStyle: true,
      credentials: {
        accessKeyId: "factrove-local",
        secretAccessKey: "factrove-local-secret",
      },
    });

    expect(
      readS3StorageConfig({
        S3_BUCKET: "factrove",
        S3_REGION: "us-east-1",
        S3_ENDPOINT: "http://127.0.0.1:3900",
        S3_FORCE_PATH_STYLE: "false",
      }).forcePathStyle,
    ).toBe(false);
  });

  it("rejects a malformed endpoint or path-style flag without echoing it", () => {
    const secret = "super-secret-value";
    expectUnavailable(
      () =>
        readS3StorageConfig({
          S3_BUCKET: "factrove",
          S3_REGION: "us-east-1",
          S3_ENDPOINT: "not a url",
        }),
      "S3_ENDPOINT must be an http(s) URL",
      "not a url",
    );
    expectUnavailable(
      () =>
        readS3StorageConfig({
          S3_BUCKET: "factrove",
          S3_REGION: "us-east-1",
          S3_ENDPOINT: `http://user:${secret}@127.0.0.1:3900`,
        }),
      "S3_ENDPOINT must not include credentials",
      secret,
    );
    expectUnavailable(
      () =>
        readS3StorageConfig({
          S3_BUCKET: "factrove",
          S3_REGION: "us-east-1",
          S3_ENDPOINT: "http://127.0.0.1:3900/factrove",
        }),
      "S3_ENDPOINT must be an origin without a path, query, or hash",
      "/factrove",
    );
    expectUnavailable(
      () =>
        readS3StorageConfig({
          S3_BUCKET: "factrove",
          S3_REGION: "us-east-1",
          S3_FORCE_PATH_STYLE: "yes",
        }),
      "S3_FORCE_PATH_STYLE must be true or false",
      "yes",
    );
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

  it("sends path-style requests to S3_ENDPOINT and ignores ambient AWS endpoint URLs", async () => {
    const previousEndpoint = process.env.AWS_ENDPOINT_URL;
    const previousS3Endpoint = process.env.AWS_ENDPOINT_URL_S3;
    process.env.AWS_ENDPOINT_URL = "http://169.254.169.254";
    process.env.AWS_ENDPOINT_URL_S3 = "http://169.254.169.254";
    const client = createS3Client(
      readS3StorageConfig({
        S3_BUCKET: "factrove",
        S3_REGION: "us-east-1",
        S3_ENDPOINT: "http://127.0.0.1:3900",
        AWS_ACCESS_KEY_ID: "test-key",
        AWS_SECRET_ACCESS_KEY: "test-secret",
      }),
    );
    let host = "";
    let path = "";
    client.middlewareStack.add(
      () => async (args) => {
        if (args.request && typeof args.request === "object") {
          if ("hostname" in args.request && typeof args.request.hostname === "string") {
            host = args.request.hostname;
          }
          if ("path" in args.request && typeof args.request.path === "string") {
            path = args.request.path;
          }
        }
        throw new Error("stop-before-send");
      },
      { step: "finalizeRequest", name: "captureEndpoint", priority: "low" },
    );

    try {
      await client.send(new GetObjectCommand({ Bucket: "factrove", Key: "x.html" }));
      expect.fail("request should stop before it is sent");
    } catch (error) {
      expect(error).toMatchObject({ message: "stop-before-send" });
    } finally {
      client.destroy();
      restoreEnv("AWS_ENDPOINT_URL", previousEndpoint);
      restoreEnv("AWS_ENDPOINT_URL_S3", previousS3Endpoint);
    }

    expect(host).toBe("127.0.0.1");
    expect(path.startsWith("/factrove/x.html")).toBe(true);
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
