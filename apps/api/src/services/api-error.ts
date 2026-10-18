export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "ORGANIZATION_REQUIRED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "ARTIFACT_NOT_FOUND"
  | "STORAGE_UNAVAILABLE"
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
