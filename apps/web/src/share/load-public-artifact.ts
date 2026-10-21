import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { PublicArtifact } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";

export type PublicShareModel =
  | { status: "ready"; artifact: PublicArtifact }
  | { status: "missing"; message: string }
  | { status: "unavailable"; message: string };

export async function loadPublicArtifact(client: FactroveClient, id: string, token: string): Promise<PublicShareModel> {
  try {
    const envelope = await client.getPublicArtifact(id, token);
    return { status: "ready", artifact: envelope.artifact };
  } catch (error) {
    if (error instanceof FactroveApiError && (error.status === 404 || error.status === 400)) {
      return { status: "missing", message: "This artifact does not exist." };
    }
    if (error instanceof FactroveApiError && error.status === 429) {
      return { status: "unavailable", message: "Too many requests. Try again later." };
    }
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}
