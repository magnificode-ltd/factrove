import { authPageHref } from "@/auth/return-path";
import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { CopyButton } from "@/components/copy-button";
import { ShareControl } from "@/components/share-control";
import { Button } from "@/components/ui/button";
import { accessLabel, artifactLabel, formatBytes, formatRelativeTime, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";

export function ViewerScreen({ state }: { state: ViewerModel }) {
  const title =
    state.status === "ready"
      ? artifactLabel(state.artifact)
      : state.status === "missing"
        ? "Artifact not found"
        : state.status === "signed-out"
          ? "Sign in"
          : "Artifact unavailable";
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ViewerBar
        title={title}
        meta={state.status === "ready" ? <ViewerFacts state={state} /> : null}
        tools={state.status === "ready" ? <ViewerTools state={state} /> : null}
      />
      <main className="min-h-0 flex-1 bg-white">
        {state.status === "ready" ? <ReadyArtifact state={state} /> : <ViewerNotice state={state} />}
      </main>
    </div>
  );
}

function ViewerFacts({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  const uploaded = formatUploadedAt(artifact.uploadedAt);
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <code className="font-mono text-[13px] text-ink">{artifact.id}</code>
      <span>{accessLabel(artifact.accessType)}</span>
      <time dateTime={artifact.uploadedAt} title={uploaded}>
        <span className="sr-only">{uploaded}</span>
        <span aria-hidden="true">{formatRelativeTime(artifact.uploadedAt)}</span>
      </time>
      <span>{formatBytes(artifact.sizeBytes)}</span>
    </p>
  );
}

function ViewerTools({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  const share = state.share ?? null;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      {share ? (
        <ShareControl artifactId={artifact.id} initial={share} viewerUrl={artifact.viewerUrl} showCopyLink />
      ) : (
        <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={artifact.viewerUrl} />
      )}
      <CopyButton label="Copy ID" copiedLabel="Copied" message="Artifact ID copied" value={artifact.id} />
    </div>
  );
}

function ReadyArtifact({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  if (!isEmbeddableContentUrl(artifact.contentUrl)) {
    return (
      <div className="flex h-full items-center px-6 sm:px-10">
        <p role="alert" className="max-w-xl text-base text-destructive">
          {CONTENT_LOAD_FAILURE}
        </p>
      </div>
    );
  }
  return <ArtifactFrame key={artifact.contentUrl} contentUrl={artifact.contentUrl} />;
}

function ViewerNotice({ state }: { state: Exclude<ViewerModel, { status: "ready" }> }) {
  const calm = state.status === "signed-out";
  return (
    <div className="ft-enter flex h-full items-center px-6 sm:px-10">
      <div className="max-w-xl">
        <p role={calm ? "status" : "alert"} className={calm ? "text-lg" : "text-lg text-destructive"}>
          {state.message}
        </p>
        {state.status === "signed-out" ? (
          <p className="mt-5">
            <Button asChild className="h-11">
              <a href={authPageHref("login", state.returnTo)}>Sign in</a>
            </Button>
          </p>
        ) : null}
      </div>
    </div>
  );
}
