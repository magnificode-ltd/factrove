"use client";

import { ModeNote, PageIntro } from "@/components/chrome";

export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <PageIntro title="Artifacts" />
      <ModeNote />
      <p role="alert" className="banner error">
        This page could not be loaded.
      </p>
      <p className="toolbar">
        <button className="refresh" type="button" onClick={() => reset()}>
          Try again
        </button>
      </p>
    </main>
  );
}
