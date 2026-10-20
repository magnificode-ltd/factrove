"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const CONTENT_LOAD_FAILURE = "The artifact content could not be loaded. Refresh to try again.";

type ContentStatus = "checking" | "ready" | "failed";

export function ArtifactFrame({ contentUrl }: { contentUrl: string }) {
  const [status, setStatus] = useState<ContentStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("checking");
    void confirmHtmlContent(contentUrl, controller.signal).then(
      (ready) => {
        if (!controller.signal.aborted) {
          setStatus(ready ? "ready" : "failed");
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setStatus("failed");
        }
      }
    );
    return () => controller.abort();
  }, [contentUrl]);

  if (status === "checking") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-5 px-6">
        <div className="grid w-full max-w-3xl gap-3" aria-hidden="true">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          Checking artifact content…
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex h-full flex-col items-start justify-center gap-4 px-6 sm:px-10">
        <p role="alert" className="max-w-xl text-base text-destructive">
          {CONTENT_LOAD_FAILURE}
        </p>
        <Button className="h-11" type="button" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <iframe
      className="block h-full w-full border-0 bg-white"
      title="Uploaded HTML"
      src={contentUrl}
      // allow-scripts only: the document cannot read the Next.js parent.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
    />
  );
}

// Iframe error events do not fire when the framed response is an HTTP error document.
async function confirmHtmlContent(contentUrl: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(contentUrl, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    signal
  });
  const mediaType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  try {
    await response.body?.cancel();
  } catch {
    // The body is discarded either way. HTML stays out of the parent document.
  }
  return response.ok && mediaType === "text/html";
}
