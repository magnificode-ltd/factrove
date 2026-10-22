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
// A rejected upload is discarded, not stored. The deadline starts when the
// parse error is known and destroys the socket whether or not the body or
// this response ever finishes. Inside that window a progressing reader still
// gets a FIN queued after this response, instead of a reset at 64 KiB.
export const REJECT_DEADLINE_MS = 6_000;

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
  const connected = request.socket as ServerSocket | null;
  if (!connected || connected.destroyed) {
    return;
  }
  const socket: ServerSocket = connected;

  const onError = (): void => {};
  request.on("error", onError);
  socket.on("error", onError);

  let settled = false;
  let destroying = false;
  let graceful = false;
  let peerEnded = socket.readableEnded;
  // One deadline for every rejected connection. It does not wait for the body
  // to end or for this response to finish, so a half-open client and a client
  // that never reads an earlier pipelined response are both released.
  const deadline = setTimeout(() => {
    destroySocket();
  }, REJECT_DEADLINE_MS);
  deadline.unref();

  const onData = (): void => {
    // Drop the chunk. Reading it keeps a client that is still sending from
    // blocking, without retaining the rejected body.
  };
  const onPeerEnd = (): void => {
    peerEnded = true;
    if (graceful) {
      destroySocket();
    }
  };
  const onSocketClose = (): void => {
    settle();
  };

  request.on("data", onData);
  socket.on("end", onPeerEnd);
  socket.on("close", onSocketClose);
  if (response && !response.writableEnded) {
    response.once("finish", beginGraceful);
    response.once("close", beginGraceful);
  } else {
    beginGraceful();
  }
  // Node calls destroySoon from the response 'finish' handler, after any
  // earlier response on this connection has been handed to the socket.
  // Connection: close makes that call the socket's normal final destruction.
  // Replacing it here keeps the FIN behind bytes a progressing reader still
  // has to pull. The deadline, or the peer ending after that FIN, destroys.
  socket.destroySoon = () => {
    beginGraceful();
  };

  function beginGraceful(): void {
    if (settled || graceful || socket.destroyed) {
      return;
    }
    graceful = true;
    if (socket.writable && !socket.writableEnded) {
      socket.end();
    }
    if (!request.readableEnded) {
      request.resume();
    }
    if (peerEnded) {
      destroySocket();
    }
  }

  function settle(): void {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(deadline);
    request.removeListener("error", onError);
    request.removeListener("data", onData);
    socket.removeListener("error", onError);
    socket.removeListener("end", onPeerEnd);
    socket.removeListener("close", onSocketClose);
    response?.removeListener("finish", beginGraceful);
    response?.removeListener("close", beginGraceful);
  }

  function destroySocket(): void {
    if (settled || destroying) {
      return;
    }
    destroying = true;
    if (!socket.destroyed) {
      socket.destroy();
      return;
    }
    settle();
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
