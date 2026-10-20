import { authPageHref } from "@/auth/return-path";
import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { accessLabel, formatBytes, formatRelativeTime, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";
import type { ArtifactDto } from "@factrove/contracts";

export function ViewerScreen({ state }: { state: ViewerModel }) {
  const title =
    state.status === "ready"
      ? state.artifact.filename
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
        tools={state.status === "ready" ? <ViewerTools artifact={state.artifact} /> : null}
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

function ViewerTools({ artifact }: { artifact: ArtifactDto }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CopyButton label="Copy link" copiedLabel="Copied" message="Link copied" value={artifact.viewerUrl} />
      <CopyButton label="Copy ID" copiedLabel="Copied" message="Artifact ID copied" value={artifact.id} />
      {isEmbeddableContentUrl(artifact.contentUrl) ? (
        <Button asChild variant="outline" className="h-10">
          <a href={artifact.contentUrl} target="_blank" rel="noreferrer">
            Open raw
          </a>
        </Button>
      ) : null}
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
