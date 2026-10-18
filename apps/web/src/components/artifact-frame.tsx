"use client";

import { useEffect, useState } from "react";

export const CONTENT_LOAD_FAILURE = "The artifact content could not be loaded. Refresh to try again.";

type ContentStatus = "checking" | "ready" | "failed";

export function ArtifactFrame({ contentUrl }: { contentUrl: string }) {
  const [status, setStatus] = useState<ContentStatus>("checking");
  const [attempt, setAttempt] = useState(0);

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
  }, [attempt, contentUrl]);

  if (status === "checking") {
    return (
      <p role="status" className="banner">
        Checking artifact content…
      </p>
    );
  }

  if (status === "failed") {
    return (
      <>
        <p role="alert" className="banner error">
          {CONTENT_LOAD_FAILURE}
        </p>
        <button className="action" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      </>
    );
  }

  return (
    <iframe
      className="stage-frame"
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
