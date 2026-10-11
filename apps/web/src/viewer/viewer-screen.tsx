import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ModeNote, PageIntro } from "@/components/chrome";
import { accessLabel, formatBytes, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";

export function ViewerScreen({ state }: { state: ViewerModel }) {
  const title =
    state.status === "ready" ? state.artifact.filename : state.status === "missing" ? "Artifact not found" : "Artifact unavailable";
  return (
    <main className="page">
      <p className="back">
        <a href="/">Back to library</a>
      </p>
      <PageIntro title={title} />
      <ModeNote />
      {state.status === "ready" ? <ReadyArtifact state={state} /> : <p role="alert" className="banner error">{state.message}</p>}
    </main>
  );
}

function ReadyArtifact({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  return (
    <>
      <p className="meta viewer-meta">
        <span>{accessLabel(artifact.accessType)} · list only</span>
        <time dateTime={artifact.uploadedAt}>{formatUploadedAt(artifact.uploadedAt)}</time>
        <span>{formatBytes(artifact.sizeBytes)}</span>
      </p>
      {isEmbeddableContentUrl(artifact.contentUrl) ? (
        <ArtifactFrame key={artifact.contentUrl} contentUrl={artifact.contentUrl} />
      ) : (
        <p role="alert" className="banner error">
          {CONTENT_LOAD_FAILURE}
        </p>
      )}
    </>
  );
}
