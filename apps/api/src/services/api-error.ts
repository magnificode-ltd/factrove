import type { ApiErrorCode } from "@factrove/contracts";

export type { ApiErrorCode };

export class ApiErrorException extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: ApiErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiErrorException";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
