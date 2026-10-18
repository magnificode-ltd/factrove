import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";

export type ViewerModel =
  | { status: "ready"; artifact: ArtifactDto }
  | { status: "missing"; message: string }
  | { status: "signed-out"; message: string }
  | { status: "unavailable"; message: string };

export async function loadArtifact(client: FactroveClient, id: string): Promise<ViewerModel> {
  try {
    const { artifact } = await client.getArtifact(id);
    return { status: "ready", artifact };
  } catch (error) {
    if (error instanceof FactroveApiError && error.status === 404) {
      const message = error.message.trim() || "This artifact does not exist.";
      return { status: "missing", message };
    }
    if (error instanceof FactroveApiError && error.status === 401) {
      return { status: "signed-out", message: "Sign in to continue." };
    }
    return { status: "unavailable", message: unavailableMessage(error) };
  }
}
