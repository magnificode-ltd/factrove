import { authPageHref } from "@/auth/return-path";
import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { Button } from "@/components/ui/button";
import { accessLabel, formatBytes, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";

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
      <ViewerBar title={title} meta={state.status === "ready" ? <ViewerFacts state={state} /> : null} />
      <main className="min-h-0 flex-1 bg-white">
        {state.status === "ready" ? <ReadyArtifact state={state} /> : <ViewerNotice state={state} />}
      </main>
    </div>
  );
}

function ViewerFacts({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
      <span>{accessLabel(artifact.accessType)}</span>
      <time dateTime={artifact.uploadedAt}>{formatUploadedAt(artifact.uploadedAt)}</time>
      <span>{formatBytes(artifact.sizeBytes)}</span>
    </p>
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
