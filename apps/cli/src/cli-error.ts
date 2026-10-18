import { FactroveApiError } from "@factrove/api-client";

export type LocalCliCode = "FILE_NOT_FOUND" | "INVALID_INPUT" | "NETWORK_ERROR";

export class CliError extends Error {
  readonly code: string;

  constructor(code: LocalCliCode, message: string) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}

export function formatFailure(error: unknown, json: boolean): string {
  const payload = failurePayload(error);
  if (json) {
    return `${JSON.stringify({ error: { code: payload.code, message: payload.message } })}\n`;
  }
  return `${payload.code}: ${payload.message}\n`;
}

function failurePayload(error: unknown): { code: string; message: string } {
  if (error instanceof CliError || error instanceof FactroveApiError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return { code: "INTERNAL_ERROR", message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: "The upload failed." };
}
