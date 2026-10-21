import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { PublicArtifact } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";

export type PublicShareModel =
  | { status: "ready"; artifact: PublicArtifact }
  | { status: "locked"; expired: boolean }
  | { status: "missing"; message: string }
  | { status: "unavailable"; message: string };

export type UnlockResult =
  | { status: "unlocked"; grant: { token: string; expiresAt: string } | null }
  | { status: "incorrect"; message: string }
  | { status: "throttled"; message: string }
  | Extract<PublicShareModel, { status: "missing" | "unavailable" }>;

export const MISSING_MESSAGE = "This artifact does not exist.";
export const INCORRECT_MESSAGE = "That password didn't work. Check it and try again.";
export const THROTTLED_MESSAGE = "Too many attempts. Wait a few minutes, then try again.";

export async function loadPublicArtifact(
  client: FactroveClient,
  id: string,
  token: string,
  grant: string | null = null
): Promise<PublicShareModel> {
  try {
    const envelope = await client.getPublicArtifact(id, token, grant ? { grant } : undefined);
    return { status: "ready", artifact: envelope.artifact };
  } catch (error) {
    if (error instanceof FactroveApiError && error.status === 401 && error.code === "PASSWORD_REQUIRED") {
      return { status: "locked", expired: grant !== null };
    }
    if (error instanceof FactroveApiError && (error.status === 404 || error.status === 400)) {
      return { status: "missing", message: MISSING_MESSAGE };
    }
    if (error instanceof FactroveApiError && error.status === 429) {
      return { status: "unavailable", message: "Too many requests. Try again later." };
    }
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}

export async function unlockPublicArtifact(
  client: FactroveClient,
  id: string,
  token: string,
  password: string
): Promise<UnlockResult> {
  try {
    const envelope = await client.unlockPublicArtifact(id, token, password);
    return { status: "unlocked", grant: envelope.grant };
  } catch (error) {
    if (error instanceof FactroveApiError && (error.status === 401 || error.status === 400)) {
      return { status: "incorrect", message: INCORRECT_MESSAGE };
    }
    if (error instanceof FactroveApiError && error.status === 429) {
      return { status: "throttled", message: THROTTLED_MESSAGE };
    }
    if (error instanceof FactroveApiError && error.status === 404) {
      return { status: "missing", message: MISSING_MESSAGE };
    }
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}
