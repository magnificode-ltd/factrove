import { ModeNote, PageIntro } from "@/components/chrome";

export default function LoadingArtifact() {
  return (
    <main className="page">
      <p className="back">
        <a href="/">Back to library</a>
      </p>
      <PageIntro title="Artifact" />
      <ModeNote />
      <p role="status" className="banner">
        Loading artifact…
      </p>
    </main>
  );
}
