import { Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import { redactSecrets } from "../mail/redact-secret.js";
import { logWithoutThrowing } from "../mail/safe-log.js";

// Cloudflare Siteverify. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_TIMEOUT_MS = 5_000;

// Siteverify rejects tokens longer than this. A longer value is not sent.
const TURNSTILE_MAX_TOKEN_LENGTH = 2048;

export const CAPTCHA_FAILED = "CAPTCHA_FAILED";
export const CAPTCHA_UNAVAILABLE = "CAPTCHA_UNAVAILABLE";

export const CAPTCHA_FAILED_MESSAGE = "Complete the check and try again.";
export const CAPTCHA_UNAVAILABLE_MESSAGE = "The signup check could not be completed. Try again.";

const CAPTCHA_RETRY_AFTER_SECONDS = "1";

export type TurnstileVerdict = "pass" | "fail" | "unavailable";

export type VerifyTurnstileInput = {
  secret: string;
  token: string | null;
  remoteIp: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

// Blank means the check is off. Callers skip Siteverify entirely in that case.
export function readTurnstileSecret(value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  return secret.length > 0 ? secret : null;
}

export function readTurnstileToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("turnstileToken" in body)) {
    return null;
  }
  const value = body.turnstileToken;
  return typeof value === "string" ? value : null;
}

export async function verifyTurnstileToken(input: VerifyTurnstileInput): Promise<TurnstileVerdict> {
  const token = input.token?.trim() ?? "";
  if (token.length === 0) {
    logTurnstile("warn", "Signup check rejected a missing token.", input.secret);
    return "fail";
  }
  if (token.length > TURNSTILE_MAX_TOKEN_LENGTH) {
    logTurnstile("warn", "Signup check rejected a token that is too long.", input.secret);
    return "fail";
  }
  const params = new URLSearchParams({ secret: input.secret, response: token });
  if (input.remoteIp) {
    params.set("remoteip", input.remoteIp);
  }
  const timeoutMs = input.timeoutMs ?? TURNSTILE_TIMEOUT_MS;
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error: unknown) {
    logTurnstile("error", siteverifyFailure(error, input.secret), input.secret);
    return "unavailable";
  }
  if (!response.ok) {
    logTurnstile("error", `Signup check failed. Siteverify returned HTTP ${response.status}.`, input.secret);
    return "unavailable";
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error: unknown) {
    logTurnstile("error", siteverifyFailure(error, input.secret), input.secret);
    return "unavailable";
  }
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    logTurnstile("error", "Signup check failed. Siteverify returned an unexpected body.", input.secret);
    return "unavailable";
  }
  if (payload.success) {
    return "pass";
  }
  const codes = siteverifyErrorCodes(payload);
  if (codes.includes("internal-error")) {
    logTurnstile("error", "Signup check failed. Siteverify reported internal-error.", input.secret);
    return "unavailable";
  }
  const detail = codes.length > 0 ? codes.join(", ") : "unspecified";
  logTurnstile("warn", `Signup check rejected the token (${detail}).`, input.secret);
  return "fail";
}

export async function enforceSignupTurnstile(input: {
  secret: string | null;
  body: unknown;
  remoteIp: string | null;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!input.secret) {
    return;
  }
  const verdict = await verifyTurnstileToken({
    secret: input.secret,
    token: readTurnstileToken(input.body),
    remoteIp: input.remoteIp,
    fetchImpl: input.fetchImpl,
  });
  if (verdict === "pass") {
    return;
  }
  if (verdict === "unavailable") {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message: CAPTCHA_UNAVAILABLE_MESSAGE,
      code: CAPTCHA_UNAVAILABLE,
    }, { "retry-after": CAPTCHA_RETRY_AFTER_SECONDS });
  }
  throw new APIError("BAD_REQUEST", {
    message: CAPTCHA_FAILED_MESSAGE,
    code: CAPTCHA_FAILED,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function siteverifyErrorCodes(payload: Record<string, unknown>): string[] {
  const codes = payload["error-codes"];
  if (!Array.isArray(codes)) {
    return [];
  }
  return codes.filter((code): code is string => (
    typeof code === "string" && /^[a-z0-9-]{1,64}$/i.test(code)
  ));
}

function siteverifyFailure(error: unknown, secret: string): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "Signup check timed out.";
  }
  const detail = error instanceof Error ? error.message : "request failed";
  return `Signup check failed. ${redactSecrets(detail, [secret])}`;
}

function logTurnstile(level: "warn" | "error", message: string, secret: string): void {
  const line = redactSecrets(message, [secret]);
  logWithoutThrowing((text) => {
    const logger = new Logger("Auth");
    if (level === "error") {
      logger.error(text);
      return;
    }
    logger.warn(text);
  }, line);
}
