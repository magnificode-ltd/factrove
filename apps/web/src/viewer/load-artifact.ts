import { FactroveApiError, type FactroveClient } from "@factrove/api-client";
import type { ArtifactDto, ContextEnvelope, ShareState } from "@factrove/contracts";
import { unavailableMessage } from "@/api/errors";
import { artifactReturnPath } from "@/auth/return-path";

export type ViewerModel =
  | {
      status: "ready";
      artifact: ArtifactDto;
      share?: ShareState | null;
      organization?: ContextEnvelope["organization"];
      owner?: boolean;
    }
  | { status: "missing"; message: string }
  | { status: "signed-out"; message: string; returnTo: string }
  | { status: "unavailable"; message: string };

export async function loadArtifact(client: FactroveClient, id: string): Promise<ViewerModel> {
  const returnTo = artifactReturnPath(id);
  const [contextResult, artifactResult] = await Promise.allSettled([client.getContext(), client.getArtifact(id)]);

  if (artifactResult.status === "fulfilled") {
    const artifact = artifactResult.value.artifact;
    const context = contextResult.status === "fulfilled" ? contextResult.value : null;
    const owner = context !== null && context.user.id === artifact.creatorUserId;
    const organization = context?.organization ?? null;
    if (!owner) {
      return { status: "ready", artifact, share: null, organization, owner: false };
    }
    try {
      const share = await client.getArtifactShare(artifact.id);
      return { status: "ready", artifact, share: share.share, organization, owner: true };
    } catch {
      return { status: "ready", artifact, share: null, organization, owner: true };
    }
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
