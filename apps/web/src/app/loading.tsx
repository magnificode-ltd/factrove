import { AppBar, ModeNote } from "@/components/chrome";

export default function Loading() {
  return (
    <div className="library-page">
      <AppBar />
      <main className="catalog">
        <h1 className="page-title">Artifacts</h1>
        <ModeNote />
        <p role="status" className="banner">
          Loading artifacts…
        </p>
      </main>
    </div>
  );
}
