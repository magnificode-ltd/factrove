import { ArtifactFrame, CONTENT_LOAD_FAILURE } from "@/components/artifact-frame";
import { ViewerBar } from "@/components/chrome";
import { accessLabel, formatBytes, formatUploadedAt, isEmbeddableContentUrl } from "@/format";
import type { ViewerModel } from "@/viewer/load-artifact";

export function ViewerScreen({ state }: { state: ViewerModel }) {
  const title =
    state.status === "ready" ? state.artifact.filename : state.status === "missing" ? "Artifact not found" : "Artifact unavailable";
  return (
    <div className="viewer-page">
      <ViewerBar title={title} meta={state.status === "ready" ? <ViewerFacts state={state} /> : null} />
      <main className="stage">
        {state.status === "ready" ? (
          <ReadyArtifact state={state} />
        ) : (
          <p role="alert" className="banner error">
            {state.message}
          </p>
        )}
      </main>
    </div>
  );
}

function ViewerFacts({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  return (
    <p className="bar-meta">
      <span>{accessLabel(artifact.accessType)} · list only</span>
      <time dateTime={artifact.uploadedAt}>{formatUploadedAt(artifact.uploadedAt)}</time>
      <span>{formatBytes(artifact.sizeBytes)}</span>
    </p>
  );
}

function ReadyArtifact({ state }: { state: Extract<ViewerModel, { status: "ready" }> }) {
  const { artifact } = state;
  if (!isEmbeddableContentUrl(artifact.contentUrl)) {
    return (
      <p role="alert" className="banner error">
        {CONTENT_LOAD_FAILURE}
      </p>
    );
  }
  return <ArtifactFrame key={artifact.contentUrl} contentUrl={artifact.contentUrl} />;
}
