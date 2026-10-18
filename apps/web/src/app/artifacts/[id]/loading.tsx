import { ViewerBar } from "@/components/chrome";

export default function LoadingArtifact() {
  return (
    <div className="viewer-page">
      <ViewerBar title="Artifact" />
      <main className="stage">
        <p role="status" className="banner">
          Loading artifact…
        </p>
      </main>
    </div>
  );
}
