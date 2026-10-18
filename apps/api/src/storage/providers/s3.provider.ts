import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  BlobNotFoundError,
  BlobStoreUnavailableError,
  type BlobGetResult,
  type BlobPutInput,
  type BlobStore,
} from "../blob-store.js";

export type S3StorageCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type S3StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: S3StorageCredentials;
};

export function readS3StorageConfig(env: NodeJS.ProcessEnv = process.env): S3StorageConfig {
  const bucket = requiredSetting(env, "S3_BUCKET");
  const region = requiredSetting(env, "S3_REGION");
  const endpoint = readEndpoint(env);
  const credentials = readCredentials(env);
  return {
    bucket,
    region,
    forcePathStyle: readForcePathStyle(env, endpoint !== undefined),
    ...(endpoint ? { endpoint } : {}),
    ...(credentials ? { credentials } : {}),
  };
}

export function createS3Client(config: S3StorageConfig): S3Client {
  const endpoint = config.endpoint;
  return new S3Client({
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? Boolean(endpoint),
    // Ambient AWS endpoint variables stay ignored. S3_ENDPOINT is the only custom endpoint.
    ignoreConfiguredEndpointUrls: true,
    ...(endpoint ? { endpoint } : {}),
    requestHandler: {
      connectionTimeout: 10_000,
      requestTimeout: 60_000,
      throwOnRequestTimeout: true,
    },
    ...(config.credentials ? { credentials: config.credentials } : {}),
  });
}

export function toBlobStoreError(
  error: unknown,
  objectKey: string,
): BlobNotFoundError | BlobStoreUnavailableError {
  if (error instanceof BlobNotFoundError || error instanceof BlobStoreUnavailableError) {
    return error;
  }
  if (isMissingObjectError(error)) {
    return new BlobNotFoundError(objectKey);
  }
  return unavailable(error);
}

@Injectable()
export class S3BlobStore implements BlobStore, OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket: string;
  private closed = false;

  constructor(config: S3StorageConfig = readS3StorageConfig()) {
    this.bucket = config.bucket;
    this.client = createS3Client(config);
  }

  async put(input: BlobPutInput): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.objectKey,
          Body: Uint8Array.from(input.body),
          ContentType: input.contentType,
        }),
      );
    } catch (error) {
      throw unavailable(error);
    }
  }

  async get(objectKey: string): Promise<BlobGetResult> {
    let output: GetObjectCommandOutput;
    try {
      output = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
    } catch (error) {
      throw toBlobStoreError(error, objectKey);
    }

    if (!isAsyncIterable(output.Body)) {
      throw new BlobStoreUnavailableError("Object storage returned an unreadable body");
    }

    return { body: encodeChunks(output.Body, objectKey) };
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
    } catch (error) {
      if (isMissingObjectError(error)) {
        return;
      }
      throw unavailable(error);
    }
  }

  onModuleDestroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.client.destroy();
  }
}

function requiredSetting(env: NodeJS.ProcessEnv, name: "S3_BUCKET" | "S3_REGION"): string {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) {
    throw new BlobStoreUnavailableError(`${name} must be set`);
  }
  return value;
}

function readEndpoint(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.S3_ENDPOINT?.trim() ?? "";
  if (raw.length === 0) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlobStoreUnavailableError("S3_ENDPOINT must be an http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlobStoreUnavailableError("S3_ENDPOINT must be an http(s) URL");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new BlobStoreUnavailableError("S3_ENDPOINT must not include credentials");
  }
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new BlobStoreUnavailableError("S3_ENDPOINT must be an origin without a path, query, or hash");
  }
  return url.origin;
}

function readForcePathStyle(env: NodeJS.ProcessEnv, endpointSet: boolean): boolean {
  const raw = env.S3_FORCE_PATH_STYLE?.trim() ?? "";
  if (raw.length === 0) {
    return endpointSet;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new BlobStoreUnavailableError("S3_FORCE_PATH_STYLE must be true or false");
}

function readCredentials(env: NodeJS.ProcessEnv): S3StorageCredentials | undefined {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim() ?? "";
  const sessionToken = env.AWS_SESSION_TOKEN?.trim() ?? "";
  const hasAccessKey = accessKeyId.length > 0;
  const hasSecret = secretAccessKey.length > 0;

  if (hasAccessKey !== hasSecret) {
    throw new BlobStoreUnavailableError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set");
  }
  if (!hasAccessKey) {
    return undefined;
  }

  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken.length > 0 ? { sessionToken } : {}),
  };
}

function unavailable(error: unknown): BlobStoreUnavailableError {
  if (error instanceof BlobStoreUnavailableError) {
    return error;
  }
  return new BlobStoreUnavailableError("Object storage is unavailable", { cause: error });
}

function isMissingObjectError(error: unknown): boolean {
  if (storageErrorCode(error) !== "NoSuchKey") {
    return false;
  }
  const status = httpStatus(error);
  return status === undefined || status === 404;
}

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error)) {
    return undefined;
  }
  const metadata = error.$metadata;
  if (typeof metadata !== "object" || metadata === null || !("httpStatusCode" in metadata)) {
    return undefined;
  }
  return typeof metadata.httpStatusCode === "number" ? metadata.httpStatusCode : undefined;
}

function storageErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as { name?: unknown; Code?: unknown };
  if (typeof record.Code === "string" && record.Code.length > 0) {
    return record.Code;
  }
  if (typeof record.name === "string" && record.name.length > 0 && record.name !== "Error") {
    return record.name;
  }
  return undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | string> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

async function* encodeChunks(
  body: AsyncIterable<Uint8Array | string>,
  objectKey: string,
): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of body) {
      yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk);
    }
  } catch (error) {
    throw toBlobStoreError(error, objectKey);
  }
}
