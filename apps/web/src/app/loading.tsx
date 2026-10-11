import { ModeNote, PageIntro } from "@/components/chrome";

export default function Loading() {
  return (
    <main className="page">
      <PageIntro title="Artifacts" />
      <ModeNote />
      <p role="status" className="banner">
        Loading artifacts…
      </p>
    </main>
  );
}
