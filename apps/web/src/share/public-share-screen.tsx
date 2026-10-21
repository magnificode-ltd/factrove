import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { isEmbeddableContentUrl } from "@/format";
import type { PublicShareModel } from "@/share/load-public-artifact";

export function PublicShareScreen({ state }: { state: PublicShareModel }) {
  const title = state.status === "ready" ? state.artifact.filename : "Artifact not found";
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <ViewerBar
        title={title}
        showLibraryLink={false}
        meta={state.status === "ready" ? <p className="text-sm text-muted-foreground">Shared artifact</p> : null}
      />
      <main className="min-h-0 flex-1 bg-white">
        {state.status === "ready" ? <ReadyShare artifact={state.artifact} /> : <ShareNotice state={state} />}
      </main>
    </div>
  );
}

function ReadyShare({ artifact }: { artifact: Extract<PublicShareModel, { status: "ready" }>["artifact"] }) {
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

function ShareNotice({ state }: { state: Exclude<PublicShareModel, { status: "ready" }> }) {
  return (
    <div className="ft-enter flex h-full items-center px-6 sm:px-10">
      <p role={state.status === "missing" ? "status" : "alert"} className={state.status === "missing" ? "text-lg" : "text-lg text-destructive"}>
        {state.message}
      </p>
    </div>
  );
}
