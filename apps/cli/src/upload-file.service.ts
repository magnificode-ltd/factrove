import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { Injectable } from "@nestjs/common";
import { CliError } from "./cli-error.js";

// 10 MiB. Matches the shared contract; the API remains authoritative.
export const MAX_HTML_BYTES = 10_485_760;

const HTML_EXTENSION = /\.(html|htm)$/i;

export type UploadFile = {
  filename: string;
  bytes: Uint8Array;
};

@Injectable()
export class UploadFileService {
  read(filePath: string): Promise<UploadFile> {
    return readUploadFile(filePath);
  }
}

export async function readUploadFile(filePath: string): Promise<UploadFile> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(filePath);
  } catch (error) {
    throw mapFsError(error, filePath);
  }

  if (info.isDirectory()) {
    throw new CliError("INVALID_INPUT", `Path is a directory: ${filePath}`);
  }
  if (!info.isFile()) {
    throw new CliError("INVALID_INPUT", `Path is not a regular file: ${filePath}`);
  }

  const filename = basename(filePath);
  if (!HTML_EXTENSION.test(filename)) {
    throw new CliError("INVALID_INPUT", "Only .html and .htm files are supported.");
  }
  if (info.size === 0) {
    throw new CliError("INVALID_INPUT", "The HTML file is empty.");
  }
  if (info.size > MAX_HTML_BYTES) {
    throw new CliError("INVALID_INPUT", "The file exceeds the 10 MiB limit.");
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw mapFsError(error, filePath);
  }

  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(buffer);
  const bytes = new Uint8Array(copy);
  if (bytes.byteLength === 0) {
    throw new CliError("INVALID_INPUT", "The HTML file is empty.");
  }
  if (bytes.byteLength > MAX_HTML_BYTES) {
    throw new CliError("INVALID_INPUT", "The file exceeds the 10 MiB limit.");
  }
  return { filename, bytes };
}

function mapFsError(error: unknown, filePath: string): CliError {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new CliError("FILE_NOT_FOUND", `No such file: ${filePath}`);
  }
  return new CliError("INVALID_INPUT", `Cannot read file: ${filePath}`);
}
