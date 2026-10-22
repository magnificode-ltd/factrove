import type { IncomingMessage, ServerResponse } from "node:http";
import type { Readable } from "node:stream";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import Busboy from "busboy";
import { MAX_HTML_BYTES } from "../rendering/html-policy.js";

type UploadRequest = IncomingMessage & {
  body?: unknown;
  file?: unknown;
  res?: ServerResponse;
};

type ServerSocket = NonNullable<IncomingMessage["socket"]> & {
  destroySoon?: () => void;
};

type ParsedFile = {
  originalname: string;
  buffer: Buffer;
};

// Busboy stops once a file or the part count reaches these limits. fileSize is
// one past the largest upload that is still accepted. parts is the same ceiling
// Multer passes through: 11 ignored parts plus the file is rejected.
const FILE_SIZE_LIMIT = MAX_HTML_BYTES + 1;
const PARTS_LIMIT = 12;
const FIELD_COUNT_LIMIT = 8;
const FIELD_SIZE_LIMIT = 1024;
const FILE_COUNT_LIMIT = 2;
// A rejected upload is discarded, not stored. Destroying as soon as 64 KiB
// more arrives resets the socket, which drops this error and any earlier
// response still in the send buffer. An upload that never finishes is closed
// after this long.
const DRAIN_TIMEOUT_MS = 5000;

// Busboy decodes a plain filename as UTF-8 and filename* per RFC 5987.
// That string is the filename. A later %xx pass would turn a literal %22, %0A,
// or %0D into a quote or a control character.
export function parseHtmlUpload(request: UploadRequest): Promise<void> {
  // Multer leaves a non-multipart body unread and reports no file. The handler
  // then answers "Send exactly one file." Boundary errors still come from Busboy.
  if (!isMultipartRequest(request)) {
    return Promise.resolve();
  }

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
      releaseRequest(request);
      return;
    }

    const fields: Record<string, unknown> = Object.create(null);
    let file: ParsedFile | undefined;
    let acceptedFiles = 0;
    let openStream: Readable | undefined;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      request.unpipe(parser);
      parser.removeAllListeners();
      parser.on("error", () => {});
      openStream?.on("error", () => {});
      openStream?.resume();
      // The status is known now. Waiting for the rest of the body turns a
      // trickling client into a timeout instead of this 400.
      reject(error);
      releaseRequest(request);
    };

    parser.on("field", (name, value, info) => {
      if (settled) {
        return;
      }
      if (typeof name !== "string" || name.length === 0) {
        fail(new BadRequestException("Field name missing"));
        return;
      }
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
      // Attach this before reading info. A part with no filename emits a stream
      // whose filename is undefined, and a throw here exits the process.
      let accepted = false;
      stream.on("error", (error: Error) => {
        if (accepted) {
          fail(multipartFailure(error));
        }
      });
      openStream = stream;
      if (settled) {
        stream.resume();
        return;
      }
      if (typeof name !== "string" || name.length === 0) {
        stream.resume();
        fail(new BadRequestException("Field name missing"));
        return;
      }
      const filename = info.filename;
      if (typeof filename !== "string" || filename.length === 0) {
        stream.resume();
        fail(new BadRequestException("Unexpected field"));
        return;
      }
      acceptedFiles += 1;
      if (name !== "file" || acceptedFiles > 1) {
        stream.resume();
        fail(new BadRequestException("Unexpected field"));
        return;
      }
      accepted = true;
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
      stream.on("end", () => {
        if (truncated || settled) {
          return;
        }
        file = { originalname: filename, buffer: Buffer.concat(chunks) };
      });
    });

    parser.on("filesLimit", () => {
      fail(new BadRequestException("Unexpected field"));
    });
    parser.on("partsLimit", () => {
      fail(new BadRequestException("Too many parts"));
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

function isMultipartRequest(request: IncomingMessage): boolean {
  const length = headerText(request.headers["content-length"]);
  const transfer = headerText(request.headers["transfer-encoding"]);
  const hasBody = transfer !== undefined || (length !== undefined && !Number.isNaN(Number(length)));
  if (!hasBody) {
    return false;
  }
  const type = headerText(request.headers["content-type"]);
  if (type === undefined) {
    return false;
  }
  return type.split(";", 1)[0]?.trim().toLowerCase().startsWith("multipart/") ?? false;
}

function headerText(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

function releaseRequest(request: UploadRequest): void {
  const response = request.res;
  // Advertise close before the error headers are written. The socket stays up
  // until this response finishes, so an earlier pipelined response is not cut off.
  if (response && !response.headersSent) {
    response.setHeader("Connection", "close");
  }
  const socket = request.socket as ServerSocket | null;
  if (!socket) {
    return;
  }
  request.on("error", () => {});
  socket.on("error", () => {});

  let started = false;
  const start = (): void => {
    if (started) {
      return;
    }
    started = true;
    gracefulClose(request, socket);
  };
  // Node calls destroySoon from the response 'finish' handler, after any
  // earlier response on this connection has been handed to the socket.
  socket.destroySoon = start;
  if (response && !response.writableEnded) {
    response.once("finish", start);
    response.once("close", start);
    return;
  }
  start();
}

function gracefulClose(request: IncomingMessage, socket: ServerSocket): void {
  let requestEnded = request.readableEnded;
  let closed = false;
  // FIN is queued behind bytes the socket already accepted, so a slow reader
  // still receives an earlier response and this error. destroy() discards that
  // buffer, so it runs only when the upload itself never finishes.
  if (socket.writable && !socket.writableEnded) {
    socket.end();
  }
  const timer = setTimeout(() => {
    if (!requestEnded) {
      finishClose();
    }
  }, DRAIN_TIMEOUT_MS);
  timer.unref();

  const onData = (): void => {
    // Drop the chunk. Reading it keeps a client that is still sending from
    // blocking, without retaining the rejected body.
  };
  const onEnd = (): void => {
    requestEnded = true;
    clearTimeout(timer);
  };
  request.on("data", onData);
  request.on("end", onEnd);
  request.on("error", () => {});
  if (!request.readableEnded) {
    request.resume();
  }

  function finishClose(): void {
    if (closed) {
      return;
    }
    closed = true;
    clearTimeout(timer);
    request.removeListener("data", onData);
    request.removeListener("end", onEnd);
    if (!socket.destroyed) {
      socket.destroy();
    }
  }
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
