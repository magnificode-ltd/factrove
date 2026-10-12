"use client";

import { AppBar, ModeNote } from "@/components/chrome";

export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="library-page">
      <AppBar />
      <main className="catalog">
        <h1 className="page-title">Artifacts</h1>
        <ModeNote />
        <p role="alert" className="banner error">
          This page could not be loaded.
        </p>
        <button className="action" type="button" onClick={() => reset()}>
          Try again
        </button>
      </main>
    </div>
  );
}
