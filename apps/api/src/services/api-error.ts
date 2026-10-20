export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "ORGANIZATION_REQUIRED"
  | "FILE_TOO_LARGE"
  | "CONTENT_TOO_LARGE"
  | "CONTENT_TOO_COMPLEX"
  | "UNSUPPORTED_FILE_TYPE"
  | "ARTIFACT_NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "STORAGE_UNAVAILABLE"
  | "CONVERSION_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiErrorException extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = "ApiErrorException";
    this.status = status;
    this.code = code;
  }
}
