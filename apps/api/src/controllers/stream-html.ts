import { Readable } from "node:stream";
import { StreamableFile } from "@nestjs/common";
import { ApiErrorException, type ApiErrorCode } from "../services/api-error.js";
import { BlobNotFoundError, BlobStoreUnavailableError } from "../storage/index.js";

export function streamHtml(body: AsyncIterable<Uint8Array>): StreamableFile {
  const file = new StreamableFile(Readable.from(body));
  file.setErrorHandler((error, response) => {
    if (response.headersSent) {
      if (!response.destroyed && "destroy" in response && typeof response.destroy === "function") {
        response.destroy();
      }
      return;
    }
    if (response.destroyed) {
      return;
    }
    const mapped = contentFailure(error);
    response.statusCode = mapped.status;
    if ("setHeader" in response && typeof response.setHeader === "function") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("X-Content-Type-Options", "nosniff");
    }
    response.send(JSON.stringify({ error: { code: mapped.code, message: mapped.message } }));
  });
  return file;
}

function contentFailure(error: unknown): { status: number; code: ApiErrorCode; message: string } {
  if (error instanceof ApiErrorException) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof BlobNotFoundError) {
    return { status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." };
  }
  if (error instanceof BlobStoreUnavailableError) {
    return { status: 503, code: "STORAGE_UNAVAILABLE", message: "Object storage is unavailable." };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
}
