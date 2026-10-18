import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";
import { artifactReturnPath } from "@/auth/return-path";

export type ViewerModel =
  | { status: "ready"; artifact: ArtifactDto }
  | { status: "missing"; message: string }
  | { status: "signed-out"; message: string; returnTo: string }
  | { status: "unavailable"; message: string };

export async function loadArtifact(client: FactroveClient, id: string): Promise<ViewerModel> {
  const returnTo = artifactReturnPath(id);
  const [contextResult, artifactResult] = await Promise.allSettled([client.getContext(), client.getArtifact(id)]);

  if (artifactResult.status === "fulfilled") {
    return { status: "ready", artifact: artifactResult.value.artifact };
  }
  if (isUnauthenticated(contextResult) || isUnauthenticated(artifactResult)) {
    return { status: "signed-out", message: "Sign in to continue.", returnTo };
  }
  if (contextResult.status === "rejected") {
    return { status: "unavailable", message: unavailableMessage(contextResult.reason) };
  }
  if (artifactResult.reason instanceof FactroveApiError && artifactResult.reason.status === 404) {
    const message = artifactResult.reason.message.trim() || "This artifact does not exist.";
    return { status: "missing", message };
  }
  return { status: "unavailable", message: unavailableMessage(artifactResult.reason) };
}

function isUnauthenticated(result: PromiseSettledResult<unknown>): boolean {
  return result.status === "rejected" && result.reason instanceof FactroveApiError && result.reason.status === 401;
}
