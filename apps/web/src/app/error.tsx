"use client";

import { AppBar, ModeNote } from "@/components/chrome";
import { Button } from "@/components/ui/button";

export default function LibraryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="ft-canvas min-h-dvh">
      <AppBar />
      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <h1 className="ft-title text-4xl sm:text-5xl">Artifacts</h1>
        <ModeNote />
        <p role="alert" className="mt-8 max-w-xl text-lg text-destructive">
          This page could not be loaded.
        </p>
        <Button className="mt-6 h-11" type="button" onClick={() => reset()}>
          Try again
        </Button>
      </main>
    </div>
  );
}
