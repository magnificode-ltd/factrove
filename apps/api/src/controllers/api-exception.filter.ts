import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ApiErrorException, type ApiErrorCode } from "../services/api-error.js";
import { isPublicApiPath } from "../sharing/public-api-path.js";
import { BlobStoreUnavailableError } from "../storage/index.js";

type ErrorBody = {
  status: number;
  code: ApiErrorCode;
  message: string;
};

type JsonResponse = {
  headersSent: boolean;
  status(code: number): JsonResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<JsonResponse>();
    if (response.headersSent) {
      return;
    }

    const request = host.switchToHttp().getRequest<{ originalUrl?: string; url?: string }>();
    const publicApi = isPublicApiPath(`${request?.originalUrl ?? request?.url ?? ""}`);
    const mapped = mapException(exception, publicApi);
    if (mapped.status >= 500 || exception instanceof BlobStoreUnavailableError) {
      this.logServerError(exception);
    }

    response.status(mapped.status);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (exception instanceof ApiErrorException && exception.retryAfterSeconds !== undefined) {
      response.setHeader("Retry-After", String(exception.retryAfterSeconds));
    }
    if (publicApi) {
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("X-Robots-Tag", "noindex");
    }
    response.json({ error: { code: mapped.code, message: mapped.message } });
  }

  private logServerError(exception: unknown): void {
    if (exception instanceof BlobStoreUnavailableError) {
      this.logger.error(exception.message);
      if (exception.cause instanceof Error) {
        this.logger.error(exception.cause.message);
      }
      return;
    }
    if (exception instanceof Error) {
      this.logger.error(exception.stack ?? exception.message);
      return;
    }
    this.logger.error("Request failed");
  }
}

function mapException(exception: unknown, publicApi: boolean): ErrorBody {
  if (exception instanceof ApiErrorException) {
    return { status: exception.status, code: exception.code, message: exception.message };
  }
  if (exception instanceof BlobStoreUnavailableError) {
    return {
      status: 503,
      code: "STORAGE_UNAVAILABLE",
      message: "Object storage is unavailable.",
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === 413) {
      return {
        status: 413,
        code: "FILE_TOO_LARGE",
        message: "The file exceeds the 10 MiB limit.",
      };
    }
    if (status === 400) {
      if (publicApi && isUriDecodeFailure(exception)) {
        return { status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." };
      }
      return { status: 400, code: "INVALID_REQUEST", message: invalidRequestMessage(exception) };
    }
    if (status === 404) {
      if (publicApi) {
        return { status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." };
      }
      return { status: 404, code: "INVALID_REQUEST", message: "Not found." };
    }
  }
    if (publicApi && isUriDecodeFailure(exception)) {
      return { status: 404, code: "ARTIFACT_NOT_FOUND", message: "Artifact was not found." };
    }
    const clientStatus = readClientStatus(exception);
    if (clientStatus === 413) {
    return {
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "The request is too large.",
    };
  }
  if (clientStatus !== undefined) {
    return { status: 400, code: "INVALID_REQUEST", message: "The request is invalid." };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred.",
  };
}

function invalidRequestMessage(exception: HttpException): string {
  const text = exceptionText(exception);
  if (text.includes("Unexpected field") || text.includes("Too many files") || text.includes("Too many parts")) {
    return "Send exactly one file.";
  }
  if (text.includes("Multipart") || text.toLowerCase().includes("boundary")) {
    return "The request must be multipart form data with one file.";
  }
  return "The request is invalid.";
}

function readClientStatus(exception: unknown): number | undefined {
  if (typeof exception !== "object" || exception === null) {
    return undefined;
  }
  const record = exception as { status?: unknown; statusCode?: unknown };
  const status = typeof record.status === "number" ? record.status : record.statusCode;
  if (typeof status !== "number" || status < 400 || status > 499) {
    return undefined;
  }
  return status;
}

function isUriDecodeFailure(exception: unknown): boolean {
  if (exception instanceof URIError) {
    return true;
  }
  const message = exception instanceof Error
    ? exception.message
    : typeof exception === "object" && exception !== null && "message" in exception && typeof exception.message === "string"
      ? exception.message
      : "";
  return /failed to decode param|uri malformed|invalid uri/i.test(message);
}

function exceptionText(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === "string") {
    return response;
  }
  if (typeof response !== "object" || response === null || !("message" in response)) {
    return exception.message;
  }
  const message = response.message;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((entry): entry is string => typeof entry === "string").join(" ");
  }
  return exception.message;
}
