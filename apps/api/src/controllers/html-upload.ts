import type { IncomingMessage } from "node:http";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import Busboy from "busboy";
import { MAX_HTML_BYTES } from "../rendering/html-policy.js";

type UploadRequest = IncomingMessage & {
  body?: unknown;
  file?: unknown;
};

type ParsedFile = {
  originalname: string;
  buffer: Buffer;
};

// Busboy stops once a file or the part count reaches these limits, so the
// values passed in are one past the largest upload that is still accepted.
const FILE_SIZE_LIMIT = MAX_HTML_BYTES + 1;
const PARTS_LIMIT = 13;
const FIELD_COUNT_LIMIT = 8;
const FIELD_SIZE_LIMIT = 1024;
const FILE_COUNT_LIMIT = 2;

// Busboy decodes a plain filename as UTF-8 and filename* per RFC 5987.
// That string is the filename. A later %xx pass would turn a literal %22, %0A,
// or %0D into a quote or a control character.
export function parseHtmlUpload(request: UploadRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: {
          fileSize: FILE_SIZE_LIMIT,
          files: FILE_COUNT_LIMIT,
          fields: FIELD_COUNT_LIMIT,
          fieldSize: FIELD_SIZE_LIMIT,
          parts: PARTS_LIMIT,
        },
      });
    } catch (error) {
      reject(multipartFailure(error));
      return;
    }

    const fields: Record<string, unknown> = Object.create(null);
    let file: ParsedFile | undefined;
    let acceptedFiles = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      request.unpipe(parser);
      parser.removeAllListeners();
      parser.on("error", () => {});
      let reported = false;
      const report = (): void => {
        if (reported) {
          return;
        }
        reported = true;
        reject(error);
      };
      if (request.readableEnded || request.destroyed) {
        report();
        return;
      }
      request.resume();
      request.once("end", report);
      request.once("close", report);
      request.once("error", report);
    };

    parser.on("field", (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated) {
        fail(new BadRequestException(info.nameTruncated ? "Field name too long" : "Field value too long"));
        return;
      }
      const current = fields[name];
      if (typeof current === "string") {
        fields[name] = [current, value];
      } else if (Array.isArray(current)) {
        current.push(value);
      } else {
        fields[name] = value;
      }
    });

    parser.on("file", (name, stream, info) => {
      acceptedFiles += 1;
      if (name !== "file" || acceptedFiles > 1 || info.filename.length === 0) {
        stream.on("error", () => {});
        stream.resume();
        fail(new BadRequestException("Unexpected field"));
        return;
      }
      const chunks: Buffer[] = [];
      let truncated = false;
      stream.on("limit", () => {
        truncated = true;
        fail(new PayloadTooLargeException("File too large"));
      });
      stream.on("data", (chunk: Buffer) => {
        if (!truncated) {
          chunks.push(chunk);
        }
      });
      stream.on("error", (error: Error) => {
        fail(multipartFailure(error));
      });
      stream.on("end", () => {
        if (truncated || settled) {
          return;
        }
        file = { originalname: info.filename, buffer: Buffer.concat(chunks) };
      });
    });

    parser.on("filesLimit", () => {
      fail(new BadRequestException("Unexpected field"));
    });
    parser.on("partsLimit", () => {
      fail(new BadRequestException("Unexpected field"));
    });
    parser.on("fieldsLimit", () => {
      fail(new BadRequestException("Too many fields"));
    });
    parser.on("error", (error) => {
      fail(multipartFailure(error));
    });
    parser.on("close", () => {
      if (settled) {
        return;
      }
      settled = true;
      request.body = fields;
      request.file = file;
      resolve();
    });

    request.pipe(parser);
  });
}

function multipartFailure(error: unknown): Error {
  if (!(error instanceof Error)) {
    return new BadRequestException("The request is invalid.");
  }
  if (
    error.message.startsWith("Multipart:")
    || error.message === "Malformed part header"
    || error.message === "Unexpected end of form"
    || error.message === "Unexpected end of file"
  ) {
    const message = error.message.startsWith("Multipart:") ? error.message : `Multipart: ${error.message}`;
    return new BadRequestException(message);
  }
  return new BadRequestException(error.message);
}
