import { LockKeyhole } from "lucide-react";
import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { artifactLabel, isEmbeddableContentUrl } from "@/format";
import type { PublicShareModel } from "@/share/load-public-artifact";
import { LockedShare, type UnlockFeedback } from "@/share/locked-share";

export function PublicShareScreen({
  state,
  opening = false,
  unlocked = false,
  onUnlock
}: {
  state: PublicShareModel;
  opening?: boolean;
  unlocked?: boolean;
  onUnlock?: (password: string) => Promise<UnlockFeedback>;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ViewerBar title={shareTitle(state)} showLibraryLink={false} meta={<ShareMeta state={state} />} />
      <main className="min-h-0 flex-1 bg-white">
        {state.status === "ready" ? (
          <ReadyShare artifact={state.artifact} unlocked={unlocked} />
        ) : state.status === "locked" ? (
          <LockedShare expired={state.expired} opening={opening} onUnlock={onUnlock ?? noUnlock} />
        ) : (
          <ShareNotice state={state} />
        )}
      </main>
    </div>
  );
}

function shareTitle(state: PublicShareModel): string {
  if (state.status === "ready") {
    return artifactLabel(state.artifact);
  }
  return state.status === "locked" ? "Locked artifact" : "Artifact not found";
}

function ShareMeta({ state }: { state: PublicShareModel }) {
  if (state.status === "locked" || (state.status === "ready" && state.artifact.passwordProtected)) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-full bg-lilac px-3 py-1 text-sm font-medium text-ink">
        <LockKeyhole className="size-3.5 text-peri-d" aria-hidden="true" />
        {state.status === "locked" ? "Password protected" : "Unlocked with password"}
      </p>
    );
  }
  return state.status === "ready" ? <p className="text-sm text-muted-foreground">Shared artifact</p> : null;
}

function ReadyShare({
  artifact,
  unlocked
}: {
  artifact: Extract<PublicShareModel, { status: "ready" }>["artifact"];
  unlocked: boolean;
}) {
  if (!isEmbeddableContentUrl(artifact.contentUrl)) {
    return (
      <div className="flex h-full items-center px-6 sm:px-10">
        <p role="alert" className="max-w-xl text-base text-destructive">
          {CONTENT_LOAD_FAILURE}
        </p>
      </div>
    );
  }
  return (
    <div className={unlocked ? "ft-unveil h-full" : "h-full"} data-testid="share-content">
      <ArtifactFrame key={artifact.contentUrl} contentUrl={artifact.contentUrl} />
    </div>
  );
}

function ShareNotice({ state }: { state: Extract<PublicShareModel, { status: "missing" | "unavailable" }> }) {
  return (
    <div className="ft-enter flex h-full items-center px-6 sm:px-10">
      <p role={state.status === "missing" ? "status" : "alert"} className={state.status === "missing" ? "text-lg" : "text-lg text-destructive"}>
        {state.message}
      </p>
    </div>
  );
}

async function noUnlock(): Promise<UnlockFeedback> {
  return null;
}
