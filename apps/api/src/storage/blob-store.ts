export const BLOB_STORE = Symbol("BLOB_STORE");

export type BlobPutInput = {
  objectKey: string;
  body: Uint8Array;
  contentType: string;
};

export type BlobGetResult = {
  body: AsyncIterable<Uint8Array>;
};

export interface BlobStore {
  put(input: BlobPutInput): Promise<void>;
  get(objectKey: string): Promise<BlobGetResult>;
  delete(objectKey: string): Promise<void>;
}

export class BlobNotFoundError extends Error {
  override readonly name = "BlobNotFoundError";
  readonly code = "BLOB_NOT_FOUND" as const;
  readonly objectKey: string;

  constructor(objectKey: string) {
    super("Stored object was not found");
    this.objectKey = objectKey;
  }
}

export class BlobStoreUnavailableError extends Error {
  override readonly name = "BlobStoreUnavailableError";
  readonly code = "BLOB_STORE_UNAVAILABLE" as const;

  constructor(message = "Object storage is unavailable", options?: { cause?: unknown }) {
    super(message, options);
  }
}
